# FSOS Voice Agent — Repository Map

Discovery session, 2026-10-05. Branch `claude/voice-agent-repo-discovery-xvohhl` (base `804222f`).
Maps `docs/voice/voice-agent-plan.md` and `docs/voice/voice-agent-build-checklist.md` against the
FSOS code and the live Supabase/Vercel projects. **No application code was written.**

## How to read this

| Label | Meaning |
|---|---|
| **VERIFIED** | Seen in the repo at the cited `file:line`, or returned by a live read-only query in this session |
| **ASSUMPTION** | Inferred from verified evidence; not directly observed |
| **UNVERIFIED** | Not checked, or could not be checked; treat as unknown |

Status per plan item: **EXISTS** (path) · **PARTIAL** (what is missing) · **MISSING**.

Line numbers are as of base `804222f`. A claim sourced from a migration file is about the repo; a
claim about the live database says "live" and came from a read-only query against Supabase project
`supabase-FSOS` (`ynxaqeejjmeilpwmuuie`). Vercel facts came from the Vercel API for project `fsos`.

**Not checked (UNVERIFIED):** the live Twilio account (numbers, Messaging Service, A2P brand/campaign
status, voice capability). The `twilio` MCP server failed to connect, and the other Twilio tool only
searches documentation. Env values were not read anywhere (`.env*` is off limits); only the
variable names in `.env.local.example` were.

---

## 1. Summary: the plan conflicts with the code in five structural ways

The plan and checklist were written from a spec, not this repo (checklist line 13 says so). Five
conflicts change the design, not just names. Each needs an owner decision before Stage 0. Full list
in §12.

1. **`sendThroughGate` no longer exists.** It was retired. The single send path is now
   `sendSms`/`sendEmail` in `src/lib/messaging.ts`. That path is hard-closed to `sms | email` in
   about 25 TypeScript types and 15 SQL CHECK constraints, and it has no voice provider call. Adding
   `voice_ai` means extending this chokepoint (new deps function, gate, DNC and consent reads, and
   migrations), not adding a channel string. (VERIFIED, §2)
2. **The `term_conversion` and `marketing_automation` agents do not decide who to contact.** Owner
   decision 7 (2026-10-02) handed term conversion, cross-sell and win-back to the campaign engines;
   those workforce agents now stand down (`src/lib/ai/outreach.ts:30-42`). The plan's agent model,
   where the agents emit outreach intents, contradicts a recorded owner decision. (VERIFIED, §3)
3. **FSOS has no offices, no district operator, and no agency tenancy.** It serves one FSA in
   McKinney, TX. "Agency" means a partner Farmers agency (B2B2C), not a tenant. Nothing in the code
   or docs refers to "Round Rock", "Georgetown", an office, or an agency-ID JWT claim. Every
   per-office control in the plan (flags, canary, spend caps, concurrency, ring groups, porting) has
   nothing to attach to. (VERIFIED, §6)
4. **The `voice` schema would duplicate the consent and audit stores.** The plan's
   `voice.consent_records` and `voice.audit_log` would be a second consent store and a second audit
   trail. FSOS already has authoritative ones (`consents` + `comm_consent_purposes` +
   `comm_contact_consents` + `dnc_entries`; `audit_log` via `writeAudit`). CLAUDE.md forbids
   building a second system. (VERIFIED, §5)
5. **Calling hours: the plan would widen what the code allows.** The plan's Texas rule allows calls
   until 9 PM. FSOS has a hard-coded 9:00–20:00 recipient-local floor that "an operator window may
   narrow, never widen" (CLAUDE.md; `src/lib/compliance/guardrail.ts:65-68`). Separately, under
   today's code an appointment-purpose call would be **exempt** from quiet hours
   (`src/lib/comms/purpose.ts:78-100`). (VERIFIED, §2.4)

Other conflicts are material but local: the AI gateway seam versus an external orchestrator, no
streaming, no external "policy system", no national DNC or reassigned-number check, no dark mode,
no mobile or push, a global (not per-office) flag table, and drift between the live database and
the repo. All are in §12.

---

## 2. `sendThroughGate` → the dispatch chokepoint

**Where it lives.** `sendThroughGate` does not exist in `src/`. **VERIFIED.** The only mentions
are historical comments: `src/lib/messaging.ts:6`, `src/lib/comms/dispatcher.ts:7`,
`src/lib/comms/dispatch-policy.ts:6`, and migration comments (e.g. `087_comms_console.sql:10`).
`messaging.ts:5-10` explains why: Phase A found 18 callers going through `sendThroughGate` and 9
sending around it, so enforcement moved into the provider call itself.

### 2.1 Signatures (VERIFIED)

| Function | Location | Signature |
|---|---|---|
| `sendSms` | `src/lib/messaging.ts:454` | `(to, body, correlationId?, opts?: SmsSendOptions, deps = defaultMessagingDeps): Promise<SendResult>` |
| `sendEmail` | `src/lib/messaging.ts:372` | `(to, subject, html, text?, opts?: EmailSendOptions, deps = defaultMessagingDeps): Promise<SendResult>` |
| `dispatch` (thin forwarder) | `src/lib/comms/dispatcher.ts:105` | `(req: DispatchRequest): Promise<DispatchResult>`. `req.channel: 'sms' \| 'email'` (:34) |
| `sendMessage` (domain entry) | `src/lib/comms/send.ts:20` | Called by booking, campaign engines and workforce, then `dispatch` |
| `resolveDispatchPolicy` | `src/lib/comms/dispatch-policy.ts:497` | `(ctx: DispatchPolicyContext, deps?, now?): Promise<DispatchPolicyDecision>`. Resolves consent, DNC, suppression, timezone and A2P fresh |
| `evaluateGate` (pure) | `src/lib/comms/gate.ts:270` | `(input: GateInput): GateResult` (CLAUDE.md cites `:252`; the line has drifted) |
| Provider seam | `src/lib/messaging.ts:146-164` | `MessagingDeps { resolvePolicy, escalate, auditSent, deliverEmail, deliverSms, recordCarrierOptOut }` |
| Send audit | `src/lib/comms/escalation.ts:105,139` | `escalateBlockedSend` writes `compliance_events`, `agent_actions` and `audit_log`; `auditSentMessage` writes `audit_log` (`comms.sent`) |

Gate evaluation order (`gate.ts:281-374`): message_content → ownership → consent → non_us_recipient
→ timezone_unresolved → quiet_hours → delegation → dnc → suppression → approved_template →
personalization → recommendation → is_security → data_confidence → ai_authority → other_rule →
sms_live → business_hours → window_misconfigured → configured_window → frequency → collision.
Deferral steps (retried, not escalated): `gate.ts:389-395`. **VERIFIED.**

### 2.2 Current channels: `sms` and `email` only (VERIFIED)

- The gate rejects any other channel: `gate.ts:281-283` blocks it with `Unsupported channel`.
- The only Twilio REST call is `Messages.json` (`messaging.ts:253`). Searches for `calls.create`,
  `Calls.json`, `VoiceResponse`, `<Dial>`, `<Say>`, ConversationRelay and `/voice` routes found
  nothing.
- **TypeScript unions closed to `'sms' | 'email'`:** `dispatch-policy.ts:41`, `purpose.ts:48`,
  `gate.ts:37`, `dispatcher.ts:34`, `escalation.ts:25`, `a2p.ts:27`, `contact-consent-read.ts:24`,
  `conversations.ts:11`, `identity.ts:21`, `opt-out.ts:31,311`, `stop-fanout.ts:76`,
  `frequency.ts:37`, `delegation.ts:35`, `ownership.ts:27,148,227`, `simulation-core.ts:15`,
  `capture-transport.ts:25`, `messaging.ts:337,354`, and others in `src/lib/comms/`.
- **SQL CHECKs closed to sms/email:**
  - `comm_messages` (`009:372`; live CHECK confirmed)
  - `comm_templates` (`009:339`)
  - `comm_conversations` (`033:33`)
  - `comm_sequences` (`013:71`)
  - `comm_consent_purposes` (`055:43`; live confirmed)
  - `agent_daily_targets` / `outreach_queue` (`034:27,62`)
  - `booking_notification_deliveries` (`093:32`)
  - `comms_test_recipients` (`087:48`)
  - the workshop message tables (`040:102,171`)
- **Already allow `call`:** `consents.channel` (`009:138`), `dnc_entries.channel` (`009:151`, plus
  `all`), and `comm_contact_consents.channel` (`074:49`; live confirmed). The send path reads none
  of them for calls. `isOnDNC` only checks `['sms','all']` or `['email','all']`
  (`contact-consent-read.ts:143-158`), so a `call` DNC row blocks nothing today.

### 2.3 How `voice_ai` can be added without a second send path (ASSUMPTION: proposal, not built)

`MessagingDeps` already isolates the provider call, so the code supports one chokepoint for
voice:

1. Add `placeCall(args)` to `MessagingDeps` (`messaging.ts:146`), and add `startVoiceCall(to, callSpec,
   correlationId?, opts?, deps)` in `messaging.ts`. It would copy the `sendSms` sequence:
   `resolvePolicy` → withhold or escalate → config → `deps.placeCall` → `auditSent`. Add a third
   branch to `dispatch()` (`dispatcher.ts:133-143`).
2. Widen `Channel` to `'sms' | 'email' | 'voice_ai'` at the sites listed in §2.2. The gate's
   `message_content` step validates the approved opening-script text as `draft`.
3. Make `isOnDNC` read `['call','all']` for voice. Make consent read `consents.channel='call'` plus
   new voice consent purposes (§5.2).
4. Quiet hours: `quietHoursApply` (`purpose.ts:96-100`) exempts `APPOINTMENT`/`TRANSACTIONAL`.
   For `voice_ai` it must always apply (§2.4).
5. Gate `smsLiveFor` (`a2p.ts:27`) is SMS-specific. Voice needs its own readiness signal (e.g. an
   `automation_switches` key).
6. New migrations to widen the CHECKs on `comm_messages`, `comm_templates`, `comm_conversations` and
   `comm_consent_purposes`, or a decision to log calls in a separate call table and keep
   `comm_messages` messaging-only.

**Constraint from Twilio's call model (ASSUMPTION):** placing a call returns before the
conversation happens. Once connected, the orchestrator speaks turn by turn. The gate therefore
protects the **dial** and its opening script. In-call text is governed by the playbook,
firewall and output guard, not by `evaluateGate` per utterance. The plan already assumes this
split ("gate at dial time").

### 2.4 Calling windows and quiet hours (VERIFIED)

| Topic | Code | Plan |
|---|---|---|
| Floor | 9:00–20:00 recipient-local, every day (`guardrail.ts:65-68`; `quiet-hours-window.ts:52-56`). CLAUDE.md: "may narrow it, never widen it" | Texas 9 AM–9 PM Mon–Sat, noon–9 PM Sun |
| Sunday | Marketing-class SMS held until 12:00 local (`purpose.ts:102-110`; `quiet-hours-window.ts:197-206`, "owner decision 2 … counsel to confirm") | noon Sunday |
| Timezone | Caller zone → ZIP → area code. If they disagree, the send must fall inside the window in both; if neither resolves, every continental US zone (`dispatch-policy.ts:421-487,624-643`) | "area code and address, stricter wins": **matches** |
| Exempt purposes | TRANSACTIONAL, APPOINTMENT, APPLICATION_STATUS, DOCUMENT_REQUEST skip quiet hours (`purpose.ts:78-83`) | Reminders: "0 calls outside calling windows" |
| US-only | `non_us_recipient` for automated SMS (`dispatch-policy.ts:721-723`; `recipient-timezone.ts:569-586`) | Not stated for voice |

Applying the code rules to voice means the 20:00 cap wins and voice may not be exempted. **No
21:00 rule exists anywhere.** VERIFIED.

### 2.5 DNC, suppression, STOP (VERIFIED)

- **STOP.** Keywords are at `keywords.ts:8,16`. `recordChannelOptOut` (`opt-out.ts:157`):
  1. upserts `dnc_entries` with scope internal;
  2. inserts a revoke into `comm_contact_consents`;
  3. revokes `consents`;
  4. revokes **every** `comm_consent_purposes` row on that channel.

  Scope is the channel, across **all purposes**. Enrollments are terminated via
  `stop-fanout.ts:28`. Carrier error 21610 goes to `recordCarrierOptOut` (`opt-out.ts:248`).
- **Business suppression** (`suppression.ts:122`) covers agency and client levels. It is skipped for
  transactional purposes (`:48-50`).
- **National DNC registry:** **MISSING.** `dnc_entries.scope` allows `'external'` (`009:152`), but
  no code loads or queries an external list.
- **Reassigned Numbers Database:** **MISSING.**

---

## 3. How `term_conversion` and `marketing_automation` produce work today (VERIFIED)

**Neither agent decides who to contact.** `src/lib/ai/outreach.ts:30-37`, verbatim:

> "Owner decision 7 … the CAMPAIGN ENGINES own automated sends for term conversion (Life Conversion),
> cross-sell (Cross-Sell Life) and win-back (Pipeline Win-Back). The workforce agents for those
> audiences STAND DOWN … This differs from the operating documentation that routes these audiences
> through the term_conversion / marketing_automation agents."

| Plan name | What it is in code | What actually picks the audience and sends |
|---|---|---|
| `term_conversion` | Roster key, surface `engine_owned` (`roster.ts:55,102`). Workforce queue and dispatch skip it (`workforce.ts:361,427-434`). Also the AI **reply** key on Life Conversion threads (`life-campaign/tick.ts:27`) | **Life Conversion engine:** `life_campaigns` / `_touches` / `_enrollments` / `_executions` (`081:29-118`). Audience is `v_conversions_due` (`012:313-341`), enrolled in `life-campaign/tick.ts:223,262`. Each touch sends an approved template via `sendMessage` (`tick.ts:368-399`) with purpose forced to MARKETING (`:103`) |
| `marketing_automation` | Roster key, `active` (`roster.ts:59`): "Run approved campaigns when the gate passes". Used as the actor on generic campaign dispatch | `comm_campaigns` dispatch and `comm_campaign_enrollments` / `comm_sequences` drip (`src/jobs/handlers.ts:143-154,166-277`) |
| `cross_sell` audience | Roster key `engine_owned` (`roster.ts:48`) | **Cross-Sell Life engine:** `xsell_life_*` (`085:40-172`). Audience `v_cross_sell_gaps` (`012:261`); enroll at `cross-sell-life/enroll.ts:73,91`; send at `tick.ts:277` |
| `winback` audience | `life_winback` `engine_owned` (`roster.ts:54`; the old `marketing_automation` win-back seed was renamed in `090:32-39`) | **Pipeline Win-Back engine:** `pipeline_winback_*` (`083:32-127`). Audience `v_pipeline_winback_due` (`083:168-232`); send at `tick.ts:317` |
| Workshop lists | — | Workshop comms engine (`src/lib/workshops/comms-engine.ts`) |

- **Touch kinds.** Each engine's touch rows have a `kind` CHECK that includes `email`, `sms`,
  `ai_conversation` and `advisor_outreach` (`081:63,107`; `083:71,116`; `112:50,90`).
  ASSUMPTION: an `ai_voice` touch kind is the natural place for an "outreach intent" to come from.
- **Schedules.** Engines tick hourly 17–23 UTC (`vercel.json`). `conversion-watch` runs at 09:00 and
  only writes an `activities` row (`handlers.ts:53-66`). `outreach_queue` (`034:62`) exists, but
  only `referral_followup` fills it (`workforce.ts:292-327`).
- **Outreach intent / `createOutreachIntent`:** **MISSING.** Nothing like it exists.

---

## 4. Calendar source and booking API (VERIFIED)

The source of truth is the FSOS `appointments` table. Google Calendar is read-only free/busy
(`072_booking_calendar_connection.sql:10`: "NEVER writes appointments back"). Zoom only makes
meeting links (`src/lib/zoom/client.ts`).

| Concern | Where |
|---|---|
| Tables | `appointments` (`009:436-445`, extended in `069`, `048:22`, `093:23`, `121:20`); `appointment_types` (notice, lead days, buffers, `max_per_day`, interval, mode, `host_user_id`); `availability_rules`; `availability_blackouts` (`069`); `booking_calendar_connections` (`072`); `booking_reminder_config` (`093:46`); `booking_notification_deliveries` (`093`) |
| Availability | `computeAvailableSlots` (pure, `src/lib/booking/availability.ts:169`); `computeSlotsForType` (`slots.ts:58`) |
| Book | `bookAppointment(input, now)` (`book.ts:91`): a public-flow function (`actor: 'public'`); result is `not_found \| unavailable \| taken \| error` |
| Reschedule / cancel | `rescheduleAppointment` (`manage.ts:126`, guarded UPDATE + `schedule_version` bump); `cancelAppointment` (`manage.ts:89`); signed manage tokens (`manage-tokens.ts:42,51`) |
| Status changes | `setAppointmentStatus` (`src/lib/appointments/service.ts:35`): no_show → `no_show_followup` notice, completed → recap, cancelled → cancellation |
| Double-booking | Enforced by the database: unique `(host_user_id, starts_at)` where scheduled (`069`); GiST exclusion `excl_appointments_host_overlap` (`091_appointments_overlap_exclusion.sql:38`); null-host variants (`119`). 23505/23P01 → `taken` (`insert-errors.ts:25-29`) |
| Routes | Public: `GET /api/public/booking/availability`, `POST /api/public/booking`, `GET/POST /api/public/booking/manage` (rate-limited, Zod). Staff: `PATCH /api/app/appointments/[id]`, `…/[id]/reschedule`, `POST /api/app/appointments/recovery`, plus `/api/app/booking/{types,rules,blackouts,calendar,provision-zoom}` |
| Reminders | Cron `/api/cron/booking-reminders` every 15 min (`vercel.json:27`). Offsets `{1440,720,60}` in repo `137`; **live shows `{1440}`** (137 not applied, §9). Sends go through `sendMessage` → `dispatch` → `sendSms`/`sendEmail` (`notify.ts:23`) |
| Statuses | `scheduled, completed, cancelled, no_show` only (`009:441`) |

**Gaps against the plan:**
- **MISSING:** a `confirmed` status, `confirmAppointment`, and an authenticated (non-public)
  booking function.
- **MISSING:** automatic no-show detection. `runNoShowRecovery` (`service.ts:211`) only creates tasks,
  only on a manual POST, and is not on a cron.
- **MISSING:** a slot hold/lock. ASSUMPTION: the DB exclusion constraint already covers
  double-booking.
- **MISSING:** a "licensed-rep time" concept. Hosts exist (`host_user_id`), but `config.ts:7-9`
  says "single-practice FSOS".
- **Rule mismatch:** `max_per_day` is counted across all of the host's appointments
  (`slots.ts:84-90,109`), not per type as the `069` column comment says.

---

## 5. Contact, consent, task, note and audit tables

### 5.1 People (VERIFIED)
- `contacts` (`026_contacts.sql:18-48`): name, email/phone with dedupe keys, `contact_type`,
  address/zip, `household_id`, `agency_partnership_id`, `owner_scope`; `dob` and `custom` (`096`).
- `households` (`009:84-96`): `referring_agency_id`, `zip`, `do_not_contact`.
- `household_members` (`009:98-108`): phone, email, `dob_enc`; `source_contact_id` (`071:36`).
  Consents key on `member_id`.
- `customers` (`001:43`): legacy.
- **No timezone column** on any person table. The zone is resolved per send and stored on
  `comm_messages.resolved_timezone` (`123:62-65`).
- **Trusted contact: MISSING.**

### 5.2 Consent (VERIFIED; live tables and CHECKs confirmed)

| Table | Holds | Voice-relevant |
|---|---|---|
| `consents` (`009:134-146`) | Spine store the gate enforces: `member_id`, `channel in (call,sms,email)`, granted/revoked, `source`, `disclosure`, `captured_at`; unique per member+channel | Has `call`; **no purpose, no PEC/PEWC basis, no evidence fields** |
| `comm_consent_purposes` (`055:39-56`) | Purpose-scoped consent with `revoked_at`. Purposes: TRANSACTIONAL_SMS, MARKETING_SMS, TRANSACTIONAL_EMAIL, MARKETING_EMAIL, APPOINTMENT_REMINDERS, SERVICE_NOTIFICATIONS, WORKSHOP_COMMUNICATIONS, BIRTHDAY_COMMUNICATIONS | **sms/email only**; no voice purpose |
| `comm_contact_consents` (`074:43-63`, `+135:36-38`) | TCPA evidence log: consent text and version, source URL, IP, UA, referral, member, appointment, contact | **Allows `call`**; the best fit for PEWC evidence |
| `dnc_entries` (`009:148-156`, `+138` lifted_at, not live) | Internal/external DNC by channel incl. `call`/`all` | `call` rows never read (§2.2) |
| `comm_agency_suppressions`, `comm_client_suppressions` (`115`) | Business suppression | No channel column |
| `workshop_consent_events` (`038:217-227`) | Workshop disclosure evidence | sms/email only |
| `consent_ledger` (`001:162`) | Legacy, "append-only evidence, never enforcement" (`055:22`) | — |

- Message purposes (`purpose.ts:13-23`): MARKETING, TRANSACTIONAL, SERVICING, APPOINTMENT,
  RELATIONSHIP, BIRTHDAY, WORKSHOP, APPLICATION_STATUS, DOCUMENT_REQUEST, POLICY_DEADLINE.
- These map to consent purposes via `purposeToConsentPurpose` (`:119-145`).
- There is no "informational vs telemarketing" axis and no PEC/PEWC distinction.
- **A table named `consent_records`: MISSING.** Adding one would be a second consent store.

### 5.3 Tasks, notes, activity (VERIFIED)
- `work_tasks` (`009:422-434`, `+011:38`): spine tasks with `entity_type/id`, `assignee`,
  `source in (manual,workflow,agent)`, `due_at`. No-show recovery writes here.
- `tasks` (`005`): legacy, RLS on with no policy.
- `notes` (`097:26-36`): household notes, editable, soft-delete.
- `activities` (`009:410-418`): immutable system-event stream (`097:7-8`).

### 5.4 Audit (VERIFIED; live triggers confirmed)
- `writeAudit(entry)` (`src/lib/audit/log.ts:75`) inserts into `audit_log` (`009:560-568`:
  actor, action, entity, entity_id, diff, at). `AuditAction` is a closed list (`log.ts:12-40`).
  It is best effort and never throws.
- **Append-only.** UPDATE/DELETE are revoked and the trigger `trg_audit_log_no_mutate` blocks them
  (`010:73-85`). Only the service role may insert (`077:26-27`). TRUNCATE is blocked (`077:30-41`).
  Live: both triggers present.
- **Hash chain: MISSING.**
- Write-once archive (object lock): **MISSING.**
- `legal_holds` (`013:127`): EXISTS.

---

## 6. Supabase: auth claims, RLS pattern, migration tooling

**Tenancy and auth (VERIFIED):**
- **Roles** (`src/lib/auth/rbac.ts:12-21`): super_admin, fsa, licensed_staff, admin, ops,
  case_manager, compliance, supervisor, agency_owner, client.
- **Role sources:** the JWT `app_metadata.roles` (`session.ts:41`) for the app, and the `user_roles`
  table (`009:573-578`) for RLS.
- **`agency_id` claim: MISSING.** No JWT agency claim exists. Partner scoping goes through
  `user_agencies` (`009:580-585`) and `current_user_agencies()` (`010:32-35`).
- **Single tenant by design:** "not tenant-scoped (single-FSA book; recorded in the
  pre-multi-tenant ledger)" (`097_contact_notes.sql:20`).
- **Office / district operator: MISSING.** There is no office table or `office_id`. A search of
  `.md` files outside `docs/voice/` found "Round Rock" and "Georgetown" nowhere. `regions` and
  `districts` (`009:22-35`) describe Farmers agency geography for the partner network, not FSOS
  operating units.

**RLS pattern (VERIFIED):**
- RLS is enabled default-deny, with SELECT-only role policies via SECURITY DEFINER helpers
  `current_user_roles()`, `has_role()`, `is_super()`, `current_user_agencies()` and
  `current_user_household()` (`010:17-40`).
- Examples: `hh_read` (`010:118-124`), `ref_read` (`010:143-148`, agency_owner limited by
  `current_user_agencies()`), `contacts_read` (`026:80-84`).
- **Writes** go through `getDb()`, the service role (`src/lib/supabase/client.ts:34`), after
  `requireApiRole` (`src/lib/auth/api.ts:33`).
- `getBrowserDb()` (`:64`) uses the anon key.

**Schemas (VERIFIED live):**
- Everything is in `public`. No migration runs `CREATE SCHEMA`.
- Live schemas: `auth, cron, extensions, graphql, graphql_public, public, realtime, storage,
  supabase_migrations, vault`.
- No tables named `calls`, `call_*`, `voice_*`, `dispositions`, `transfers`, `playbooks` or
  `outreach_intents`.
- `pg_cron` is installed (`001:10`).

**Migration tooling (VERIFIED):**
- Files are `supabase/migrations/NNN_name.sql`: 143 files, with duplicate prefixes at 091, 093,
  097, 105 and 109. There is no `supabase/config.toml`.
- Runner: `scripts/migrate.mjs` applies files in lexical order, one transaction each, and records
  them in **`public.schema_migrations`**.
- Forward-only. 32 files document a rollback in comments (e.g. `091:31`, `077:44`). There are no down
  migrations.
- `.claude/hooks/block-danger.sh` blocks edits to existing migrations.
- **RLS tests:** `npm run test:rls` builds an ephemeral Postgres and applies the chain
  (`scripts/run-tests.mjs:25-62`; e.g. `tests/rls-firewall.test.mjs`).

**Live state (VERIFIED by query, 2026-10-05):**
- `public.schema_migrations` records 131 files. The last two are `135`, `136`, applied
  2026-08-31.
- **137–141 are not applied live.** Evidence: `automation_switches` (140) is absent;
  `dnc_entries.lifted_at` (138) is absent; `booking_reminder_config.offsets_minutes` is `{1440}`
  rather than 137's `{1440,720,60}`.
- Every other table the repo creates exists live.
- `supabase_migrations.schema_migrations` holds only 14 rows, so the CLI history is not the record.

---

## 7. Design tokens, component library, dark mode (VERIFIED)

- **Tokens:** HSL CSS variables in `src/app/globals.css` (`:root` from line 15), mapped in
  `tailwind.config.ts:25-214`. Documented in `DESIGN.md` §6 (line 152) and `docs/design-system.md`.
  - Color: base, `shell.*`, `primary` (Farmers blue), `status.*` (`:80-92`), `ai.*`, `chart.*`,
    `nav.*`.
  - Type: DM Sans/DM Mono.
  - Layout spacing tokens (`:160-170`), radius (`globals.css:80`), shadows (`:96-100`), motion
    (`:174-185`).
  - `src/lib/tokens.ts` is **not** design tokens; it generates crypto form tokens.
- **Components:** a hand-maintained shadcn-style kit on cva + Radix.
  - Primitives in `src/components/ui/`: button, badge, card, table, dialog, input, select,
    segmented, `time.tsx` (TimeCell), typography, securities, etc.
  - Archetype shells and states in `src/components/archetypes/`: `shells.tsx`; `states.tsx` with
    EmptyState, ForbiddenState and skeletons; `error-state.tsx`; `overlays.tsx` with
    ConfirmDialog.
  - Dashboard primitives: `src/components/dashboards/primitives.tsx`. Comms pieces:
    `src/components/comms/`.
  - Archetypes A1–A13: `docs/archetypes.md:14-75`.
- **Dark mode: MISSING in practice.**
  - `tailwind.config.ts:9` sets `darkMode: 'class'`, but `globals.css` has no `.dark` block, there
    is no theme toggle, and `prefers-color-scheme` appears only in email templates.
  - `docs/archetypes.md:87` (a paragraph kept "for historical context only", `:85`) says: "Dark mode: optional (P2); ship light-first with tokens ready."
- **Navigation:** `src/lib/workspaces/registry.ts`. Existing FSA routes the plan's screens map onto:
  - `/app/calendar` and `/app/booking` (`:428-429`)
  - `/app/contacts` with `import` and `review` (`:299-301`)
  - `/app/compliance/consent`, `/app/compliance/dnc`, `/app/compliance/licenses` (`:449-452`)
  - `/app/settings` (`:453`)
  - comms sub-nav (`src/lib/comms/subnav.ts`)
- **Mobile / PWA / push: MISSING.** There is no manifest, service worker or web push.

---

## 8. Twilio numbers, messaging service, A2P 10DLC

- **Env names** (`.env.local.example:68-82`; values not read): `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `SMS_A2P_APPROVED`.
  Read at `messaging.ts:104-109,511-514`. **VERIFIED.**
- **A2P 10DLC:** a single env flag `SMS_A2P_APPROVED` (`a2p.ts:18-21`) feeds gate step `sms_live`.
  The code has no brand or campaign registration logic. **VERIFIED.**
- **Webhooks:** `POST /api/webhooks/twilio/inbound` (`route.ts:19`; STOP/HELP) and
  `/api/webhooks/twilio/status` (`route.ts:23`). Signature check: `verifyTwilioSignature`
  (`src/lib/comms/twilio.ts:12`). It **fails open when `TWILIO_AUTH_TOKEN` is unset and
  `NODE_ENV !== 'production'`** (`:14`). **VERIFIED.**
- **Twilio Voice:** **MISSING** (§2.2).
- **Not checked (UNVERIFIED):**
  - which numbers the account owns, whether they are voice-capable, and the Messaging Service SID;
  - A2P brand/campaign registration status and the registered opt-out language;
  - CNAM / STIR-SHAKEN attestation;
  - whether office numbers exist to port.

  These need the Twilio console or a working Twilio MCP connection.

---

## 9. Hosting and where a long-running WebSocket service could run

- **Vercel project `fsos`** (`prj_MvKJLRNpA9DVFvveSaIw9eH7EoFO`, team `autolenis`). Framework
  nextjs, Node 24.x on Vercel (CI uses Node 22, `ci.yml:31`). Domains `markistfsa.com` and
  `www.markistfsa.com`. **VERIFIED live.**
- **Repo config:** `vercel.json` sets `regions: ["iad1"]` and 24 crons; there is no `functions`
  block. `maxDuration = 60` is set per route in 14 routes. All runtime is `nodejs`; there are no
  edge routes. **VERIFIED.**
- **Supabase** region is `us-east-1` (live).
- **Long-running service: MISSING.** There is no Dockerfile, fly.toml, ECS/Railway/Render config,
  WebSocket server, `ws` dependency, Redis/Upstash/KV, or Supabase edge function.
  - ASSUMPTION: Vercel Functions can't host a persistent WebSocket server for ConversationRelay, so
    the orchestrator needs a container runtime (Fly.io, ECS Fargate or similar) near `iad1` /
    `us-east-1`.
  - UNVERIFIED: no runtime has been chosen and no account exists in the repo. This is new
    infrastructure and needs owner approval (CLAUDE.md: "No speculative infrastructure").
- **Repo shape:** a single Next.js app with no workspace or packages split (ASSUMPTION from the
  `package.json` layout). A container service that has to reuse `src/lib/messaging.ts`,
  `src/lib/ai/gateway.ts` and `writeAudit` needs a code-sharing decision (§12, C9).

---

## 10. Tests, CI, feature flags, observability

- **Tests (VERIFIED):** a custom harness. There are 266 top-level `tests/*.mjs|*.mts` files: 24 in
  the RLS set (`scripts/run-tests.mjs:25-60`) and 242 unit. `tests/e2e/*.spec.ts` holds 3
  Playwright files (`playwright.config.ts`: projects `desktop` and `mobile-375`). The
  `tests/expected-failures.json` manifest has zero pins.
  - **There is no LLM-output eval, scripted-call or red-team harness.** The closest are
    `tests/ai-tool-loop.test.mjs`, `ai-tool-authority`, `ai-gateway-seam`,
    `comms-human-template-redline` and the campaign simulator `src/lib/comms/simulation.ts`.
    Discovery is one directory level deep; a voice eval suite must live at top level or have its
    own runner.
- **CI (VERIFIED):** `.github/workflows/ci.yml`, one job: `npm ci` → type-check → lint → `npm test`
  → build → `test:rls` under sudo with `CI_REQUIRE_INFRA=1`. A drift check runs on main and is
  noted as not yet armed (`:76-80`). There is no staging deploy, blue/green or call drain.
- **Feature flags (VERIFIED):** no third-party flag tool.
  - `automation_switches` (`140:22`): global key → `off|canary|on`. Canary means verified
    `comms_test_recipients` only. Read via `src/lib/ops/automation-switch.ts:40,69`, failing closed
    to off. It has **no per-office or per-agency dimension** and is **not live** (§6).
  - AI kill switch: `ai_policies.gateway_enabled` + `AI_GATEWAY_DISABLED` (`gateway.ts:108-124`),
    plus per-agent `ai_agents.enabled` (`:126-133`).
- **Observability (VERIFIED):** no Sentry or OpenTelemetry; logging is raw `console.*`. There is no
  generic PII redaction helper for logs.
- **Rate limiting (VERIFIED):** in-memory and per instance (`src/lib/http/rate-limit.ts:20`), on
  public routes only. Not on webhooks or AI routes.

---

## 11. AI gateway, guardrails, prohibited tools (VERIFIED)

- **`runGateway(req)`** (`src/lib/ai/gateway.ts:275`):
  - The default model is `'claude-sonnet-5'` (`:75`). The price table has claude-sonnet-5,
    claude-opus-4-8, claude-haiku-4-5-20251001, gpt-4o and gemini-1.5-pro (`:94-98`).
  - Kill switch, then fallback chain (`:276-287`). Routing uses a provider union and a switch
    (`:21,84,259`); there is no provider interface.
  - **No streaming anywhere in `src/`.**
  - `tests/ai-gateway-seam.test.mjs` fails CI if `getAnthropic` is imported outside `gateway.ts` or
    `anthropic.ts`.
- **Tool loop:** `runGatewayTools` (`:329`) and `driveToolLoop` (`tool-loop.ts:128`) provide an
  allowlist, Zod validation, an effect ceiling and 6 iterations. `assertToolAuthority`
  (`tools.ts:117`) checks tools against the roster. **No production tools are defined.**
- **Red line:**
  - `GREEN_ZONE_ACTIONS` / `RED_LINE_ACTIONS` (`src/lib/compliance.ts:19-35`, re-exported at
    `guardrail.ts:14-15`).
  - Regex recommendation patterns (`guardrail.ts:45-60`) and `validateAIClientMessage`
    (`:108-116`).
  - **No model-based classifier or output guard.**
- **Securities firewall:** `src/lib/compliance/firewall.ts:69,77`.
- **Prohibited tools:** `recommendInvestment`, `recommendAnnuity`, `selectProduct`,
  `determineSuitability`, `moveMoney`, `changeBeneficiary`, `approveUnderwriting` are **absent**.
- **NIGO:** no NIGO workflow in `src/` (only "NIGO-free" copy). Legacy tables `nigo_cases` and
  `nigo_issues` (`036:146`) still exist live; their app code was excised
  (`INTELLIGENCE_EXCISION_LEDGER.md:84-91`). The checklist's "no NIGO" review should treat those
  tables as known legacy.

---

## 12. Conflicts between the plan/checklist and the code

Each conflict needs a decision by the named owner. Nothing has been changed to resolve any of them.
Per `CLAUDE.voice.md`: "If the plan, the checklist and the code disagree, stop and report the
conflict. Do not pick a side on your own."

| # | Plan / checklist says | Code says (evidence) | Proposed resolution (ASSUMPTION) | Owner |
|---|---|---|---|---|
| C1 | One pipeline: "the existing `sendThroughGate`" (plan l.11, 78, 99, 249; checklist l.24, 139, 287, 499) | Retired; chokepoint is `sendSms`/`sendEmail` + `resolveDispatchPolicy` + `evaluateGate` (§2.1) | Rename everywhere to "the dispatch chokepoint (`src/lib/messaging.ts`)" and add `startVoiceCall` per §2.3 | Eng |
| C2 | "extended with voice_ai channel" (plan l.99) | Channel closed to sms/email in ~25 types and ~15 CHECKs; gate rejects others; no voice provider; `call` DNC rows ignored (§2.2) | Stage 5 scope grows: types, gate, DNC/consent readers, migrations. Decide whether calls log in `comm_messages` (widen CHECK) or a call table | Eng |
| C3 | `term_conversion` / `marketing_automation` agents "decide who to contact" and emit intents (plan l.71-104; checklist l.375, 382, 392) | Owner decision 7: campaign engines own those audiences; agents stand down (`outreach.ts:30-42`) | Intents come from the Life Conversion, Cross-Sell Life and Pipeline Win-Back engines (e.g. an `ai_voice` touch kind), plus the calendar and the workshop engine | **Owner** (supersedes or amends decision 7?) |
| C4 | Offices (Round Rock pilot, Georgetown forwarding), district operator, per-office flags, canary, spend cap, concurrency, ring groups (plan l.199, 226; checklist l.66, 79, 143-145, 151, 204, 212) | Single-FSA, single-tenant; no office or district-operator concept (§6) | Either the plan targets a different deployment, or "office" maps to the one FSA practice. Every per-office item must be re-scoped | **Owner** |
| C5 | Agency RLS via agency ID claim; "RLS by agency on every new table" (checklist l.33, 97, 503) | No agency claim; role-based RLS, service-role writes after `requireApiRole`; agencies are partners, not tenants (§6) | New tables use the existing pattern (default-deny, role SELECT policies, service-role writes) | Eng + Compliance |
| C6 | `voice` schema with `consent_records`, `audit_log` (checklist l.95) | Consent and audit stores already exist; everything is in `public`; CLAUDE.md forbids duplicating them (§5) | Keep only voice-specific tables (`calls`, `call_turns`, `llm_calls`, `tool_invocations`, `transfers`, `call_outcomes`, `playbooks`, `outreach_intents`). Write consent to the existing stores and audit via `writeAudit`. Schema name (`public` vs `voice`) to decide | Eng (Owner if a schema is wanted) |
| C7 | Hash chain on `audit_log`; write-once archive (checklist l.96-98) | `audit_log` is append-only but unchained; no archive (§5.4) | A hash chain changes a shared table; decide whether it goes on `audit_log` or a voice-only table | Eng + Counsel |
| C8 | Texas 9 AM–9 PM (plan l.135; checklist l.288) | Floor 9:00–20:00; may never be widened (§2.4) | The code floor wins unless the owner and counsel change CLAUDE.md. Update plan text to 9–8 + Sunday noon | **Owner + Counsel** |
| C9 | Reminder calls must have "0 calls outside calling windows" | APPOINTMENT/TRANSACTIONAL purposes skip quiet hours (`purpose.ts:78-100`) | `voice_ai` must always apply quiet hours; add as an explicit Stage 5 checklist item | Eng + Compliance |
| C10 | Consent by purpose: informational PEC vs telemarketing PEWC (plan l.132; checklist l.320-322) | Purposes are sms/email-only and have no PEC/PEWC basis; `consents.call` has no purpose or evidence (§5.2) | New voice consent purposes (e.g. `AI_VOICE_INFORMATIONAL`, `AI_VOICE_MARKETING`) on `comm_consent_purposes`; PEWC evidence in `comm_contact_consents` | Counsel + Eng |
| C11 | STOP: scope informational revocations by purpose; telemarketing revocation ends all telemarketing (plan l.133, 168) | STOP revokes every purpose on the channel (§2.5) | Keep channel-wide for SMS; decide voice scope after the FCC Sept 30, 2026 order | Counsel |
| C12 | National DNC + reassigned-number check before every dial (plan l.136; checklist l.287) | Neither exists (§2.5) | New integrations (vendor choice) | Ops + Eng |
| C13 | Claude Haiku 4.5 primary, "Sonnet 5" fallback, behind an `LlmProvider` abstraction with streaming and prompt caching (plan l.9; checklist l.104) | All model calls must go through `runGateway` (CI seam test); default `claude-sonnet-5`; no streaming; no provider interface (§11) | Build streaming and the voice provider **inside** `gateway.ts` so the kill switch, fallback and cost telemetry stay in one place. Confirm model IDs against the current list | Eng |
| C14 | Orchestrator on a container runtime, plus Redis and OpenTelemetry (checklist l.85-91) | Vercel-only; no container, Redis or OTel (§9, §10) | New infrastructure that needs explicit approval. Also decide how the container reuses `messaging.ts`, `gateway.ts` and `writeAudit` (shared package, HTTP calls back into FSOS, or running the gate in FSOS only) | **Owner** |
| C15 | Policy facts "read live from the policy system"; "data older than 24 h isn't spoken" (plan l.139; checklist l.183, 375-378) | No external policy system; deadlines come from imported lists in `household_policies.conversion_deadline` (§3) | Redefine "fresh" as "verified at import, not past deadline", or obtain policy-system access (already an open decision, plan l.228) | **Owner + Compliance** |
| C16 | Licensing roster "synced from the firm's system"; licensed-rep scheduling (checklist l.136, 187, 213) | `licenses` table exists (`009:522-531`, `/app/compliance/licenses`); no sync, no on-duty roster, single host calendar (§4) | Extend `licenses`; on-duty roster is new | Eng + Compliance |
| C17 | `confirmAppointment`, `confirmed`, slot lock, staff booking (plan l.156; checklist l.137, 296) | No confirmed status or confirm route; DB exclusion prevents double-booking; `bookAppointment` is public-flow only (§4) | Add a status via a new migration. Drop "slot lock" in favour of the exclusion constraint. Add an authenticated booking entry that reuses `book.ts` | Eng |
| C18 | No-show intent "when an appointment is marked missed" | Status is `no_show`, set manually; recovery is a manual POST (§4) | Hook into `setAppointmentStatus(..., 'no_show')` | Eng |
| C19 | Feature flag per office with canary and one-step rollback (checklist l.66, 151) | `automation_switches` is global off/canary/on, canary = test recipients, and not applied live (§10) | Reuse `automation_switches` keys (one per voice workflow). Migration 140 must reach live first | Eng + Ops |
| C20 | Dark mode on every screen (checklist l.54; plan l.237) | No dark mode; archetypes mark it P2 (§7) | Platform-wide design-system work; the open decision at plan l.237 should be settled before any screen work | **Design / Owner** |
| C21 | FSA mobile transfer screen, lock-screen notifications (checklist l.223-224) | No PWA, service worker or push (§7) | New capability; choose web push (PWA) or SMS alerts through the chokepoint | Owner |
| C22 | "Migrations with a tested rollback" (checklist l.32) | Forward-only, commented ROLLBACK blocks; one rollback test exists (`automation-migrations-rollback`) | Adopt that test's pattern for voice migrations | Eng |
| C23 | "Change approvals with four-eyes approval" (checklist l.150) | Template approval with separated authority exists: authors can't approve; approvers are compliance/supervisor/super_admin (`src/lib/comms/template-admin.ts:7-37`) | Reuse the template approval model for scripts and answers rather than a new approvals system | Eng + Compliance |
| C24 | Workshop PEWC naming the seller (checklist l.387) | Registration consent covers SMS reminders + optional marketing opt-in; no seller name, no call/AI-voice language (`src/lib/workshops/consent-copy.ts:11-23`) | Consistent with the plan (it already blocks stage 10); no plan change, form change needed later | Counsel |
| C25 | Vercel webhooks `/voice/inbound`, `/voice/connect-action`, `/voice/status` (checklist l.88) | API routes live under `/api/...`; Twilio webhooks under `/api/webhooks/twilio/*` | Use `/api/webhooks/twilio/voice/{inbound,connect-action,status}` | Eng |
| C26 | Model IDs "pinned by date" (checklist l.409) | `claude-sonnet-5` is an undated alias (`gateway.ts:75`) | Decide pinning policy; UNVERIFIED which dated IDs exist for the chosen models | Eng |

---

## 13. Plan items: EXISTS / PARTIAL / MISSING

### 13.1 "Verify against the FSOS repository first" (checklist l.495-506)

| Checklist item | Status | Answer |
|---|---|---|
| `sendThroughGate` location, signature, `voice_ai` | **PARTIAL** | Renamed and moved; see §2. Voice extension designed, not built (C1, C2) |
| How the agents emit work; how they will emit intents | **PARTIAL** | The campaign engines emit work, not the agents (§3, C3). Intent mechanism MISSING |
| Calendar source and booking API | **EXISTS** | `appointments` + `src/lib/booking/*` (§4) |
| Contact, consent, task, note tables | **EXISTS** | §5 (names differ from the plan) |
| Supabase project, agency claim, RLS pattern | **PARTIAL** | Project `supabase-FSOS`; role-based RLS; no agency claim (§6, C5) |
| Design tokens, components, dark mode | **PARTIAL** | Tokens and components exist; dark mode MISSING (§7, C20) |
| Twilio numbers, messaging service, A2P | **UNVERIFIED** | Env names and A2P flag only (§8) |
| Vercel project and orchestrator host | **PARTIAL** | Vercel `fsos` verified; container host MISSING (§9, C14) |

### 13.2 Stage 0 — Foundations

| Item | Status | Notes |
|---|---|---|
| Twilio subaccounts, addendum, porting, vendor terms | UNVERIFIED | Outside the repo |
| Orchestrator container + WebSocket LB | MISSING | C14 |
| Redis (sessions, idempotency, rate limits) | MISSING | In-memory rate limiter only |
| TwiML webhooks on Vercel | MISSING | Route home: `/api/webhooks/twilio/voice/*` (C25); reuse `verifyTwilioSignature` |
| Number fallback to office ring group | MISSING | No office (C4) |
| OpenTelemetry + PII-redacting logs | MISSING | `console.*` only |
| CI/CD staging, blue/green, call drain | MISSING | CI has no deploy stages |
| Voice tables `calls`, `call_turns`, `llm_calls`, `tool_invocations`, `dispositions`, `summaries`, `transfers` | MISSING | New, in the existing pattern (C6) |
| `consent_records`, `audit_log` in voice schema | EXISTS (as other tables) | Do not duplicate (C6) |
| Append-only triggers | EXISTS (pattern) | `010:73-85`, `077:30-41`; reuse for new tables |
| Hash chain, write-once archive | MISSING | C7 |
| Dedicated orchestrator DB role | MISSING | Only service-role and anon today |
| ConversationRelay handling, state machine, turn manager | MISSING | — |
| `LlmProvider` with streaming + caching + fallback | PARTIAL | `runGateway` has fallback and kill switch; no streaming, no interface (C13) |
| Policy engine for tool requests | PARTIAL | `driveToolLoop` + `assertToolAuthority` + Zod + audit (`agent-runner.ts:109-145`); no identity or consent checks per tool |
| Speech sanitizer, output guard | PARTIAL | Regex red line `guardrail.ts:45-60` only |

### 13.3 Stage 1–4 building blocks

| Item | Status | Notes |
|---|---|---|
| Disclosure, are-you-a-person rule, `0` escape, relay | MISSING | — |
| Approved-answer retrieval | PARTIAL | `knowledge_documents` / `knowledge_citations` and `src/lib/knowledge/` exist (not reviewed in depth); template approval model exists (C23) |
| Securities firewall | EXISTS | `firewall.ts`; regex red line; forced transfer MISSING |
| `recordSuppression` | PARTIAL | `recordChannelOptOut` (`opt-out.ts:157`) for SMS/email; voice scope MISSING |
| `findLead` / `createOrUpdateContact` | PARTIAL | Contact dedupe keys (`026`) and import dedupe (`src/lib/import/`); no tool wrapper |
| `qualifyLead` | MISSING | — |
| `getAppointmentAvailability` | EXISTS | `computeSlotsForType` (`slots.ts:58`) |
| `scheduleAppointment` | PARTIAL | `bookAppointment` is public-flow (C17) |
| `rescheduleAppointment`, `cancelAppointment` | EXISTS | `manage.ts:89,126` |
| `confirmAppointment` | MISSING | C17 |
| `createFollowUpTask` | EXISTS | `work_tasks`; `createAppointmentFollowupTask` (`service.ts:148`) |
| `sendApprovedSMS` | EXISTS | `sendMessage` → chokepoint with approved templates |
| Spam/robocall screening, spend cap, concurrency | MISSING | AI cost telemetry exists in the gateway; no caps |
| AL1 caller ID + attestation, AL2 step-up, keypad redaction | MISSING | — |
| `getCaseStatus` from policy system | MISSING | No policy system (C15); `cases` table exists |
| `createServiceCase` | PARTIAL | `case_service_requests` table exists (not reviewed in depth) |
| Licensing roster | PARTIAL | `licenses` table (C16) |
| Trusted contact | MISSING | — |
| `transferToFSA`, whisper, callback queue | MISSING | — |
| FSA mobile + push | MISSING | C21 |
| Call record, recording, transcript, retention jobs | MISSING | `legal_holds` exists |
| `extractCallOutcome`, `voice.call_outcomes` | MISSING | — |
| Supervision queue, complaint case | PARTIAL | `compliance_events` + `agent_actions` escalation queue exist (`escalation.ts:52,71`); no complaint entity |

### 13.4 Stages 5–12 building blocks

| Item | Status | Notes |
|---|---|---|
| `voice.outreach_intents`, `createOutreachIntent` | MISSING | Source = campaign engines (C3) |
| `voice_ai` channel in chokepoint | MISSING | §2.3 |
| Calling window from area code + address | EXISTS | `resolveDispatchTimeZone` (`dispatch-policy.ts:421-487`) |
| Dialer, AMD, pacing, attempt caps | MISSING | Frequency caps exist for messages (`frequency.ts`, `comm_frequency_policy`) |
| `leaveApprovedVoicemail` | MISSING | — |
| Consent inventory per channel/purpose | PARTIAL | sms/email purposes only (C10) |
| Consent capture naming the seller | PARTIAL | Booking SMS consent (`sms-consent.ts`); public consent route (`api/public/consent`); no AI-voice PEWC |
| Number reputation, CNAM, spam-label monitoring | UNVERIFIED / MISSING | Outside repo |
| Eligibility: annual reviews (no review in 12 months) | PARTIAL | `reviews` / `review_types`, `/app/reviews/due`; not reviewed in depth |
| Term-conversion deadlines | EXISTS | `household_policies.conversion_deadline`, `v_conversions_due` |
| Win-back, cross-sell audiences | EXISTS | `v_pipeline_winback_due`, `v_cross_sell_gaps` |
| AI never advances opportunity stage | UNVERIFIED | Not examined |
| Quality sampling, releases, analytics, governance register | MISSING | Comms campaign analytics exist (`campaign-analytics.ts`) |

---

## 14. Outside the voice scope, found in passing (not fixed)

- **Live DB is behind the repo:** migrations 137–141 are unapplied (§6), including
  `automation_switches`, which `opt-out.ts:267` and `orphan-executions.ts:70` read (they fail
  closed to off). ASSUMPTION: this matches the pending runbook in recent commits (`0e59ee9`,
  `cae03d1`).
- **Twilio signature check fails open** outside production when `TWILIO_AUTH_TOKEN` is unset
  (`twilio.ts:14`). Resend verification behaves the same way and has no replay-window check
  (`resend.ts:16`).
- **CLAUDE.md line refs drifted:** `evaluateGate` is at `gate.ts:270` (cited `:252`); `dispatch` is
  at `dispatcher.ts:105` (cited `:98`).
- **`max_per_day` booking cap** counts all appointment types, not per type as its column comment
  says (§4).

---

## 15. Next step

The owner settles C3, C4, C8, C14 and C15 (plus C20 before any screen work). After that, update
`voice-agent-plan.md` and `voice-agent-build-checklist.md`: rename `sendThroughGate`, re-scope
per-office items, replace the `voice` consent and audit tables with the existing stores, and fix the
calling window. Until then Stage 0 should not start.
