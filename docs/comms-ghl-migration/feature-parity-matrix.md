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
| 9 | **DND / opt-out capture** | `webhooks/ghl` `handleOptOut` → `consent_ledger` + `customers.consent_*` | **Replace** 🔨 **D0 + D1 (TCPA-critical)** | Native Twilio-STOP + Resend-unsubscribe already flow through `inbound.ts` → `consents` + `dnc_entries` + `audit_log`. D0 exports historical GHL opt-outs (`source='ghl_migration'`); D1 verifies coverage. | STOP suppresses immediately; Resend unsubscribe suppresses marketing email; **every GHL-migrated opt-out is present and honored after decommission** (dedicated test). | Replace |
| 10 | **Workflow automations (WF-0…WF-43)** | GHL UI workflows (tag/pipeline/lead_source triggers); `docs/ghl_workshop_workflows.md` | **Replace** 🔨 slices 5–12 | FSOS native campaign engine (`comm_campaigns`/`comm_sequences`) + cron + the campaign library (§12). These are not API-creatable in GHL; they move wholesale to FSOS-native. | Each equivalent journey runs as a native campaign/sequence with the gate enforced; simulation shows the path. | Replace |
| 11 | **Message templates** | GHL email/SMS templates | **Extend** ✅ | `comm_templates` with the approval workflow already exists (submitted/approved/archived/requires_optout). Library blueprints (§12) build on it. | Template requires approval before a campaign can use it; unapproved blocked at gate step 4. | Extend |
| 12 | **Workshops touchpoints** (lead push to Pipeline-A, nurture tags) | `workshops/server.ts`, `comms-engine.ts`, `reminders.ts` | **Extend** 🔨 D1/D3 | Native workshop comms engine already runs reminders/nurture through the gate (`workshop_message_log`). D1/D3 replace the GHL lead-conversion push with a native conversion signal; drop `ghl_opportunity_id` "converted" flag → native equivalent. | Workshop registrant conversion recorded natively; attendance analytics "converted" count matches pre-migration. | Extend |
| 13 | **Pipeline-stage display** (dashboard/scores/search/opra/agencies) | `ghlSummary()` reading `ghl_stage_id`/`ghl_pipeline_id` | **Replace / Remove** 🔨 D3 | Native opportunity stage becomes the display source; where no native equivalent, remove the stat gracefully (no dead UI). | Dashboard/search render native stage; no reference to `ghlSummary`; build green. | Replace |
| 14 | **AI Employee / voice** (referenced) | GHL AI Employee | **Remove** 📦 | Out of scope here; Retell AI env is present but unwired. No GHL dependency to preserve. | No GHL AI reference remains. | Remove |
| 15 | **Health/status tile** | `super/health` + `/api/health` `ghl_key` | **Remove** 🔨 D3 | Remove the GHL tile/flag; the health surface reflects Twilio/Resend only. | `/api/health` has no `ghl_key`; health page has no GHL tile. | Remove |

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
