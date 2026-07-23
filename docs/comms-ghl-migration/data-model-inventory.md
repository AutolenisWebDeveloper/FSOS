# Communications / CRM Data-Model Inventory

> Repo-grounded. Migrations live in `supabase/migrations/` (48 files, `001`–`048`). This is the
> schema reference for the reconciliation (ADR-013) and the delegation/consent/frequency
> extensions (§6–§10 of the brief).

## 1. The `comm_*` family (canonical — ADR-013)

Split across migrations **009** (base), **012** (approval/telemetry), **013** (sequences/audiences),
**033** (conversations/events/A-B), **035** (hours). No `comm_*` table carries a per-row tenant
column; scope is transitive through `household_id` / `member_id` / `agency_id` FKs + role RLS (§7).

| Table | Mig | Key columns / FKs |
|---|---|---|
| `comm_templates` | 009 + 012 | `id` PK; `name`, `channel(sms\|email)`, `category`, `body`, `approval_status(draft\|submitted\|approved)`, `version`. **012 approval cols:** `submitted_at`, `approved_at`, `approved_by(text)`, `updated_by(text)`, `archived_at`, `requires_optout(bool default true)`. |
| `comm_campaigns` | 009 + 012 + 033 | `id` PK; `name`, `status(draft\|active\|paused\|completed)`, FK `template_id→comm_templates`; 012: `channel`, `category`, `audience jsonb`, `schedule_at`, `quiet_hours_ack`, `activated_at`, `archived_at`; 033: `type(broadcast\|drip)`, `subject`, FK `sequence_id→comm_sequences`, `variants jsonb`, `ab_enabled`, `metrics jsonb`, `metrics_at`. |
| `comm_campaign_enrollments` | 009 + 012 + 033 | `id` PK; FK `campaign_id→comm_campaigns` (cascade), FK `household_id→households`, FK `member_id→household_members`; `status(enrolled\|sent\|suppressed\|opted_out\|completed)`; `unique(campaign_id, member_id)`; 012: `suppressed_reason`, `last_sent_at`; 033: `variant`, `current_step`, `next_send_at`, FK `agency_id→agency_partnerships`. |
| `comm_messages` | 009 + 012 + 033 | `id` PK; `channel`, `direction`, `recipient`, `body`, `delivery_status(queued\|sent\|delivered\|failed\|blocked\|received\|bounced\|complained)`, FK `template_id`, `campaign_id`, `entity_type/id`; 012 telemetry: `direction_ok`, `consent_at_send`, `blocked_step`, `block_reason`, `actor`, `provider_id`, `household_id`; 033: FK `conversation_id`, `member_id`, `agency_id`, `policy_id`, `subject`, `sender`, `provider`, `ai_generated`, `campaign_variant`, `sequence_step`, lifecycle timestamps. |
| `comm_conversations` | 033 | `id` PK; `unique(channel, contact)`; FK `member_id`, `household_id`, `agency_id` (set null); `subject`, `status(open\|snoozed\|closed)`, `is_security`, `assigned_user`, `ai_autoreply`, `last_message_at`, `last_direction`, `unread_count`. |
| `comm_message_events` | 033 | `id` PK; FK `message_id→comm_messages` (cascade), `conversation_id`, `campaign_id`; `event(queued\|sent\|delivered\|failed\|bounced\|complained\|opened\|clicked\|replied\|unsubscribed)`, `channel`, `detail`, `provider_id`. |
| `comm_sequences` | 013 | `id` PK; `name`, `channel(email\|sms)`, `category`, `steps jsonb([{delay_days, template_id, subject}])`, `status(draft\|active\|archived)`, `requires_optout(default true)`, `created_by`. |
| `comm_audiences` | 013 | `id` PK; `name`, `definition jsonb`, `estimated_size`, `created_by`. |
| `comm_hours_policy` | 035 | `id text PK default 'global'` (singleton); `enabled`, `start_hour`, `end_hour`, `days smallint[]`, `timezone_offset_hours numeric(4,1) default -6`, `is_assumption`, `check(end_hour>start_hour)`. |

## 2. The 006-vs-`comm_*` duplication (ADR-013 facts)

**Legacy `006_campaigns.sql`:**
- `campaigns`: `campaign_id` PK; `channel(email\|sms)`, `status(active\|paused)`, **`steps jsonb`
  inline** (`[{order, delay_days, subject, body}]`), `created_by`. `043` bolted on
  `template_id→comm_templates` (to pass gate step 4).
- `campaign_enrollments`: `enrollment_id` PK; FK `campaign_id→campaigns`, **FK
  `customer_id→customers`** (legacy customers, mig 001); `status(active\|completed\|stopped)`,
  `current_step`, `next_send_at`; `unique(campaign_id, customer_id)`.
- Self-contained; keyed to legacy `customers`; no template/sequence/event tables.

**Actual usage (grep):**
- **006 tables** → only `/api/campaigns/route.ts`, `/api/campaigns/enroll/route.ts`,
  `/api/campaigns/run/route.ts` + pure helper `campaign-run.ts`.
- **comm_* tables** → `lib/comms/campaign.ts`, `jobs/handlers.ts` (cron), `/app/comms/*` UI,
  `/api/comms/*`.

**Reconciliation target = `comm_*`.** The 006 engine is the deprecation surface (freeze → drain
live enrollments onto `comm_*` via `024`/`025` legacy provenance → retire routes → deferred drop).
The 009 migration deliberately avoided the name collision (`comm_campaign_enrollments`).

## 3. Consent, suppression, opt-out

**Two consent stores + one suppression list:**

| Table | Mig | Shape |
|---|---|---|
| `consent_ledger` | 001 | **Legacy, immutable event log.** `consent_id` PK; FK `customer_id→customers` (cascade); `channel(sms\|email\|voice)`; `status(opted_in\|opted_out\|pending)`; `recorded_at`; `source(form\|calendly\|manual\|api)`; `ip_address`; `notes`. RLS: service-role only. **The GHL webhook writes here.** |
| `consents` | 009 | **Spine, current-state — the gate reads this.** `id` PK; FK `member_id→household_members` (cascade), `household_id→households`; `channel(call\|sms\|email)`; `status(granted\|revoked, default granted)`; `source`; `disclosure`; `captured_at`; `unique(member_id, channel)`. |
| `dnc_entries` | 009 | **Suppression list.** `id` PK; `contact text` (phone/email); `channel(call\|sms\|email\|all)`; `scope(internal\|external, default internal)`; `reason`; `unique(contact, channel)`. |

**STOP/START flow** (`inbound.ts` + `keywords.ts`): STOP → upsert `consents` `revoked`
(`source:'inbound_stop'`) + upsert `dnc_entries` (`scope:'internal'`) + `audit_log`
`consent.revoked`. START reverses (delete `dnc_entries` + regrant `consents`).

**Net-new for §8:** consent is **per-channel only** today — there is no purpose dimension
(`TRANSACTIONAL_SMS`, `MARKETING_SMS`, `APPOINTMENT_REMINDERS`, `WORKSHOP_COMMUNICATIONS`, …). The
purpose-classification + preference-center work extends `consents`/`consent_ledger` with a purpose
axis; provider suppression syncs **into** FSOS (FSOS stays authoritative).

## 4. Ownership / tenant keys (delegation is net-new)

Spine ownership = nullable **`owner_scope uuid`** (owning FSA / book scope) + explicit `user_*`
linkage tables + role checks. No first-class multi-tenant or delegation key.

| Table | Ownership |
|---|---|
| `agency_partnerships` | `id` PK; **`owner_scope uuid`**, FK `district_id`; `owner_name(text)`. 023 adds `ghl_*`. **No delegation / represented-agent column.** |
| `agency_owners` | FK `agency_id→agency_partnerships`; `portal_user_id uuid`. Closest "person acting for an agency" — but models the *owner*, not a delegate. |
| `households` | `owner_scope uuid`; FK `referring_agency_id`; `do_not_contact`. |
| `household_members` | FK `household_id`; `dob_enc bytea`. Inherits household scope. |
| `household_policies` | `owner_scope uuid`; FK `household_id/carrier_id/product_id`; `is_security`, `ffs_case_ref`. |
| `user_agencies` | junction `(user_id, agency_partnership_id)`; drives `current_user_agencies()` RLS. |
| `contacts` (026) | `owner_scope uuid`; FK `household_id`, `agency_partnership_id`; `ghl_contact_id`. |

**§6 conclusion:** `AgencyCommunicationDelegation` cannot be folded into an existing
`agency_partnerships` column — it is genuinely net-new (new columns on `agency_partnerships` for
the simplest form, or a dedicated join table for the full model with permitted campaign
types/channels/segments/sender-identities/windows/status). The actual-sender-vs-represented-agent
fields (`actual_sender_user_id`, `represented_agent_id`, `represented_agency_owner_id`,
`contact_owner_id`, …) also have no existing home and extend `comm_messages`.

**IMPLEMENTED (Slice 1, migration 049 / ADR-015).** The join-table form was chosen:
`agency_communication_delegations` (`agency_id`, `agency_owner_id`, `representative_user_id`,
`permitted_campaign_types/channels/segments`, approved sender-identity/phone/email-domain
allow-lists, `effective_at`/`expires_at`, `status` DRAFT→ACTIVE→SUSPENDED→EXPIRED→REVOKED). The
distinct attribution columns (`actual_sender_user_id`, `represented_agent_id`,
`represented_agency_owner_id`, `represented_agency_id`, `contact_owner_id`,
`communication_operator_id`, `book_of_business_ref`, `delegation_id`) extend `comm_messages`
(nullable, additive). Unresolved ownership routes to the new `comm_assignment_reviews` queue.
Enforcement is a step inside the one gate (`delegation.ts` → `gate.ts` steps `ownership` +
`delegation`); resolvers are fail-closed in `ownership.ts`. `book_of_business_ref` maps to the
existing `households.owner_scope` — no parallel ownership key was added (ADR-013).

## 5. RLS + the CI firewall proof

RLS enabled on all core `comm_*` tables (`010` loop covers `comm_campaigns`, `comm_templates`,
`comm_campaign_enrollments`, `comm_messages`; `033` adds `comm_conversations`,
`comm_message_events`; `035` adds `comm_hours_policy`). `comm_sequences`/`comm_audiences` (013)
rely on default-deny + service-role writes.

**Pattern:** default-deny; reads via `SECURITY DEFINER` helpers in `010` (`has_role`, `is_super`,
`current_user_agencies`, `current_user_household`, keyed on `auth.uid()`); writes under
`service_role` after an app-layer RBAC assertion. Securities firewall is a **row rule** on
`household_policies` (`is_security=false` for clients).

**CI proof** (`.github/workflows/ci.yml` → `npm run test:rls` → `tests/rls-firewall.test.mjs`,
under `sudo`, `CI_REQUIRE_INFRA=1` so it hard-fails, not skips): stands up ephemeral Postgres,
applies 009/010/011/012/013/015, seeds a client + two households + life/securities/other-household
policies, and asserts (as the client role): securities policy hidden, other household's policy
hidden, own household only, and the same invariants through the `security_invoker` reporting views
(`v_conversions_due`, `v_policy_lapse_risk`, `v_pipeline_by_engagement` → 0 rows to a client).
**Never weaken this proof** (master build instruction §14.B / CLAUDE.md §13.13). Every new
`comm_*`/delegation table must ship with RLS + a proof extension.

## 6. Workshop comms tables (integrated at send path, separate at schema)

Every workshop send still goes through `lib/comms/*` (the gate) and writes a real `comm_messages`
row referenced by `workshop_message_log.comm_message_id`.

| Table | Mig | Shape |
|---|---|---|
| `workshop_message_templates` | 040 | `kind`, `channel`, `subject`, `body`, FK `comm_template_id→comm_templates` (gate handle), `status(placeholder\|draft\|approved)`, `is_assumption`, `unique(kind,channel,version)`. |
| `workshop_comms_config` | 040/041 | singleton `id='global'`; `reminder_offsets_minutes int[]`, score deltas, `sender_physical_address`, `left_early_threshold_minutes`, `enabled`. |
| `workshop_consent_events` | 038 | FK `registration_id→workshop_registrations`; `channel`, `action(granted\|revoked)`, `disclosure_text/version`, `ip_address`. **Workshop-scoped consent, separate from spine `consents`.** |
| `workshop_message_log` | 040 | idempotency ledger; FK `registration_id`, `session_id`; `status`, `gate_blocked_step`, `comm_message_id`; `unique(registration_id, channel, kind)`. |

The §12 workshop campaign-library work **integrates with this engine — does not duplicate it.**

## 7. GHL provenance columns

See [`ghl-footprint-audit.md`](./ghl-footprint-audit.md) §5. Summary: `ghl_contact_id` /
`ghl_opportunity_id` span legacy + spine tables; `ghl_stage_id` / `ghl_pipeline_id` are
**legacy-only** (`customers`/`agencies`); `ghl_activity_id` is legacy-only. `023_ghl_sync_native`
deliberately carried only `ghl_contact_id`+`ghl_opportunity_id` onto the spine (dropping
stage/pipeline provenance). All retained as legacy provenance in D3, dropped in the deferred D4.

## 8. Duplicate-logic report (migration-scoped)

| Duplication | A | B | Resolution |
|---|---|---|---|
| **Campaign/enrollment engine** | `006` `campaigns`/`campaign_enrollments` (legacy `customers`) | `009` `comm_campaigns`/`comm_campaign_enrollments` (spine) | ADR-013: canonical = `comm_*`; drain + retire 006. |
| **Consent store** | `consent_ledger` (001, legacy customers, event log) | `consents` (009, spine, current-state) + `dnc_entries` | **The gate enforces from `consents`/`dnc_entries` only — `consent_ledger` is never read by `send.ts`/`gate.ts`.** So D0 must migrate GHL opt-outs into `consents`/`dnc_entries` (member-resolved, fail-closed), NOT `consent_ledger`; the GHL-webhook's `consent_ledger` writes are reconciled in D1. Keep both roles; the §8 purpose axis extends both. |
| **Contact/customer** | legacy `customers` (001) | spine `households`/`household_members`/`contacts` (009/026) | Aggregate root = spine (ADR-001); legacy kept per `docs/legacy-mapping.md` C1–C6. |
| **Import path** | `/api/ghl/contacts/upload` (legacy) + `/api/app/contacts/upload` (spine) + `/api/admin/imports/ghl` (CSV→spine) | — | D3 retargets to the **native** `/app/contacts/import` + `/api/app/contacts/import`; no duplication. |

This report is **migration-scoped** (master build instruction §4) — it is not a general
technical-debt audit of the whole repo.

## 9. Dead-route report

No fully-dead comms routes were found — the `/api/comms/*` surface is live behind the UI, and the
legacy `/api/campaigns/*` is still reachable (frozen deprecation surface per ADR-013, not dead).
The GHL routes are **not** dead today (the webhook is load-bearing); they become removable only
after D0–D2. This report is refreshed at D3 to confirm every removed route 404s/redirects with no
inbound links (master build instruction §2 D3, §4 dead-route report).
