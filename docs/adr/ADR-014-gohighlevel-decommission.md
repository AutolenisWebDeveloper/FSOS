# ADR-014 — GoHighLevel Decommission (ordered, data-preservation-first)

**Status:** Accepted
**Date:** 2026-07-23
**Owner:** FSOS Engineering
**Related:** ADR-001 (aggregate root), ADR-003 (single dispatcher), ADR-004 (securities firewall), ADR-010 (ownership & RLS), ADR-013 (canonical `comm_*` model); CLAUDE.md §1, §3, §4, §12; master build instruction §2

## Context

FSOS is being completed as a **native, self-contained** communications platform: FSOS as system of record + campaign manager + policy/compliance gate; **Twilio** for SMS delivery; **Resend** for email. GoHighLevel (GHL), currently a **bidirectional, load-bearing** integration, is to be **fully removed**.

GHL is not a passive read integration. Removing it out of order destroys compliance and commission data. The audit (`docs/comms-ghl-migration/ghl-footprint-audit.md`) establishes the as-built footprint precisely, correcting several figures in the brief:

- **Real environment variables: only three** — `GHL_API_KEY` (the enable flag, via `ghlEnabled()`), `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`. The brief also lists `GHL_API_BASE`, `GHL_API_VERSION`, `GHL_LOCATION_ID_DEFAULT`, `GHL_CUSTOM_FIELDS`, `GHL_PIPELINE_KEY`, `GHL_SYNC_ENTITY`; in this codebase those are **TypeScript constants**, not env vars (`src/lib/ghl.ts`, `src/lib/validation/schemas.ts`), so decommission must remove *code constants*, not config keys, for those six.
- **One outbound network origin:** `ghlFetch()` in `src/lib/ghl.ts` (`https://services.leadconnectorhq.com`, API version `2021-07-28`). Every outbound helper (`upsertContact`, `createOpportunity`, `moveOpportunityStage`, `addContactTags`) funnels through it and hard no-ops when `!ghlEnabled()`.
- **Load-bearing inbound behavior** lives entirely in `POST /api/webhooks/ghl` (gated by `GHL_WEBHOOK_SECRET`, **independent of `ghlEnabled()`**), writing to the **legacy** tables (`customers`, `commission_cases`, `activity`, `consent_ledger`) — *not* the aggregate-root spine:
  1. `ContactCreate/Update` → upsert `customers` (never infers consent — inserts `consent_email:false, consent_sms:false`).
  2. `OpportunityStageUpdate` → **creates a `commission_cases` row at "Application Submitted"** (idempotent on `ghl_opportunity_id`) and **marks it issued at "Issued"**. No other code path creates commission cases from pipeline movement.
  3. `AppointmentCreate` → logs an `activity` row (`channel:'ghl'`, `ghl_activity_id`).
  4. `ContactDndUpdate / OptOut / Unsubscribe` → appends `consent_ledger` (`status:'opted_out'`, `source:'ghl_webhook'`) and flips `customers.consent_*`. **TCPA-critical.**
- **A separate native opt-out path already exists**: inbound Twilio STOP and Resend unsubscribe flow through `src/lib/comms/inbound.ts` → `consents` (revoked) + `dnc_entries` + `audit_log`. The GHL webhook is a *secondary* opt-out capture that must not be lost.
- **Everything outbound already degrades gracefully** when `GHL_API_KEY` is unset (`ghlFetch` returns `{skipped:true}`; sync routes return 503). The inbound webhook side-effects (items 1–4) are the only behavior that must be *replaced natively* before removal.
- **GHL provenance columns** span legacy and spine tables (`ghl_contact_id`, `ghl_opportunity_id`, `ghl_stage_id`, `ghl_pipeline_id`, `ghl_activity_id`; migrations 002/003/004/023/026/038/039) plus the dedicated `ghl_upload_batches` / `ghl_upload_rows` tables (004).

## Decision

Remove GHL in a **strict, ordered sequence**, each stage its own reviewed PR, **data preservation first, rollback mandatory** (master build instruction §2, §2.A). No GHL code is deleted before the opt-out export (D0) is verified; no destructive schema change occurs before its rollback is tested against a scratch database.

**D0 — Export & reconcile (no code deletion).** One-time auditable export of GHL state into FSOS as system of record, **opt-outs first**. The opt-out migration must target the stores the gate actually **enforces** at send time — not the immutable ledger the current GHL webhook happens to write:

- **Enforcement target, not `consent_ledger`.** `src/lib/comms/send.ts` computes the gate context from **`consents`** (member-keyed `status='granted'|'revoked'`, `hasConsent`, ~line 121) and **`dnc_entries`** (contact-keyed suppression, `onDNC`, ~line 163). `src/lib/comms/gate.ts` is pure and **never reads `consent_ledger`**. Therefore every GHL DND/opt-out/unsubscribe migrates into **`consents` (revoked, per channel) and/or `dnc_entries`**, with `source='ghl_migration'` and original timestamps preserved. Writing them into `consent_ledger` alone would leave those recipients **reachable by automated SMS** — a TCPA failure. (This aligns with `docs/legacy-mapping.md`, which already maps `consent_ledger → consents (+ dnc_entries)`, "revocation authoritative at send time — WF-9".) A `consent_ledger` row may still be appended as an audit record, but it is **never** the enforcement store.
- **Resolve GHL contact → household member.** `consents` is keyed on `member_id` (`household_members`). Each GHL opt-out must be resolved to a member before writing a `consents` row.
- **Fail closed on unresolved.** Any GHL opt-out that **cannot** be resolved to a member is suppressed via **`dnc_entries`** (contact = phone/email, `scope='internal'`, `reason='ghl_migration'`) rather than dropped. Dropping an unresolvable opt-out is a TCPA violation.
- Then migrate: contacts + custom fields, open opportunities + stage state, appointments, message/activity history.

Deliverable: a reconciliation report (counts per entity, matched/unmatched, conflicts, non-migratable). **Exit criteria before D1: zero unresolved opt-outs**, and a test asserting each migrated opt-out is **enforced through `evaluateGate`** (a row existing in a table proves nothing — the gate must actually block the send). A missing or unenforced opt-out is a TCPA violation.

**D1 — Replace GHL-triggered business logic natively.** Implement inside FSOS the four webhook side-effects: native pipeline/opportunity stage transitions that **create a commission case at "Application Submitted"** and **mark issued at "Issued"**; native appointment logging; native consent/DND capture (verify Twilio-STOP + Resend-unsubscribe coverage against `gate.ts`/`inbound.ts`). Proven with tests before D2. *Design note:* the native replacement should write to the same target the rest of the case spine uses; because the existing webhook writes legacy `customers`/`commission_cases`, D1 must reconcile that against the aggregate-root `opportunities`/`cases` per ADR-001 and `docs/legacy-mapping.md`, and document the chosen target.

**D2 — Freeze GHL (read-only).** Disable outbound sync (`upsertContact`, `createOpportunity`, `GhlSyncButton`, `/api/ghl/sync*`) behind the existing `ghlEnabled()` flag; keep `/api/webhooks/ghl` **receiving into an audit log only** so nothing is silently lost during cutover. Announce cutover in the runbook.

**D3 — Remove code & UI.** Delete `src/lib/ghl.ts`, `src/lib/ghlContacts.ts`, `GhlSyncButton.tsx`, `GhlImportWizard.tsx`, `/api/ghl/*`, `/api/admin/imports/ghl`, `/api/webhooks/ghl`, the GHL import pages, and every GHL reference across the audited files (`contactRouter.ts`, `columnAI.ts`, `csv.ts`, `customerProfile.ts`, dashboard/search/scores/opra/audit/health routes, `AgencyProfile`, `HouseholdProfile`, `ConvertWizard`, `DashboardBuilder`, `ForecastSettings`, `WorkflowBuilder`, `WorkshopRegistrations`, `ContactUploadForm`, workshops libs, `zoom/client.ts` comment, `validation/schemas.ts`, `types/database.ts`). Replace CSV/contact import with the **native FSOS importer** by retargeting the existing `/app/contacts/import` + `/api/app/contacts/import` paths — do not duplicate. Every removed route 404s or redirects intentionally; build stays green.

**D4 — Schema retirement (deferred, additive-safe).** **Do not drop GHL ID columns in the same PR as code removal.** Retire schema only in a later, separate migration, after the reconciliation report is signed off, a full backup exists, and a rollback is tested. Concrete SQL guidance:

- **Never delete or edit migrations `002`/`003`/`004`/`023`.** Migrations are forward-only: `npm run test:rls` and `scripts/migrate.mjs` replay the chain from scratch, and Supabase tracks applied migrations. Add a **new final migration** — the next free number is **`049_ghl_schema_retirement.sql`** (`045`–`048` are already taken: `045_opportunity_source`, `046_opportunity_contact`, `047_opportunity_policy`, `048_appointment_lifecycle`).
- **DROP the GHL indexes** (verified names): `idx_customers_ghl_contact`, `idx_customers_ghl_opportunity`, `idx_cases_ghl_opportunity`, `idx_activity_ghl` (mig 002); `idx_agencies_ghl_contact` (003); `idx_ghl_batches_created`, `idx_ghl_batches_status`, `idx_ghl_rows_batch`, `idx_ghl_rows_status`, `idx_ghl_rows_failed` (004); plus the spine partial-unique indexes on `households.ghl_contact_id` and `agency_partnerships.ghl_contact_id` (023).
- **EXPORT then DROP** the dedicated GHL tables `ghl_upload_batches` and `ghl_upload_rows` (004).
- **KEEP the `ghl_*_id` provenance columns** on `customers`, `agencies`, `households`, `agency_partnerships`, `contacts`, `commission_cases`, `activity`, `workshop_registrations` (incl. the legacy-only `ghl_stage_id`/`ghl_pipeline_id` on `customers`/`agencies` and `ghl_activity_id` on `activity`). Add `COMMENT ON COLUMN` marking each **legacy provenance — not written to, retained per ADR-014** so reconciliation stays possible.
- **Explicitly OUT OF SCOPE:** the tables `customers`, `commission_cases`, `activity`, `consent_ledger` themselves. These are **FSOS legacy tables governed by `docs/legacy-mapping.md` (C1–C6), not GHL objects** — D4 removes only GHL-specific columns/indexes/tables, never these tables.
- Ships with rollback SQL (recreate indexes + tables from their `004`/`002`/`003`/`023` definitions), rollback verification queries, an executed rollback test, estimated duration, and a verified backup.

**D5 — Decommission proof (network-level).** Attach repository-wide evidence that no runtime path can contact GHL: no outbound requests to any GHL host across `fetch`/`axios`/`ky`/`node-fetch`/`undici`/webhooks/cron/edge/workers/server-actions; no GHL env vars in code, `.env*`, `vercel.json`, CI, or docs; no GHL routes/components/libs/UI; no hardcoded GHL identifiers (the location/pipeline/stage IDs in `src/lib/ghl.ts`). Attach the search commands and their empty results.

**Hard rules (invariant across all stages):**
- No GHL code deletion before D0's opt-out import is verified complete.
- No destructive schema change before its rollback has been tested (applied and reverted on a scratch/branch DB).
- Every migration ships with rollback SQL, rollback verification queries, an executed rollback test, estimated rollback duration, and a verified backup.
- Row-count + checksum reports before and after every destructive phase; any unexplained delta halts the migration (master build instruction §2.A).
- The securities firewall (ADR-004) and the single dispatcher (ADR-003) are never weakened to accommodate removal.

## Rationale

- **Ordered, reversible removal** protects the two irreplaceable data classes GHL currently owns a path to: **commission-case lifecycle** and **consent opt-outs**. Both must have a native replacement proven *before* the GHL path is cut.
- **Export-before-freeze-before-delete-before-drop** keeps every intermediate state recoverable and every record accounted for (zero-data-loss).
- **Deferring schema drop** (D4) keeps reconciliation possible after the code is gone, so a late-discovered discrepancy can still be traced to its GHL origin.
- **Network-level proof** (D5) distinguishes "genuinely removed" from "hidden behind a disabled flag" — the flag (`ghlEnabled()`) already no-ops outbound calls, which is not the same as removal.

## Alternatives Considered

- **Flip `GHL_API_KEY` off and call it done** — rejected: leaves the inbound webhook, ~50 referencing files, hardcoded IDs, and the ID columns in place; not a decommission, and the commission-case/opt-out replacement is still missing.
- **Delete GHL code first, migrate data later** — rejected: destroys the opt-out capture path and the only pipeline→commission-case trigger before a replacement exists (TCPA + commission-integrity failure).
- **Drop columns and code in one PR** — rejected: irreversible loss of reconciliation provenance; violates the tested-rollback-before-destructive-change rule.

## Consequences

**Positive**
- A single native comms stack (FSOS + Twilio + Resend), no third-party CRM/automation dependency, no bidirectional sync to keep consistent.
- Commission-case creation and opt-out capture become first-class FSOS behavior with tests, not a webhook side effect.
- Auditable, reversible migration with a full zero-data-loss record.

**Negative / trade-offs**
- Multi-stage, multi-PR effort; each stage gated on evidence (reconciliation report, tested rollback) before the next may start.
- GHL provenance columns and two GHL tables linger (commented legacy) until the deferred D4 retirement.
- D1 must resolve the legacy-vs-spine table question (webhook writes `customers`/`commission_cases`; spine is `households`/`opportunities`/`cases`) — a reconciliation decision, documented in that slice.

## Related Documents

- CLAUDE.md §1, §3, §4.1, §4.2, §12; master build instruction §2 (D0–D5), §2.A, §2.B
- `docs/comms-ghl-migration/ghl-footprint-audit.md` (exact footprint)
- `docs/comms-ghl-migration/feature-parity-matrix.md` (§2.B — every GHL capability classified)
- `docs/comms-ghl-migration/implementation-plan.md` (slice sequence)
- `docs/ghl_integration.md`, `docs/legacy-mapping.md` (as-built GHL wiring + legacy→spine map)
- ADR-001, ADR-003, ADR-004, ADR-010, ADR-013
