# GoHighLevel Feature-Parity Matrix (§2.B)

> **Deliverable that gates D3.** Every GHL-provided capability, classified as exactly one of
> **Remove** (deliberately retired, justified), **Replace** (native FSOS implementation),
> **Extend** (folded into an existing FSOS implementation), or **Archive** (data retained,
> capability retired). **No capability may silently disappear.** This matrix must be approved as
> part of the D1 PR before D3 begins (master build instruction §2.B).
>
> Status legend: ✅ replacement already exists · 🔨 to build in the named slice · 📦 archive only.

| # | GHL capability | Where it lives (GHL side) | FSOS status | Replacement / target | Verification test | Final status |
|---|---|---|---|---|---|---|
| 1 | **Inbound contact sync** (ContactCreate/Update → upsert) | `webhooks/ghl` `handleContactUpsert` → `customers` | **Replace** 🔨 D1 | Native contact intake already exists via `/api/app/contacts/import` (spine) + inbound comms threading auto-associates contacts. D1 confirms coverage; no webhook needed post-cutover. | Import a GHL-exported contact via native importer → row in `contacts`/`households`; inbound SMS from unknown number → auto-created conversation/contact. | Replace |
| 2 | **Outbound contact sync** (`upsertContact`) | `ghl.ts`, `/api/ghl/sync*`, `GhlSyncButton` | **Remove** 🔨 D2/D3 | None — FSOS is the system of record; there is no external CRM to push to. Removing the push is the point. | `GhlSyncButton` gone; `/api/ghl/sync*` 404/redirect; build green. | Remove |
| 3 | **Contact / CSV import** | `/api/ghl/contacts/upload`, `GhlImportWizard`, `/api/admin/imports/ghl` | **Extend** 🔨 D3 | Retarget the native `/app/contacts/import` + `/api/app/contacts/import` (already spine-writing, AI column-mapped). No new importer. | Upload a CSV → rows land in `contacts`/`households`/`consents`; opt-out column honored. | Extend |
| 4 | **Custom fields** | `GHL_CUSTOM_FIELDS` map (`ghl.ts`), `ghlContacts.ts` aliases | **Archive** 📦 D3/D4 | Field-alias mapping folds into the native importer's column resolution (already present in `columnAI.ts`). The GHL field IDs themselves are retired. | Native importer maps aliased headers (e.g. "Mobile" → phone) correctly. | Archive |
| 5 | **Tags** | `addContactTags` (`ghl.ts`); `src-referral`, `src-event`, nurture tags | **Replace** 🔨 slices 5/12 | FSOS uses `comm_audiences` definitions + campaign enrollment + `activities` for segmentation instead of GHL tags. | Audience segment resolves the equivalent cohort; campaign enrolls it. | Replace |
| 6 | **Pipelines & stages** | `ghl.ts` ID map (Pipelines A/B/C, stage UUIDs) | **Replace** 🔨 D1 | Native opportunity/pipeline stages on the aggregate-root spine (`opportunities`) — the FSOS spine already models pipeline; D1 wires native stage transitions. | Stage transition on a native opportunity advances state and fires downstream logic (row 7). | Replace |
| 7 | **Commission-case creation on "Application Submitted" + issue-marking on "Issued"** | `webhooks/ghl` `handleOpportunityStage` (keyed on `ghl_opportunity_id`) | **Replace** 🔨 **D1 (critical)** | Native stage-transition service that creates a `commission_cases`/`cases` row at Application Submitted (idempotent) and marks issued at Issued. Only pipeline→case trigger — must exist before removal. | Move a native opportunity to Application Submitted → case created once (idempotent on retry); to Issued → case marked issued; securities opp → firewalled, no auto-case. | Replace |
| 8 | **Appointment creation → activity log** | `webhooks/ghl` `handleAppointment` → `activity` | **Replace** 🔨 D1 | Native appointment logging. Calendly webhook (`CALENDLY_WEBHOOK_SECRET`) already replaces GHL calendar/booking; D1 confirms appointment activity is logged natively. | Book via Calendly → `activity`/`appointments` row logged; appointment-confirmation campaign (slice 12) can fire. | Replace |
| 9 | **DND / opt-out capture** | `webhooks/ghl` `handleOptOut` → `consent_ledger` + `customers.consent_*` | **Replace** 🔨 **D0 + D1 (TCPA-critical)** | Native Twilio-STOP + Resend-unsubscribe already flow through `inbound.ts` → `consents` + `dnc_entries` + `audit_log`. **D0 migrates historical GHL opt-outs into the enforcement stores `consents` (revoked, per channel) and/or `dnc_entries` — NOT `consent_ledger`**, which `send.ts`/`gate.ts` never read (`consents` is member-keyed, so resolve GHL contact → member; unresolvable opt-outs **fail closed** to `dnc_entries`). `source='ghl_migration'`, timestamps preserved. D1 verifies coverage. | STOP suppresses immediately; Resend unsubscribe suppresses marketing email; **every GHL-migrated opt-out is enforced THROUGH `evaluateGate`** (the gate blocks the send — a row existing proves nothing) after decommission (dedicated test). | Replace |
| 10 | **Workflow automations (WF-0…WF-43)** | GHL UI workflows (tag/pipeline/lead_source triggers); `docs/ghl_workshop_workflows.md` | **Replace** 🔨 slices 5–12 | FSOS native campaign engine (`comm_campaigns`/`comm_sequences`) + cron + the campaign library (§12). These are not API-creatable in GHL; they move wholesale to FSOS-native. | Each equivalent journey runs as a native campaign/sequence with the gate enforced; simulation shows the path. | Replace |
| 11 | **Message templates** | GHL email/SMS templates | **Extend** ✅ | `comm_templates` with the approval workflow already exists (submitted/approved/archived/requires_optout). Library blueprints (§12) build on it. | Template requires approval before a campaign can use it; unapproved blocked at gate step 4. | Extend |
| 12 | **Workshops touchpoints** (lead push to Pipeline-A, nurture tags) | `workshops/server.ts`, `comms-engine.ts`, `reminders.ts` | **Extend** 🔨 D1/D3 | Native workshop comms engine already runs reminders/nurture through the gate (`workshop_message_log`). D1/D3 replace the GHL lead-conversion push with a native conversion signal; drop `ghl_opportunity_id` "converted" flag → native equivalent. | Workshop registrant conversion recorded natively; attendance analytics "converted" count matches pre-migration. | Extend |
| 13 | **Pipeline-stage display** (dashboard/scores/search/opra/agencies) | `ghlSummary()` reading `ghl_stage_id`/`ghl_pipeline_id` | **Replace / Remove** 🔨 D3 | Native opportunity stage becomes the display source; where no native equivalent, remove the stat gracefully (no dead UI). | Dashboard/search render native stage; no reference to `ghlSummary`; build green. | Replace |
| 14 | **AI Employee / voice** (referenced) | GHL AI Employee | **Remove** 📦 | Out of scope here; Retell AI env is present but unwired. No GHL dependency to preserve. | No GHL AI reference remains. | Remove |
| 15 | **Health/status tile** | `super/health` + `/api/health` `ghl_key` | **Remove** 🔨 D3 | Remove the GHL tile/flag; the health surface reflects Twilio/Resend only. | `/api/health` has no `ghl_key`; health page has no GHL tile. | Remove |

### Hardcoded GHL identifiers & code constants (not env vars — D3/D5 removal line items)

The brief lists nine "env vars"; only three are real env vars (`GHL_API_KEY`, `GHL_LOCATION_ID`,
`GHL_WEBHOOK_SECRET`). The rest are **TypeScript constants and hardcoded identifiers** in
`src/lib/ghl.ts` / `src/lib/validation/schemas.ts`, each a distinct removal target the D5 proof
must search for **by name and by value** (not just env-var names):

| # | Identifier / constant | Where | FSOS status | Replacement | Verification test | Final status |
|---|---|---|---|---|---|---|
| 16 | Hardcoded location ID `ATDNO1e5d27nj5t8vId3` (`GHL_LOCATION_ID_DEFAULT`) | `ghl.ts:16` | **Remove** 🔨 D3 | none (single-tenant FSA identity is implicit) | `grep -r "ATDNO1e5d27nj5t8vId3"` → empty. | Remove |
| 17 | Pipeline/stage ID maps `PIPELINE_PROSPECT_CLIENT`/`PIPELINE_AGENCY_OWNER`/`PIPELINE_TERM_CONVERSIONS`, `APPLICATION_SUBMITTED_STAGE_IDS`, `ISSUED_STAGE_IDS` + the stage UUIDs | `ghl.ts:43–153` | **Replace** 🔨 D1/D3 | Native opportunity stages (row 6/7); the stage→case classifier moves to the native stage-transition service. | `grep -rE "nuOBjRl27uhinHChdqfH\|f7be8411-\|663763b9-"` → empty; native stage transition creates the case (row 7 test). | Replace |
| 18 | `GHL_CUSTOM_FIELDS` map | `ghl.ts:204` | **Archive** 📦 D3 | Field-alias resolution in the native importer (row 4). | `grep -r "GHL_CUSTOM_FIELDS"` → empty; importer maps aliased headers. | Archive |
| 19 | `GHL_PIPELINE_KEY`, `GHL_SYNC_ENTITY` | `schemas.ts:980–981` | **Remove** 🔨 D3 | none (sync request schema retired with `/api/ghl/sync*`). | `grep -rE "GHL_PIPELINE_KEY\|GHL_SYNC_ENTITY"` → empty. | Remove |
| 20 | `GHL_API_BASE`, `GHL_API_VERSION` | `ghl.ts:240–241` | **Remove** 🔨 D3 | none (the sole outbound origin is deleted with `ghlFetch`). | `grep -rE "leadconnectorhq\|GHL_API_BASE\|2021-07-28"` → empty. | Remove |

Capabilities #4 (custom fields), #5 (tags), and #6 (pipelines/stages) above cover the *behaviors*;
#16–#20 cover the *code artifacts* that implement them, so D3 removal and the D5 proof each have
concrete, named targets.

## Data preservation (row-count + checksum scope — §2.A)

Before **and** after every destructive phase, produce a row-count + checksum report over at
minimum: `contacts`, `households`, `household_members`, `household_policies`, `agencies`,
`agency_owners`, `agency_partnerships`, referrals, opportunities, `commission_cases`,
`commissions`, `activity`, appointments, `comm_messages`, `comm_conversations`,
`comm_message_events`, `comm_templates`, `comm_campaigns`, `comm_campaign_enrollments`,
`comm_audiences`, `comm_sequences`, the workshop tables, documents/files, `consents`,
`consent_ledger`, and audit tables. Counts/checksums must match before/after **except** documented
intentional changes (GHL-import additions; provider-reference retargeting). Any unexplained delta
halts the migration.

## Integrity gates (every migration)

Zero orphaned contacts/households/opportunities/campaigns/enrollments/messages/conversations/
workshop-records/commission-cases/referrals; zero broken FKs; zero NULL ownership where required.
Rollback SQL + verification queries + executed rollback test + estimated duration + verified backup
for every migration (master build instruction §2.A / §14.B).

## Approval

- [ ] Matrix reviewed and approved as part of the **D1 PR** — required before **D3** begins.
