# GoHighLevel Decommission — Footprint Audit

> Repo-grounded, file-level audit of the entire GHL surface. This is the safety-critical
> reference that gates the decommission (ADR-014). Verified against the live code on the
> `claude/fsos-comms-ghl-decommission` branch. All paths are repo-relative.

## 0. Corrections to the brief (verify-then-act)

| Brief claim | As-built reality |
|---|---|
| 9 GHL env vars | **Only 3 are env vars:** `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`. `GHL_API_BASE`, `GHL_API_VERSION`, `GHL_LOCATION_ID_DEFAULT`, `GHL_CUSTOM_FIELDS`, `GHL_PIPELINE_KEY`, `GHL_SYNC_ENTITY` are **TypeScript constants** in `src/lib/ghl.ts` / `src/lib/validation/schemas.ts`. |
| "~54 files" | ~40 genuine GHL-referencing source files (the whole-repo grep's ~137 hits are mostly `.claude`/`.cursor` skill tooling and substring false-positives like "highlight"/"Highly"/"hour"). |
| GHL env vars in CI | **None.** No `.github` workflow references GHL. `vercel.json` references only the upload route path (maxDuration), not GHL env. |

## 1. Core library (single source of truth)

- **`src/lib/ghl.ts`** — GHL integration core. Pipeline+stage ID map, custom-field key map, REST
  client (`ghlFetch`, `upsertContact`, `createOpportunity`, `moveOpportunityStage`,
  `addContactTags`), retry wrapper, `ghlEnabled()`, `ghlLocationId()`, `ghlSummary()`, stage
  classifiers (`findStageById`, `isApplicationSubmittedStage`, `isIssuedStage`). Holds every
  hardcoded ID (§8) and the single outbound origin (§9).
- **`src/lib/ghlContacts.ts`** — CSV→GHL contact field mapping/validation (header-alias detection,
  `mapAndValidateRow`, `resolveColumns`, `CANONICAL_FIELDS`). Imports `GHL_CUSTOM_FIELDS`. No
  network calls.
- **`src/lib/columnAI.ts`** — imports `CANONICAL_FIELDS` from `ghlContacts.ts`; AI column mapper
  for the upload flow.
- **`src/lib/ai/contactRouter.ts`** — classifies a contact and picks GHL pipeline placement;
  imports `MappedContact` + `GhlPipeline`.
- **`src/lib/customerProfile.ts`** — attaches `ghlSummary` to the customer profile.
- **`src/lib/validation/schemas.ts`** — `GHL_SYNC_ENTITY`, `GHL_PIPELINE_KEY`, `GhlSyncSchema`,
  `GhlSync` type.
- **`src/lib/types/database.ts`** — type defs for the GHL columns.

## 2. GHL-specific API routes

| Route | Purpose |
|---|---|
| `src/app/api/webhooks/ghl/route.ts` | **Inbound webhook (load-bearing).** HMAC-verified; dispatches Contact/Opportunity/Appointment/OptOut. Full detail §3. |
| `src/app/api/ghl/sync/route.ts` | Outbound sync (legacy tables). Internal-auth. `customers`/`agencies` → GHL contact+opportunity. 503 when `!ghlEnabled()`. |
| `src/app/api/ghl/sync-record/route.ts` | Outbound sync (spine). RBAC `fsa`. `households`/`agency_partnerships` → GHL; enforces `do_not_contact` (409); writes `activities` + audit; sets `ghl_synced_at`. Backs `GhlSyncButton`. |
| `src/app/api/ghl/contacts/upload/route.ts` | CSV/XLSX → GHL contact upsert (legacy importer). Internal-auth. Writes `ghl_upload_batches`/`ghl_upload_rows`. `maxDuration:60`. |
| `src/app/api/app/contacts/upload/route.ts` | Native App-B port of the above (RBAC + audited + AI contact-router). Same upload tables. |
| `src/app/api/admin/imports/ghl/route.ts` | **GHL-labeled CSV import into the spine — NOT a live GHL call.** preview/commit/rollback of GHL-exported contacts → `households`+`household_members`+`consents`. Explicit "labeled CSV fallback" (no verified GHL API). |

**Read/enrich-only routes** (display stored GHL columns via `ghlSummary()`, no GHL-owned logic):
`api/dashboard`, `api/scores`, `api/search`, `api/opra`, `api/agencies/list`,
`api/customers/detail`, `api/customers/next-action`, `api/health` (`ghl_key` flag),
`api/audit` (reads `ghl_upload_batches`). Outbound push on submit:
`api/agencies/referral` (wrapped in `if (ghlEnabled())`). Workshop consult-spine push:
`api/workshops/registrations/[id]`, `api/public/workshops/feedback`.

## 3. The load-bearing webhook — `POST /api/webhooks/ghl`

**Auth:** `verifyGHLSignature` = HMAC-SHA256(raw body, `GHL_WEBHOOK_SECRET`) vs header
`x-ghl-signature` | `x-wh-signature`, `timingSafeEqual`. Secret unset ⇒ **fail-closed in prod,
open in non-prod**. Invalid sig → 401; invalid JSON → 400. Handler errors return 200
`{received:true}` (avoid GHL retry storms). **Gated only by the secret — independent of
`ghlEnabled()`.**

**Event routing** (`eventType` normalizes to lowercase alpha):

| Event contains | Handler | Side effects (writes to **legacy** tables) |
|---|---|---|
| `opportunity` | `handleOpportunityStage` | Upserts `customers` from embedded contact; updates `ghl_opportunity_id/stage_id/pipeline_id`. **At "Application Submitted" (`isApplicationSubmittedStage`) → INSERT `commission_cases`** (idempotent on `ghl_opportunity_id`; fields carrier/product/premium from `monetaryValue`/`case_status:'submitted'`/`submitted_at`/`pipeline`). **At "Issued" (`isIssuedStage`) → UPDATE `commission_cases` set `case_status:'issued', issued_at=now()`** where not already issued. Always logs an `activity` note (`channel:'ghl'`). |
| `appointment` | `handleAppointment` | Resolve/create customer; INSERT `activity` (`type:'appointment'`, `direction:'inbound'`, `channel:'ghl'`, `ghl_activity_id`). |
| `dnd` \| `optout` \| `unsubscribe` | `handleOptOut` | **INSERT `consent_ledger`** (`status:'opted_out'`, `source:'ghl_webhook'`); flip `customers.consent_email`/`consent_sms`. Channel normalized: `[email,all,both,*,dnd]` ⇒ email opt-out; anything but email-only ⇒ SMS opt-out. **TCPA-critical.** |
| `contact` | `handleContactUpsert` | Find by `ghl_contact_id` then `email`; existing ⇒ patch `ghl_contact_id`/`phone`; new ⇒ INSERT `customers` with **`consent_email:false, consent_sms:false`** (never infers consent from a webhook). |

**The commission-case create/issue trigger and the GHL opt-out capture are the two behaviors D1
must replace natively before removal.** No other code path creates commission cases from pipeline
movement.

## 4. Migrations

| File | Adds |
|---|---|
| `002_ghl_integration.sql` | `ghl_contact_id/opportunity_id/stage_id/pipeline_id` on `customers`; `ghl_opportunity_id` on `commission_cases`; `ghl_activity_id` on `activity`. Partial-unique idx on `customers.ghl_contact_id`. |
| `003_ghl_agency.sql` | Same four columns on legacy `agencies`; partial-unique idx. |
| `004_ghl_contact_uploads.sql` | Tables `ghl_upload_batches`, `ghl_upload_rows` (RLS enabled, no permissive policy — service-role only). |
| `023_ghl_sync_native.sql` | `ghl_contact_id`, `ghl_opportunity_id`, `ghl_synced_at` on spine `households` + `agency_partnerships`. |
| `026_contacts.sql` | `contacts.ghl_contact_id`. |
| `038_workshops_seminar_engine.sql` | `workshop_registrations.ghl_contact_id`. |
| `039_workshop_attendance_ops.sql` | `workshop_registrations.ghl_opportunity_id`. |
| `040`/`041` | Comments only (lead-score push, Pipeline-A routing) — no columns. |

## 5. Dedicated tables & provenance columns

**Drop candidates (D4):** `ghl_upload_batches`, `ghl_upload_rows`.

**Provenance columns (retain as legacy in D3, drop in D4):**

| Column | Tables | Migration |
|---|---|---|
| `ghl_contact_id` | `customers`, `agencies`, `ghl_upload_rows`, `households`, `agency_partnerships`, `contacts`, `workshop_registrations` | 002/003/004/023/026/038 |
| `ghl_opportunity_id` | `customers`, `agencies`, `commission_cases`, `ghl_upload_rows`, `households`, `agency_partnerships`, `workshop_registrations` | 002/003/004/023/039 |
| `ghl_stage_id` | `customers`, `agencies` (legacy only) | 002/003 |
| `ghl_pipeline_id` | `customers`, `agencies` (legacy only) | 002/003 |
| `ghl_activity_id` | `activity` (legacy only) | 002 |

**GHL-tagged string enums (not columns):** `activity.channel='ghl'`, `consent_ledger.source='ghl_webhook'`,
`import_jobs.entity='ghl_contacts'`, `consents.source='ghl_import'`, `activities.kind='ghl_sync'`,
audit `entity='ghl_upload_batch'`/`'ghl_opportunity'`. `commission_cases.ghl_opportunity_id` is
**load-bearing** — the webhook keys case create/issue on it.

## 6. Environment variables

| Var | Where |
|---|---|
| `GHL_API_KEY` | Enable flag (`ghlEnabled()` = `!!process.env.GHL_API_KEY`, `ghl.ts`); Bearer token in `ghlFetch`; read at `api/health` and `super/health/page.tsx`. |
| `GHL_LOCATION_ID` | `ghlLocationId()` (falls back to the `GHL_LOCATION_ID_DEFAULT` constant). |
| `GHL_WEBHOOK_SECRET` | `webhooks/ghl/route.ts` signature verification. |

Referenced in `.env.local.example` (62–74), `README.md`, `docs/ghl_integration.md`,
`docs/make_scenarios.md`, `docs/specs/workshops-seminar-design-spec.md`, two `docs/*.html`, and
`tests/workshop-ops.test.mjs`. **Constants** (not env): `GHL_LOCATION_ID_DEFAULT`,
`GHL_API_BASE`, `GHL_API_VERSION`, `GHL_CUSTOM_FIELDS`, `GHL_PIPELINE_KEY`, `GHL_SYNC_ENTITY`.

## 7. The `ghlEnabled()` flag

Defined `src/lib/ghl.ts` → `!!process.env.GHL_API_KEY`. `ghlFetch` returns `{skipped:true}` (no
network) when false, so every outbound helper hard no-ops. Explicit 503 gates:
`api/ghl/sync`, `api/ghl/sync-record`, `api/ghl/contacts/upload`, `api/app/contacts/upload`;
`api/agencies/referral` wraps its push in `if (ghlEnabled())`; `workshops/server.ts` +
`workshops/comms-engine.ts` early-return. **Not gated by the flag:** the inbound webhook (secret
only) and all read/enrich routes (they only read stored columns). This is why outbound already
degrades gracefully and only the inbound webhook needs native replacement (D1) before removal.

## 8. Hardcoded GHL identifiers (all in `src/lib/ghl.ts`)

- Location ID `ATDNO1e5d27nj5t8vId3` ("Markist Athelus Agency").
- Pipeline A (Prospect/Client) `nuOBjRl27uhinHChdqfH`, 10 stage UUIDs incl. **Application
  Submitted `f7be8411-c27e-4d67-9a73-5f4b048425ee`** and **Issued
  `663763b9-b082-47d8-8c82-67342d49a823`**.
- Pipeline B (Agency Owner) `lIUaJLNxFwtCJPycw70h`, 8 stages.
- Pipeline C (Term Conversions) `EGvOhkgRjUslNVXGX1Wp`, 6 stages.
- `APPLICATION_SUBMITTED_STAGE_IDS` / `ISSUED_STAGE_IDS` — the exact UUIDs the webhook depends on.

D5 must prove none of these constants remain in source.

## 9. Outbound network origin

Single origin: `ghlFetch` → `fetch(\`${GHL_API_BASE}${path}\`)`,
`GHL_API_BASE='https://services.leadconnectorhq.com'`, version header `2021-07-28`, Bearer
`GHL_API_KEY`. Endpoints: `POST /contacts/upsert`, `POST /opportunities/`,
`PUT /opportunities/{id}`, `POST /contacts/{id}/tags`. Every module calls the exported helpers,
never `fetch` directly. Other host mentions are docs-only (`docs/apex_to_ghl_flow.html`,
`docs/fsos_implementation_guide.html`). No `rest.gohighlevel.com` in source.

## 10. UI entry points

- `GhlSyncButton.tsx` → `/api/ghl/sync-record`; rendered by `AgencyProfile.tsx`, `HouseholdProfile.tsx`.
- `GhlImportWizard.tsx` → `/api/admin/imports/ghl`; rendered at `(admin)/admin/data/imports/ghl/page.tsx`.
- Import index link `(admin)/admin/data/imports/page.tsx`.
- Contact upload `(fsa)/app/contacts/upload/page.tsx` + `ContactUploadForm.tsx`; "Sync to GHL"
  link on `contacts/page.tsx`.
- Legacy monolith `src/components/pages/fsos_command_center.jsx` — `GhlBadge` chips, `syncToGhl()`,
  contact-upload panel, health tile.
- Health surfaces: `(super)/super/health/page.tsx` tile + `/api/health` `ghl_key`.
- Workshops: `WorkshopRegistrations.tsx` "converted" badge keyed on `ghl_opportunity_id`.

## 11. What breaks on removal — replace before D3

1. **Commission-case lifecycle** (webhook `OpportunityStageUpdate`) — the only pipeline→case
   trigger. → **D1 native replacement (required).**
2. **GHL opt-out capture** (webhook `handleOptOut` → `consent_ledger` + `customers.consent_*`).
   Secondary to native Twilio-STOP/Resend-unsubscribe, but must not be lost. **Note the target
   mismatch:** the gate enforces from `consents` + `dnc_entries` (`send.ts`), **not**
   `consent_ledger` — so D0 must migrate historical opt-outs into `consents`/`dnc_entries`
   (member-resolved, fail-closed to `dnc_entries`), not into `consent_ledger`. → **D0 export
   (enforcement stores) + D1 coverage check.** See ADR-014 D0.
3. **Appointment activity** logging. → **D1 native appointment logging.**
4. **Pipeline stage display** (`ghlSummary()` across dashboard/scores/search/opra/agencies reading
   `ghl_stage_id`/`ghl_pipeline_id`). → native stage source or graceful removal in D3.
5. **Workshop lead conversion** push + the `ghl_opportunity_id` "converted" signal for attendance
   analytics. → native conversion signal in D1/D3.

## 12. D0 gate & D5 proof checklist

**D0 gate:** the reconciliation report must show **zero unresolved opt-outs** before any GHL code
is deleted, and each migrated opt-out must be **enforced through `evaluateGate`** (written to
`consents`/`dnc_entries`, and proven to *block* a send) — a row's mere existence is not proof.

**D5 proof (attach empty-result evidence):**
- No outbound requests to `leadconnectorhq.com` / `services.leadconnectorhq.com` /
  `rest.gohighlevel.com` / `gohighlevel.com` across `fetch`/`axios`/`ky`/`node-fetch`/`undici`/
  webhooks/cron/edge/workers/server-actions.
- No `GHL_API_KEY` / `GHL_LOCATION_ID` / `GHL_WEBHOOK_SECRET` in code, `.env*`, `vercel.json`, CI, docs.
- No GHL routes/components/libs/UI; no dead links; build green.
- No hardcoded GHL identifiers (§8) in source.
