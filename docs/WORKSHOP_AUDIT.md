# FSOS Workshop Subsystem — Audit Ledger

> **Structure: APPEND-ONLY.** New findings and corrections are appended as dated sections;
> existing entries are never rewritten. Corrections reference the finding ID they amend.
>
> **Epistemic labels** (mandatory on every claim):
> - **PROVEN** — file:line evidence or actual command output held by the auditor.
> - **PROVEN (executed)** — demonstrated by running the code path or an equivalent executable proof.
> - **HYPOTHESIS** — plausible, not demonstrated.
> - **NOT VERIFIED** — cannot be checked in this environment (needs live infra).
>
> **Severity**: BLOCKER (subsystem cannot fulfill its purpose / severe exposure) ·
> BROKEN (a shipped behavior is wrong) · GAP (required behavior absent) ·
> RISK (correct today, fragile or exposed) · POLISH (quality/consistency).

---

## §0 — Audit context (2026-08-29)

- Branch: `claude/workshop-subsystem-audit-iyifiz` (harness-designated; equals `origin/main`
  @ `e9edbfb` at audit start — a clean tree; no unmerged repair branch existed; the only open
  PR was Dependabot #284). The owner's prompt named `feat/workshop-subsystem`; the execution
  environment mandates pushing only to the designated branch above. Noted as a deviation —
  content and process are otherwise per the prompt.
- Method: nine-surface read-only trace of ACTUAL RUNNING CODE (A data model · B public
  registration · C comms inventory · D automation/cron · E state transitions · F pipeline
  placement · G admin/authz · H frontend · I tests), each surface traced by a research
  subagent AND independently re-verified by an adversarial evidence-checker subagent that
  re-opened every cited file:line; the highest-impact claims were additionally re-proven
  first-hand by the coordinating auditor (all quotes in this ledger were held directly).
- **Zero code changes were made during Phases 0–1.** This document is the Phase 1 deliverable.

### §0.1 Baseline gate (all run in this container, verbatim results)

| Gate | Command | Result |
|---|---|---|
| Install | `npm install` | exit 0 |
| Typecheck | `npm run type-check` (`tsc --noEmit`) | exit 0, no errors |
| Lint | `npm run lint` | exit 0 — “✔ No ESLint warnings or errors” (Next.js prints a `next lint` deprecation notice — ENVIRONMENT/TOOLCHAIN, pre-existing) |
| Build | `npm run build` | exit 0 — all workshop routes present in the route manifest |
| Unit suite | `npm test` (`scripts/run-tests.mjs unit`) | exit 0 — “✓ All 192 unit test file(s) passed.” |
| RLS suite | `npm run test:rls` with `PATH=/usr/lib/postgresql/16/bin:$PATH` | exit 0 — “✓ All 15 rls test file(s) passed.” |

Failure classification: **no REPOSITORY failures at baseline.** The only adjustments needed
were ENVIRONMENT (`postgresql-16` server binaries exist at `/usr/lib/postgresql/16/bin` but
are not on `PATH`; put them on PATH for the RLS suite).

**Playwright status (ENVIRONMENT):** `@playwright/test` is **not** a dependency of this
repository (verified: `package.json` has no playwright/puppeteer entry, and the repo has no
Playwright config or specs — the FSOS test architecture is bare node scripts under `tests/`
per `scripts/run-tests.mjs`). Chromium browsers ARE present in the container at
`/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Adding Playwright is
therefore a Phase 5 decision (new devDependency + config), not a recovery of something
missing. Recorded here so Phase 5 installs it deliberately rather than routing around it.

### §0.2 Superpowers skills preflight

`.claude/skills/` contains the Superpowers workflow set (verified by listing):
`using-superpowers`, `brainstorming`, `writing-plans`, `executing-plans`,
`subagent-driven-development`, `dispatching-parallel-agents`, `test-driven-development`,
`systematic-debugging`, `verification-before-completion`, `requesting-code-review`,
`receiving-code-review`, `finishing-a-development-branch`, `using-git-worktrees`, plus the
FSOS domain set (`fsos-testing`, `fsos-security-audit`, `fsos-crm-workflows`,
`twilio-a2p-compliance`, `fsos-deliverability`, `frontend-design`, `impeccable`, and others).
The workflow used: research subagents (brainstorming/audit phase) → writing-plans →
(post-approval) executing-plans with subagent verification — per `using-superpowers`.

---

## §1 — What the workshop subsystem actually is (PROVEN inventory)

Two generations coexist:

- **Legacy scaffold (migration 001 + 018, route `/events/[id]`, `/api/workshops/register`)** —
  `workshops` + `workshop_registrations` with `registered_at`, `attended` boolean,
  `interest_level`; a public page at `src/app/events/[id]/page.tsx` and an unauthenticated
  register route at `src/app/api/workshops/register/route.ts`.
- **Seminar engine (migrations 038–041, 075; routes under `/workshops/[slug]` and
  `/api/public/workshops/*`; services `src/lib/workshops/*`)** — sessions
  (`workshop_sessions` with `timezone` per venue, 038:136), attendance
  (`workshop_attendance`, status `registered|attended|no_show|left_early`, unique
  `(registration_id, session_id)` 038:199-210), durable consent evidence
  (`workshop_consent_events`), compliance publish gate (approvals + disclosures + DB trigger),
  a template/comms engine (`workshop_message_templates`, `workshop_message_log` with unique
  `(registration_id, channel, kind)` 040:184, `workshop_comms_config`), Zoom delivery (041,
  075), feedback, replay.

Comms path: `src/lib/workshops/comms-engine.ts` → `sendThroughGate` (`src/lib/comms/send.ts:506`)
→ dispatcher (`src/lib/comms/dispatcher.ts`) → `lib/messaging` senders. Cron:
`/api/cron/workshop-reminders` every 15 min (`vercel.json`), auth `x-vercel-cron` or Bearer
`CRON_SECRET` (route:22-32) — PROVEN.

Pipeline placement today (Surface F): a registration creates **no opportunity**. Post-event
nurture for qualified segments (attended/left_early) seeds a `referrals` row and marks
`lead_converted_at` (comms-engine.ts:568+; server.ts:417-421 states: “No external pipeline
placement is performed (there is no native opportunity spine wired for workshop/referral
leads”). `src/lib/pipelines.ts` defines three pipelines (Prospect/Client 10 stages, Agency
Owner 8, Term Conversions 6) — nothing workshop-side references them. Residual GHL columns
(`ghl_contact_id`, `ghl_opportunity_id`) remain, unused (ADR-014 excision). Where
`docs/ghl_workshop_workflows.md` describes GHL automation, **code wins: GHL is excised**.

---

## §2 — Findings

### BLOCKERS

**WS-001 · D/A · BLOCKER · PROVEN (executed) — The reminder/nurture engine queries a column
that does not exist; the entire workshop comms engine silently does nothing.**
- Claim: both engine passes select `created_at` from `workshop_registrations`; the column is
  `registered_at`. The query errors; the code ignores the error object; each pass processes
  zero registrations and the cron reports success.
- Evidence: `src/lib/workshops/comms-engine.ts:419` and `:498` —
  `.select('reg_id, name, email, phone, consent_channels, join_url, created_at, status, workshop_id, session_id, lead_converted_at, referral_id')`;
  base table `supabase/migrations/001_initial_schema.sql:379-389` defines `registered_at`
  (no `created_at`); exhaustive grep of `supabase/migrations/` shows **no** ALTER/RENAME/view
  ever adds `created_at` to this table. Both call sites destructure only `{ data }` —
  the PostgREST error is never read — so `regs ?? []` yields `[]`.
- Executed proof: the table was rebuilt from the exact migration DDL in Postgres 16 and the
  engine's exact select list was run:
  `ERROR:  column "created_at" does not exist` (control query on `registered_at` succeeds).
- User impact: no confirmation, no reminders, no nurture, ever — the cron returns 200 with
  zero work done. Nothing surfaces the failure.
- Root cause (PROVEN): column-name drift vs the 001 schema; invisible to every gate because
  (a) supabase-js select strings are untyped (`tsc` green), and (b) no test executes
  `comms-engine.ts` (see WS-019).

**WS-002 · B/G · BLOCKER · PROVEN — A second, legacy, unauthenticated registration endpoint
is deployed with none of the live route's protections.**
- Claim: `POST /api/workshops/register` (`src/app/api/workshops/register/route.ts:54-129`)
  accepts unauthenticated JSON with no rate limit, no honeypot, no `status='published'` check
  (any draft workshop's UUID is registerable), writes `customers` + `workshop_registrations`,
  captures no consent evidence, and sends a confirmation email through raw
  `sendEmail` (`@/lib/messaging`) outside `sendThroughGate` (route:120). Its GET returns
  registration counts for any workshop id, including drafts (route:23-52).
- Reachability (PROVEN): `src/middleware.ts` matcher excludes `api/` entirely (“API routes …
  enforce their own auth”), and the compiled route exists in the production build
  (`.next/server/app/api/workshops/register/route.js`). No frontend calls it (both public
  forms post to `/api/public/workshops/register` — `WorkshopRegisterForm.tsx:64`,
  `WorkshopRegisterFormSite.tsx:44`) — it is orphaned but live.
- Prior coverage: `AUDIT_LEDGER.md` FSOS-012 records its *email* as an accepted transactional
  bypass; the ledger did **not** cover the authn/abuse dimension (spam-writes into the
  customer book, draft-workshop registration, count disclosure).
- User impact: bot-writable CRM book; uncontrolled email sending on an unthrottled route;
  registration bypasses the compliance publish gate.

### BROKEN

**WS-003 · A/B · BROKEN · PROVEN — Duplicate registration is unprevented.**
No unique constraint on `(workshop_id, email)` or `(session_id, email)` anywhere in
migrations (only `join_token` is unique — 038:176); the live route
(`src/app/api/public/workshops/register/route.ts:103-119`) inserts without any duplicate
check. Same email can register N times → N join tokens, N consent rows, and (once WS-001 is
fixed) N parallel reminder cadences. No “already registered” UX exists (see WS-024).

**WS-004 · A/B · BROKEN · PROVEN — Capacity is neither atomic nor actually configurable.**
- Non-atomic: count-then-insert (`public/workshops/register/route.ts:60-66`) with no DB
  constraint/trigger → concurrent registrations for the last seat all succeed.
- Model broken: the admin form (`WorkshopForm.tsx:113-117`) submits per-mode
  `capacity_in_person` / `capacity_virtual` but never `max_attendees`; the create route
  defaults `max_attendees: v.data.max_attendees ?? 50` (`api/workshops/route.ts:51`);
  the enforcement path reads **only** `max_attendees`. Per-mode capacities are stored and
  never read by any enforcement (grep). `WorkshopPatchSchema` (schemas.ts:954-973) carries
  no capacity field → capacity is a permanent 50 for every UI-created workshop.
- Walk-ins (`/api/workshops/[id]/check-in`) never check capacity (route read in full).

**WS-005 · D · BROKEN · PROVEN — Quiet hours are computed in the venue's timezone, not the
recipient's.** `comms-engine.ts:329-333`: `utcOffsetHoursForTimezone(session?.timezone, …)`
feeds the quiet-hours pre-check AND the gate's `utcOffsetHours`. The registrant's own
timezone is never captured (no column; verified schema-wide). For a McKinney-metro in-person
audience this usually coincides; for virtual registrants in other timezones an SMS can land
outside their local 9:00–20:00 window (TCPA exposure).

**WS-007 · E · BROKEN · PROVEN — Reschedule and venue change are unrepresentable, so change
notification is impossible.** `WorkshopPatchSchema` (schemas.ts:954-973) has no
`scheduled_at`/`starts_at`/`timezone`/`venue_*`; the only UPDATEs anywhere to
`workshop_sessions` touch Zoom columns (`server.ts:676-687`, `:717-728`). A date/venue
mistake after creation cannot be corrected through the product at all.

**WS-008 · E · BROKEN · PROVEN — Agency cancellation notifies no one.** The only cancel
behavior is Zoom-meeting deletion (`api/workshops/[id]/route.ts:80-93` — full handler held;
no send call exists). Registrants learn nothing.
**WS-008b · D · BROKEN · PROVEN — The nurture pass ignores workshop/session cancellation.**
Reminder pass filters `status != 'cancelled'` sessions and `published` workshops
(comms-engine.ts:405, 415); the nurture query (`:477-482`) has **no session-status filter**
and skips only `workshop.status === 'draft'` (`:491`) → a cancelled workshop's registrants
would receive “thanks for attending / sorry we missed you” nurture (once WS-001 is fixed).

**WS-009 · E · BROKEN · PROVEN — Registrant self-cancel does not exist.** No route, no
cancel link in any template, and `RegistrationPatchSchema` (schemas.ts:1034-1041) allows only
`attended`/`convert_to_referral`/`convert_to_lead`. STOP suppresses SMS (DNC), but there is
no cadence-termination state for the registration; the email cadence would keep firing.
(`registration.status` supports `'cancelled'` in engine filters — comms-engine.ts:421,501 —
but nothing can ever set it.)

**WS-012 · B/C · BROKEN · PROVEN — The two-tier consent model does not exist, and its absence
breaks the product promise in both directions.** One blanket per-channel grant
(`consent_email`/`consent_sms` → `workshop_consent_events` 'granted';
`register/route.ts:98-134`) is used for everything:
- Direction 1: event reminders require marketing-style channel consent
  (`comms-engine.ts:317-322` blocks unconsented channels) while the form, the ack email, and
  the confirmed page all promise “We'll send a reminder before the event” unconditionally
  (`register/route.ts:204`; `WorkshopRegisterFormSite` copy). An un-ticked registrant gets no
  reminders.
- Direction 2: post-event **nurture** (marketing-class: consult invites, re-engagement) rides
  the same grant the registrant gave for “event reminders” (`comms-engine.ts:548-554`) —
  consent-tier misclassification (TCPA/A2P exposure on the SMS side).

### GAPS

**WS-010 · B/H · GAP · PROVEN — A waitlist is advertised in three places and implemented in
none.** CTAs: `workshops/[slug]/page.tsx:62,100,191,228`; `WorkshopHubFilters.tsx:134,143`
(“Waitlist only” / “Join waitlist”); `WorkshopRegisterFormSite.tsx:85` (“contact the office to
join the waitlist”). No waitlist table, status value, or route exists (repo-wide grep).
Capacity-full is a dead end that *names* a nonexistent feature.

**WS-011 · D · GAP · PROVEN — The implemented cadence is a subset of the owner's required
matrix.** Implemented kinds: `confirmation`, `reminder_7d` (10080), `reminder_1d` (1440),
`reminder_1h` (60), `reminder_starting` (0) — `reminders.ts:19-24`, offset map `:54-67`
returns `null` for any other offset (a configured 4320/T-3d or 120/T-2h is silently dropped).
Missing vs the owner's matrix: T-3d email+SMS, day-of-AM SMS, T-2h SMS, waitlist comms,
change-event comms (see WS-007/008), registrant-cancel ack (WS-009).

**WS-013 · C · GAP · PROVEN — Workshop consent is siloed; member-keyed policy layers no-op.**
`workshop_consent_events` is never materialized into the platform consent stores
(`consents` / `comm_contact_consents`); engine sends pass `durableConsentGranted` + no
`memberId` → per-recipient **frequency caps resolve `{allowed:true}`**
(`policy-resolver.ts:188-194` — memberId-gated). What still works (verified): STOP/DNC is
phone-keyed last-10 (`send.ts:451-477`, fail-closed) and **dispatch-time business suppression
does apply** via the phone/email fallback subject (`send.ts:1007-1020`;
`suppression.ts:79-91`) because workshop sends carry no purpose and
`isBusinessSuppressible` fails closed (`suppression.ts:71-76`).

**WS-022 · C · GAP · PROVEN — No calendar file.** The `ics_url` merge token resolves to the
`/confirmed` page URL, not an .ics (`comms-engine.ts:344`); no VCALENDAR generation exists in
the workshop path. (Booking already has a pure builder — `src/lib/booking/ics.ts` — reusable.)

**WS-023 · F · GAP · PROVEN — Pipeline placement (the known open gap), stated precisely.**
Registration creates no opportunity (live register route held in full — writes
registrations/consent/audit only). Attendance-derived nurture seeds `referrals` + marks
`lead_converted_at` for qualified segments only (comms-engine.ts:568+). No code links
workshops to `src/lib/pipelines.ts` stages. Reported as-is; **no design done** (owner
decision — see WORKSHOP_PLAN).

### RISK

**WS-006 · D · Mostly SOUND, one minor RISK · PROVEN — Timezone/DST handling.** Venue tz is an
explicit IANA column (`workshop_sessions.timezone`, 038:136, default `America/Chicago`);
`starts_at` is timestamptz; reminder due-time arithmetic is instant-based
(`fireAt = startMs − offset`, `reminders.ts:91-98`) so a DST boundary cannot shift a
reminder; the venue offset is recomputed per tick via `Intl` (`reminders.ts:153-177`).
Residual RISK: the offset is rounded to whole hours — half-hour zones misjudge quiet hours by
30 min (minor; not a US-venue concern).

**WS-016 · D · Core sound, one RISK · PROVEN — Send-once idempotency.** Durable key =
`unique(registration_id, channel, kind)` (040:184) + atomic claim (insert `'sending'`; lost
race → `skipped`; `deferred` retry guarded by `.eq('status','deferred')`) —
`comms-engine.ts:261-301`. Cron ×N per slot is safe. RISK: a crash between claim and
finalize strands the row at `'sending'` forever (no reclaim/TTL anywhere — grep) → that
(reg,channel,kind) slot is permanently wedged.

**WS-020 · A · RISK · PROVEN — No soft delete; deletion destroys compliance evidence.**
`workshop_consent_events`/`workshop_attendance`/`workshop_message_log` cascade from
registrations/sessions (038:199,219; 040:168-171); `eventDeletion.ts` +
`DeleteEventButton.tsx` expose hard delete → TCPA consent evidence and the send log are
destroyed with the workshop (17a-4/4511 retention exposure).

**WS-025 · C · RISK · PROVEN — CAN-SPAM footer can ship literal placeholder text as the
physical address.** The footer builder is sound and applied to every engine email
(`comms-engine.ts:352-356`), but `sender_physical_address` defaults to
`'[PLACEHOLDER - set the FSA business mailing address]'` (`:76`) with **no placeholder guard**
— approve templates without setting the config row and live commercial email carries that
string as its CAN-SPAM address. (SMS is centrally safe: the dispatcher auto-appends the
carrier STOP/HELP footer to every SMS — `dispatcher.ts:244`, `lib/compliance.ts`.)

**WS-B13 · B · RISK · PROVEN — The public register throttle is per-instance memory.**
`rateLimit` (`src/lib/http/rate-limit.ts:1-7` — in-memory Map) resets per serverless
instance; a fan-out defeats the 5/min/IP cap; shared IPs (NAT) collide. Honeypot present
(route:25-27). Acceptable for launch scale; recorded.

**WS-014 · C · RISK · PROVEN — Double confirmation by design.** The route sends a
transactional ack at registration (`register/route.ts:193-205`) AND the engine's
`confirmation` kind emails consented registrants once templates are approved
(`dueReminderKinds` + `channelsForReminder` → email). Two “You're registered” emails.

**WS-021 · B/H · RISK · PROVEN — The legacy `/events/[id]` surface renders consent boxes
without the SMS disclosure, while the register route records a disclosure as shown.**
`events/[id]/page.tsx:29-38` builds `PublicWorkshop` without `sms_disclosure`/`session_id`;
the shared form renders the SMS checkbox with no disclosure text; the route then writes
consent evidence with the fallback disclosure (`register/route.ts:82-96`). Weak A2P consent
evidence on that surface; also a second, visually divergent public registration UI
(`WorkshopRegisterForm` vs `WorkshopRegisterFormSite`).

### POLISH / NOTES

**WS-017 · D · NOTE · PROVEN — Cron auth + scheduling are correct**, and the repo ledger is
stale on this point: `AUDIT_LEDGER.md` FSOS-072 says the workshop cron is unscheduled;
`vercel.json` now schedules `/api/cron/workshop-reminders` at `*/15 * * * *`. **Code wins.**

**WS-018 · G · NOTE · PROVEN — Admin authz is uniformly enforced.** Every mutation under
`/api/workshops/**` runs `requireApiRole('fsa')` + `requirePermission([...])` (authz table
held for all 10 routes; roles per route: approve = fsa/super_admin; attendance, check-in,
provision-zoom, registrations = fsa/licensed_staff/super_admin; create/patch/upload =
fsa/licensed_staff/admin/super_admin). Public routes are deliberately public with
honeypot + rate limit + published-only (+ token-scoped feedback). Single-FSA tenancy — no
cross-tenant scope applies. The one exception is WS-002 (legacy route).

**WS-015 · C · NOTE · PROVEN — Template gating is fail-closed and correct.** All 13 seeded
templates are `placeholder` + `active=false` (040:129-186); the sendable set requires
`status='approved' AND active AND comm_template_id IS NOT NULL` (partial index 040:119-121;
engine defers `template_not_approved` — comms-engine.ts:311-316). **Nothing can send until
the owner approves copy — by design.** This also means the entire comms matrix is currently
inert twice over (placeholders + WS-001).

**WS-019 · I · BROKEN (test debt) · PROVEN — The test suite cannot see the engine.** The
workshop tests genuinely compile and execute the *pure* modules (`tsc` →
`require(reminders/logic/attendance/delivery)`) — not false-green for those. But no test
executes `comms-engine.ts`; its “wiring” assertions are regex-on-source
(`workshop-comms.test.mjs:112-120`) that match comments/imports (e.g. `/sendThroughGate/`
matches the header comment) — the classic false-green class. This is exactly why WS-001
survived: 192 unit files green with a dead engine. Also uncovered anywhere: cron-3×→one-send
at the DB level (booking has `booking-reminder-idempotency.test.mjs`; workshops have no
equivalent), dispatch-time suppression, concurrent last-seat, DST boundary, cancel/reschedule
comms (features absent), waitlist (absent).

**WS-024 · H · POLISH · PROVEN — Frontend quality is mixed-generation but largely competent.**
The live register form has real a11y (labels/`htmlFor`, `role="alert"`, `aria-invalid`,
`aria-busy`, honeypot `aria-hidden` + `tabIndex=-1`) and mobile-first layout; check-in UI has
44–48px tap targets (`h-11`/`h-12 min-w-[7rem]`), search, walk-in — genuinely phone-usable.
States: success/validation/server-error/capacity-full present on the live form;
**absent**: already-registered (WS-003), waitlist (WS-010), cancelled-event and past-event
handling on the register surface (a cancelled workshop's session filter exists on the hub,
but the register page/POST accept a published workshop whose session is cancelled —
sessions are not status-filtered in `public.ts` list/detail: HYPOTHESIS→see §3 Q3).
Two parallel styling systems on the public surfaces (`.msite` CSS classes vs design tokens)
— consolidation candidate, not a defect.

---

## §3 — Open questions a static read cannot settle (NOT VERIFIED)

1. **Live provider behavior** — Resend/Twilio delivery, Zoom provisioning, webhook CRC —
   requires live credentials (deliberately absent here; `zoomEnabled()` no-ops are proven).
2. **Production data shape** — whether `workshop_comms_config` row `global` exists and what
   offsets/addresses it carries; whether any template row was already approved in prod.
3. **Cancelled-session visibility on the public hub/detail** — `public.ts` session selection
   does not filter session `status` (`public.ts:54,182` region); whether a cancelled session
   is offered for registration end-to-end needs a runtime check (Phase 5 E2E).
4. **Whether any real traffic ever hit the legacy register route** (server logs — live only).

---

## §4 — Verification method appendix

Every quote and line reference in this ledger was held FIRST-HAND by the coordinating
auditor (including the executed Postgres proof for WS-001) — no finding rests solely on a
subagent's report. In parallel, each surface's findings run through an independent
adversarial evidence-checker subagent that re-opens every cited file:line; verdicts are
appended to this ledger as they complete (see the dated sections below). Corrections made
during first-hand verification are already folded in (e.g. dispatch-time suppression
initially graded a no-op was corrected to WORKING via the phone/email fallback subject —
recorded under WS-013).

---

## §5 — Appended findings (2026-08-29, Surface D deep-verification round)

All four verified first-hand by the coordinating auditor after the Surface D subagent
reported them (quotes held).

**WS-026 · D · BLOCKER · PROVEN — A pre-approval A2P hold (and any provider failure) burns
the reminder slot permanently.** `classifySendOutcome` treats only
`quiet_hours`/`business_hours` as retryable (`reminders.ts:207-211`); every other
non-send is terminal `'blocked'`. Two wrong terminals:
1. Gate step `sms_live` (“SMS staged pending A2P 10DLC approval — held until the campaign is
   approved”, `gate.ts:17,137-142,174`) is explicitly a *non-escalating hold*, but the
   engine records it as terminal — approve A2P later and no held SMS ever retries; the
   unique `(reg,channel,kind)` slot is spent.
2. A transient provider failure (Twilio/Resend 5xx) produces `sent:false` with **no**
   `gate.blockedStep` (`send.ts:1235-1242`) → `classifySendOutcome(false, null)` →
   terminal `'blocked'`, reason null. One Twilio hiccup permanently kills that reminder.
Currently masked by placeholder templates (the template check defers before any dispatch),
which is why this coexists with WS-015. Root cause PROVEN: outcome classification treats
“blocked by policy” and “failed transiently” as the same terminal state.

**WS-027 · D · BROKEN · PROVEN — No exception isolation in either pass; one throw aborts the
whole cron pass and strands claimed rows at `'sending'`.** The only try/catch blocks in
`comms-engine.ts` are in `loadConfig` (:82,:99) and the kill-switch read (:159,:165); the
per-registration loops have none. A thrown `sendThroughGate` (network error) after the claim
insert leaves that row `'sending'` forever (= permanently skipped per `decideClaim`,
`reminders.ts:189`) AND unwinds the entire pass (remaining registrants unprocessed this
tick). Compounds the WS-016 stranded-claim risk from a crash-window edge case into an
every-exception event.

**WS-028 · D/E · BROKEN · PROVEN — The nurture pass's non-message side effects are not
idempotent under overlap.** Selection is `.is('nurtured_at', null)` (`comms-engine.ts:500`),
but `routeSegmentToSpine` (referral insert + lead-convert) and the `nurtured_at` update run
*after* the message loop with no claim (`:524-540`). Two overlapping ticks both select the
registrant → duplicate `referrals` rows and double lead-score deltas. (The *message* claim is
atomic; the *spine* seeding is not.)

**WS-029 · D · RISK · PROVEN (design note) — The send-once key cannot represent a reschedule.**
The durable key is `(registration_id, channel, kind)` (040:184) with no schedule/session
version. Once reschedule exists (WS-007 fix), a moved session must re-arm reminders; with
this key, `reminder_7d` etc. are already spent. Any reschedule design must version the key
(e.g. include `session_id` + `starts_at` epoch, or a `cadence_generation` column).

**WS-030 · D · RISK · PROVEN(code)/NOT VERIFIED(platform) — Cron accepts the bare presence of
an `x-vercel-cron` header.** `route.ts:22-27` returns authorized on
`req.headers.get('x-vercel-cron')` alone; the Bearer `CRON_SECRET` path is the fallback.
Whether Vercel strips inbound `x-vercel-*` headers from external requests is a platform
behavior we cannot verify statically — if it does not, anyone can trigger the pass
(consequence bounded: the pass is idempotent + gated). Cheap hardening: require the secret
when set.

**WS-031 · D · POLISH/RISK · PROVEN — Efficiency: unbounded selects + sequential N+1.** The
reminder pass selects all sessions in window, then per-session all registrations, then
per-registration per-channel sequential awaits (existing-log check, consent check, template
check, send) — no batching, no limit (`comms-engine.ts:400-443`). Fine at launch volume;
recorded for scale. (Also NOT VERIFIED: PostgREST `db-max-rows` could silently truncate the
unbounded selects in production — check the project setting when live.)

**WS-006 amendment (nuance) — long-offset reminders are instant-anchored, not
wall-clock-anchored.** `fireAt = startMs − offset` means a 7-day reminder for a 6:00 pm CDT
session lands at 5:00 pm CST wall-clock when it crosses a fall-back boundary (1 h drift).
This is a reasonable design (never fires at the wrong instant relative to the event) — noted
so the owner's “reminder wall-clock in venue TZ” expectation is set correctly; a day-of-AM
kind (WS-011) is the wall-clock-anchored construct and must be computed in venue TZ.

---

## §6 — Appended findings (2026-08-29, Surface C comms-inventory round)

**WS-032 · C · BROKEN · PROVEN — The engine pre-blanks unknown merge tokens, defeating the
gate's fail-closed personalization step.** `substituteTokens` (`comms-engine.ts:170-177`)
replaces every `{{token}}` not in its map with `''` (only the name tokens are left for
`personalize`). The gate's `unresolvedBlockingTokens` check (`send.ts:598-601`,
`gate.ts:129`) therefore never sees a workshop template's unresolved tokens — a typo'd or
context-missing token sends as a blank instead of blocking. Compounding: with no
`NEXT_PUBLIC_APP_URL`/`APP_URL`/`VERCEL_URL` set, `appBase()` returns `''` and
`join_url`/`ics_url`/`confirmed_url`/`replay_url` all substitute to empty strings — a
reminder can ship saying “join at ” with nothing after it (fail-open on missing context).

**WS-033 · C · GAP · PROVEN (code) / NOT VERIFIED (carrier) — No HELP handling.** The SMS
footer is `'Reply STOP to opt out.'` only (`lib/compliance.ts:17`); inbound classification
recognizes a bare HELP only to exclude it from reply-pausing (`inbound.ts:436-439`) — no
HELP auto-response exists in code. A2P campaigns must answer HELP; whether Twilio Advanced
Opt-Out is configured to answer at the carrier layer cannot be verified statically.

**WS-034 · C · GAP · PROVEN — The workshop email unsubscribe link degrades to a relative
URL.** `comms-engine.ts:353`: `const unsub = base ? \`${base}/unsubscribe?...\` : '/unsubscribe'`
— with no app-URL env var, commercial email carries a non-functional relative link
(CAN-SPAM's one-click mechanism breaks silently). Same missing-context class as WS-032.

**WS-035 · C · NOTE (positives held) · PROVEN — The gated path itself is sound.** Verified
directly and via the Surface C sweep: exactly ONE provider boundary (`lib/messaging.ts` —
sole `new Resend(...)` / `api.twilio.com` in `src/`); `sendThroughGate` is the only sending
export of `send.ts`; the gate has NO purpose/transactional bypass branch (all 280 lines of
`gate.ts` read — every step applies to every send); `messaging.sendSms` carries its own
independent A2P backstop (refuses when `smsA2pApproved()` is false) so even a hypothetical
gate bypass cannot text before A2P approval; the dispatcher re-verifies business suppression
immediately before the provider call and fails closed; a failed `comm_messages`
message-of-record insert withholds the send. STOP works end-to-end for workshop recipients
(inbound upserts `dnc_entries`; DNC matched last-10, fail-safe). `src/emails/events.tsx`
(WorkshopInvite/WorkshopReminder React Email components) are author-time template sources,
not a runtime send path.

**WS-036 · C · RISK · PROVEN — Console 1:1 sends can carry a workshop template under a
consent waiver.** `/api/comms/send` (route:126-131) stacks `consentWaived` (ADR-033
operator-directed 1:1) with a caller-declared purpose and can select a workshop-kind asset;
an approved workshop marketing template could thus go out 1:1 without the workshop consent
evidence trail (though never to an opted-out recipient — the waiver is opt-out-safe, and
placeholder templates cannot be selected because their `comm_template_id` is null).
Recorded as an operator-process risk, not a code defect.

---

## §7 — Appended amendment (2026-08-29): §3-Q3 upgraded HYPOTHESIS → PROVEN (static)

Cancelled sessions are not filtered anywhere on the public read path: the workshop detail
loader selects the earliest session with **no status filter** (`public.ts:53-59`), the hub
list's earliest-session map likewise (`public.ts:181-190`), and the register route's
session resolution has none either (`register/route.ts:70-79`). A cancelled session
therefore continues to display as the workshop's session and accepts registrations while
the workshop itself remains `published`. (End-to-end confirmation stays a Phase 5 E2E item;
the static path is now fully held.) Folded into Batch 4's filter work
(`WORKSHOP_PLAN.md`).

**WS-037 · B/H · BROKEN · PROVEN — Past events remain listed and registerable.** Nothing on
the public path filters by date: the hub loader's only gate is `status='published'`
(`public.ts:160-164` — the empty state says “No upcoming workshops” but no upcoming filter
exists), the detail/register pages have no past-event guard, and the register POST has no
date check (route read in full). A published workshop whose date has passed keeps accepting
registrations, each receiving the immediate transactional “You're registered” ack for an
event that already happened (the engine's own confirmation kind would correctly not fire —
`isConfirmationDue` requires `now < start`, `reminders.ts:104-106`). Folded into Batch 2/8
scope (register-time date guard + past-event UI state).

---

## §8 — Appended findings (2026-08-29, Surfaces E & F rounds; all re-verified first-hand)

**WS-038 · B/G · BROKEN · PROVEN — The public `/api/events` feed leaks unpublished
workshops.** `src/app/api/events/route.ts:13-20` selects `workshop_id, title, topic,
scheduled_at, location` for ALL workshops with `scheduled_at >= now()` — **no status
filter** — so draft and cancelled workshop titles/locations (and registerable ids — see
WS-002) are publicly enumerable. (It does exclude past events, unlike the hub — WS-037.)

**WS-039 · E · GAP · PROVEN — No-show is never derived automatically.** No code writes
`workshop_attendance.status='no_show'` except the staff bulk-reconcile route
(`/api/workshops/[id]/attendance` → `reconcileAttendance`, statuses incl. `no_show` —
manual, idempotent, audited: held in full). There is no post-event job that marks absent
registrants; unless staff manually reconcile, the report's no-show rate reads 0% and the
nurture `no_show` segment (SMS + score −5) is unreachable — absent registrants fall to
`registered_no_show` (email-only). The engine handles the null case correctly; the
DERIVATION is what's missing.

**WS-040 · E · BROKEN · PROVEN — `attended` duality: the staff PATCH writes a boolean the
rest of the subsystem ignores.** `PATCH /api/workshops/registrations/[id]` with
`{attended:true}` updates only `workshop_registrations.attended` (route:47-48, 67-70) and
never writes a `workshop_attendance` row — but nurture segmentation
(comms-engine.ts:513-520) and the attendance analytics (`attendance.ts:85-112`) read ONLY
`workshop_attendance`. A staff-marked attendee still nurtures as `registered_no_show` and
is invisible to the attendance rate. (Check-in and reconcile write the real table; this one
API path bypasses it.)

**WS-041 · E · GAP · PROVEN — The engine confirmation cannot fire until T-8d.** The
reminder pass only sees sessions inside `now … now+8d` (`REMINDER_LOOKAHEAD_MS = 8d`,
comms-engine.ts:59, 396) — a registrant for an event 30 days out would get the engine's
`confirmation` kind 22 days late (today: never — WS-001). The immediate transactional ack
(WS-014) is what actually covers confirmation; this refines D-8's tradeoff.

**WS-042 · E · GAP · PROVEN — The replay surface reads columns nothing writes.**
`workshop_sessions.recording_url` / `recording_expires_at` have no writer anywhere in
`src/` (grep; only the replay readers `replay.ts:71-72,94-95` and a type in `server.ts`).
Replay/`{{replay_url}}`/nurture "watch the replay" copy depend on a manual DB write.
Related: `workshop_sessions.status` also has no writer (only Zoom columns are ever
updated), so the reminder pass's `.neq('status','cancelled')` filter is inert today —
workshop-level `status='published'` filtering is what actually stops reminders on cancel.

**WS-043 · E · POLISH · PROVEN — A consult request from the feedback form routes into the
spine but alerts no human.** `feedback/route.ts:70-95` seeds the referral/convert path
(SLA machinery applies) — but unlike registration (which sends `notifyFsa`), no immediate
FSA notification goes out for the highest-intent signal the subsystem produces.

**WS-044 · F · RISK · PROVEN — Two divergent stage taxonomies.** `src/lib/pipelines.ts`
(Prospect/Client: New Opportunity → … → Issued, GHL-era ids) vs the native
`opportunities.stage` CHECK (`prospect | fact_find | quoted_proposed | application |
underwriting_suitability | placed_issued | lost` — migration 009:250-252). D-2 must pick
which taxonomy a workshop opportunity uses; the native CHECK is what the database enforces.
Also held: stale docblocks still claim a "GHL Pipeline-A opportunity" is created on convert
(`registrations/[id]/route.ts:16-21`, `comms-engine.ts:568-572`) — none is; code wins;
comment debt for the batch that touches those files. Dead columns: `ghl_contact_id`,
`ghl_opportunity_id`, and `household_id` on registrations are never written.

**WS-045 · G · GAP · PROVEN — No roster export.** The report page delivers real per-session
metrics (attendance rate, no-show rate — structurally 0% until WS-039 — funnel, source
attribution, in-person/virtual split: `report/page.tsx:81-109`), but no CSV/XLSX roster or
report export exists anywhere in the workshop admin surface (grep across
`WorkshopRegistrations.tsx` + the admin pages; the repo has `exceljs` available). Sign-in
sheets and carrier/compliance requests need a manual DB pull today. (Plan: Batch 8.)

---

## §9 — Appended findings (2026-08-29, Surface G admin round; graded first-hand)

**WS-046 · G · GAP · PROVEN — There is no edit-workshop UI at all.** The only caller of
`PATCH /api/workshops/[id]` in the entire frontend is `WorkshopStatusControl`, and it sends
`{ status }` alone (`WorkshopStatusControl.tsx:21`); `WorkshopForm` is mounted only at
`/app/workshops/new`. Title, description, agenda, location, presenters, disclosure
selection, and `budget_spend` (so the report's cost-per-lead is permanently blank —
`report/page.tsx:83-88`) have no write path after creation. Together with WS-007 (schema
forbids date/venue/capacity), a created workshop is effectively immutable through the
product.

**WS-047 · G · GAP · PROVEN — A bare PATCH can set `status='compliance_approved'` without
an approval record.** `WorkshopPatchSchema` accepts every `WORKSHOP_STATUS` value
(schemas.ts:956); the route hard-gates only `'published'` (`[id]/route.ts:54-67`) — the
schema's own comment ("never a bare status flip", schemas.ts:915-916) is contradicted by
the code. Publish stays safe (trigger + route re-check the approval ref), but the
intermediate state misrepresents compliance standing. Related: content edits after
approval/publish never invalidate the stored approval (`compliance_approval_ref` is
untouched by the PATCH handler — held in full) — an approved workshop's description can be
freely rewritten (via API today, via WS-046's future UI tomorrow) while retaining its
approval. Re-approval-on-material-edit belongs in Batch 7.

**WS-048 · B · RISK · PROVEN — A client-supplied `session_id` is never verified to belong
to the workshop.** `register/route.ts:69` uses `v.data.session_id` directly (schema checks
UUID shape only) — a crafted registration binds to another workshop's session: its
reminders would quote the other event's venue/time, and it lands on the other session's
roster.

**WS-049 · G · GAP/POLISH · PROVEN (mixed) — Check-in door-operations gaps.**
- REFUTED from the trace round: “a failed tap is discarded after ~1.5 s” — in fact
  `retryPost` makes 3 attempts with backoff and a final failure reverts the tile AND
  toasts (`WorkshopCheckIn.tsx:32-41` + header comment) — nothing is silently lost.
- CONFIRMED gaps: no undo for a mis-tap (the server no-ops a re-scan; un-checking requires
  the separate roster reconcile), no no-show marking at the door, no offline queue (each
  tap needs network within the retry window), and the walk-in consent checkboxes are
  16 px targets (`h-4 w-4`, `:295-299`) below the 24 px WCAG 2.2 floor the rest of the
  surface meets.
- The approval queue (`/app/workshops/review`) is absent from global nav but IS linked
  in-context from a pending workshop's status control (`WorkshopStatusControl.tsx:45`) —
  POLISH, not a gap. Role mismatch is real: the review PAGE admits any fsa-portal role
  (`requireRole('fsa')`, session.ts:83-87) while the approve POST denies `licensed_staff`
  (`approve/route.ts:25` — fsa/super_admin only): staff can open a queue they cannot act
  on.

**WS-050 · G · RISK · HYPOTHESIS — Asset upload trusts the client Content-Type.**
`assets/upload/route.ts:44-46` stores the client-supplied MIME (route is role-gated;
exploitation needs a staff account). Not verified end-to-end; graded honestly as
HYPOTHESIS for the Batch 7 hardening list.

---

## §10 — Appended findings (2026-08-29, Surface H frontend round; graded first-hand)

**WS-051 · H · BROKEN · PROVEN — Every date/time on the public workshop funnel renders in
the SERVER's timezone.** The detail page (`workshops/[slug]/page.tsx:44-49`), register
page (`register/page.tsx:44-45`) and hub cards (`WorkshopHubFilters.tsx:13-15`) all call
`toLocaleString('en-US', {...})` with **no `timeZone`** — on Vercel (UTC) a 6:00 PM
Central session displays as “11:00 PM”, and with `dateStyle:'full'` an evening event shows
the **wrong day**. The repo's own `TimeCell` (`ui/time.tsx:60`) is used zero times on the
funnel, and these pages read the legacy `workshops.scheduled_at` rather than the session's
`starts_at` + IANA `timezone` — which the ack email path DOES use correctly
(`register/route.ts:174-184`). Registrants see one time on the site and another in email.

**WS-052 · H · BROKEN · PROVEN — A validation failure can be invisible on the live
register form.** `WorkshopRegisterFormSite` renders the general error only when
`fieldErr === undefined` (`:101-105`) and renders field errors only under name/email/phone
(`:112,119,125`); a server rejection naming any other schema field (`workshop_id`,
`session_id`, `chosen_delivery`) sets `fieldErr` and displays **nothing** — the button
just un-busies. Related fork-drift: this form drops the `aria-describedby` error
association the shared `Field` primitive provides, and `WorkshopForm` (admin) marks
`aria-invalid` but renders no error text at all (toast-only).

**WS-053 · H · BROKEN · PROVEN — Cancelling a published workshop is a single unconfirmed
click** (`WorkshopStatusControl.tsx:68-72` — no confirm dialog on a destructive,
registrant-affecting action; DESIGN/§7 requires confirmation), after which the public page
404s for existing registrants (the public loader nulls non-published — `public.ts:50`)
with no cancellation notice (WS-008).

**WS-054 · H · BROKEN · PROVEN — Filtered-empty renders a headerless-void table on
`/app/workshops`.** The empty-state guard tests `allWorkshops.length === 0` while rows map
over `filtered` (`page.tsx:98,113-128`) — an active filter with no matches shows column
headers over zero rows with no message or clear-filters action.

**WS-055 · H · RISK · PROVEN — The `.msite` focus indicator is cancelled on form
controls.** `.msite :focus-visible{outline:3px solid var(--red)}` (`marketing.css:33`) is
overridden by higher-specificity `outline:none` on `.field input/select/textarea:focus`
(`:255`) and `.wselect:focus` (`:367`), leaving only a 1.5px border-color change — a weak
indicator on exactly the elements keyboard users interact with (WCAG 2.4.7 exposure).

**WS-056 · H · GAP/POLISH · PROVEN (grouped) — Design-system and state debt on the
funnel.** Hardcoded hex colors in `.msite` surfaces (`[slug]/page.tsx:91,114` — DESIGN.md
§6.5 forbids by name); three hand-rolled segmented controls in `WorkshopFeedbackForm`
(§7); a third forked KPI tile on the report page; guardrail gold mislabeling a fund-family
name on review; no loading boundary on the public routes (4+ sequential DB queries,
`public.ts:41-99`); hub filter state not URL-persisted and filtered-empty offers no
clear action; raw internal error strings rendered on six admin surfaces; `/events` +
`EventsIndex` is an orphaned client-fetched duplicate unreachable from site nav;
`docs/routes.md`/`docs/sitemap.md` document two `/events` routes that don't exist and omit
the `/workshops` funnel entirely (docs stale — code wins); check-in disclosure toggles
lack `aria-expanded`; admin form's timezone default is a hidden hardcoded
`America/Chicago` with no assumption badge.

**WS-057 · H · RISK · HYPOTHESIS — Honeypot + browser autofill silently discards a real
registration.** A password-manager/autofill that fills the visually-hidden `company` field
gets the fake-success response (`register/route.ts:25-27`) and the confirmation screen
with no record created. Mechanism proven in code; real-world autofill frequency not
verifiable statically. Mitigation (Batch 2): the field already sets `autocomplete="off"`; add a
time-trap signal and log honeypot hits for monitoring instead of silently succeeding.

---

## §11 — Appended findings (2026-08-29, Surface I tests round; graded first-hand — WS-019 refined)

**WS-058 · I · BROKEN · PROVEN — Specific false-green assertions, held verbatim.**
- Tautology: `ok('America/Chicago resolves to CDT/CST (−5 or −6)', chi === -5 || chi === -6)`
  (`tests/workshop-comms.test.mjs:67-68`) — America/Chicago is ALWAYS one of the two, so a
  wrong-offset regression (e.g. returning −6 in July) still passes; the correct pin for the
  July fixture is −5.
- Comment-matching “guarantees”: `tests/workshop-delivery.test.mjs:207` asserts
  `/never by display name/` and `:223-224` asserts `/non-fatal|Never blocks registration/`
  — these match COMMENT text, so deleting the behavior while keeping the comment stays
  green (same class as `workshop-comms.test.mjs:112-120`, recorded in WS-019).
- The workshop tests compile production TS with explicit CLI flags
  (`npx tsc src/... --module commonjs ...`, `workshop-comms.test.mjs:38-42`), which
  bypasses `tsconfig.json` — strict mode is NOT applied in the tests' compile step (RISK:
  a strict-only type error would pass the test compile and fail `npm run type-check`,
  which still catches it at the gate — mitigated, recorded for accuracy).
- Confirmed absences (WS-019 restated with the sweep's evidence): no test executes
  `comms-engine.ts`, any workshop route, or the cron; reminder idempotency is asserted
  only as a truth table + a regex on the migration text — never against a database
  (`workshop-comms.test.mjs:103,120`); no concurrency, cancellation-notice, or waitlist
  test exists (the features themselves are absent — WS-004/008/010).

This closes the nine-surface trace sweep (A–I all traced). Adversarial verify verdicts
append below as they complete.

---

## §12 — Adversarial verify round: Surface B verdicts (2026-08-29)

The independent evidence-checker re-opened every Surface B citation: **13 of 14 findings
CONFIRMED at their stated severity** (legacy route, duplicates, consent-tier reuse,
missing two-tier model, reminder-vs-consent promise break, /events disclosure evidence,
waitlist CTAs, guest count, capacity atomicity + hardcoded 50, consent silo, throttle,
ack-bypasses-suppression).

**CORRECTION to WS-013 (frequency caps) — the checker's dispute is upheld.** The claim
“frequency caps are a guaranteed no-op for workshop sends” was over-broad: `sendThroughGate`
resolves `convMemberId` from the conversation (`send.ts:512-529` —
`getOrCreateConversation(channel, to)` can attach an existing member by contact), and
`resolveSendPolicy({ memberId: convMemberId, … })` (`send.ts:747-755`) then applies caps.
Accurate statement: **frequency caps apply only when the recipient's phone/email resolves
to an existing member-linked conversation; a net-new workshop registrant (no member — the
common case for a public seminar lead) has no per-recipient caps.** Epistemic grade for
the no-cap case: PROVEN for null-member; the original universal claim is WITHDRAWN.

**Checker misses, verified first-hand and adopted:**

**WS-059 · B · RISK · PROVEN — Zoom provisioning runs inside the public POST with no
timeout.** Neither Zoom fetch carries an `AbortSignal`/timeout (`zoom/client.ts:35,85` —
grep empty), and `provisionZoomForRegistration` is awaited inside the public register
handler (`register/route.ts:158-162`) — a hung Zoom API stalls every public registration
response for the platform's default fetch timeout.

**WS-060 · B/A · BROKEN · PROVEN — Capacity is counted workshop-wide but registration
binds per-session.** The capacity count is `.eq('workshop_id', …)` (`register/route.ts:60-63`)
while the insert carries the resolved `session_id` (`:107`) — for a multi-session workshop
the sessions share one global cap; per-session fullness is unrepresentable. Refines
WS-004; Batch 2's claim function must count per-session.

**WS-061 · B · RISK · PROVEN — Guardrail ordering: the honeypot short-circuit precedes the
rate limiter.** `register/route.ts:25-27` returns fake-success before `rateLimit` at
`:29-32` — honeypot traffic never consumes the per-IP window (free probing), and an
autofill-victim's drop (WS-057) is invisible to throttle telemetry too.

**Also adopted (small, PROVEN):** the legacy route's GET is equally unauthenticated and
returns title/schedule/seat-math for ANY workshop id including drafts (extends WS-002 —
already in its evidence); registrant email is stored un-normalized
(`register/route.ts:109`; the schema never lowercases — the legacy route did; Batch 2's
`lower(email)` unique index must normalize on write too); the register page's “Online —
join link emailed after you register” (`register/page.tsx:49`) is a second unconditional
promise defeated by the consent gate (WS-012); `clientIp` trusts `x-forwarded-for` with no
trusted-proxy handling (`rate-limit.ts:40-47`) — whether a client-supplied XFF can rotate
the limiter key on Vercel is platform behavior, NOT VERIFIED. **Verified-OK adopted:** the
`/unsubscribe` page path is sound end-to-end (posts to the opt-out API which writes the
enforced store) — WS-034's relative-URL-in-email defect stands, but the surface it points
at works.

---

## §11a — False-green sweep, all 18 workshop-touching test files (2026-08-29, owner directive)

Method: one analyst per file (18 subagents), each required to open the production source
and name the exact comment/import/declaration line satisfying every flagged regex; the
coordinating auditor personally re-held every instance in the five `workshop-*` files and
sampled the rest (`operational-email`, `quiet-hours-scope`, `comms-policy`,
`comms-console` instances all re-opened first-hand). Pattern definitions per the owner's
directive: **A** = true for every legal input; **B** = coupled to comments, imports, or
the absence of declarations rather than behavior. Migration-DDL text assertions were
excluded as legitimate (the DDL text IS the artifact).

**TOTAL: 41 instances — 7 pattern A, 34 pattern B — across 10 of 18 files.
8 files are fully clean** (every assertion executes compiled production code with pinned
expectations): `comms-campaign-config`, `comms-email-senders`, `comms-suppression`,
`comms-template-filters`, `cron-activation`, `public-intake`, `social-engagement`,
`workshops-gate`.


**`tests/comms-console.test.mjs`** — 1 instance(s):

- **L123** · `short GSM body is one segment; >160 GSM chars split; unicode shortens the budget` · **A (tautology)**
  - Purports: That a UCS-2 (unicode) body uses the shortened per-segment budget (70 single / 67 multi UTF-16 code units instead of GSM-7's 160/153), i.e. that unicode content actually changes the segment math.
  - Cannot fail because: smsSegmentInfo (src/lib/comms/console.ts lines 160-181) returns segments >= 1 for every possible input by construction: units === 0 returns 1 explicitly (lines 177, 180), the UCS-2 <= 70 branch is Math.max(1, 1) = 1 (line 176), and both Math.ceil branches yield >= 2. So `segments >= 1` is true for the function's entire output range. The fixture 'emoji 😀 here' is 13 UTF-16 code units, pinning the correct answer to exa

**`tests/comms-policy.test.mjs`** — 1 instance(s):

- **L33** · `all 10 message purposes map to a consent purpose for both channels` · **A (tautology)**
  - Purports: That every one of the 10 message purposes resolves to its (correct) required consent purpose on both SMS and email — i.e., the purpose→consent mapping in purposeToConsentPurpose is total and meaningful for the whole purpose enum.
  - Cannot fail because: purposeToConsentPurpose (src/lib/comms/purpose.ts:98-124) is a switch whose `default:` branch (purpose.ts:121-122, verified by grep) returns 'TRANSACTIONAL_SMS'/'TRANSACTIONAL_EMAIL', and every ConsentPurpose union member is a non-empty string literal — so the assertion `typeof cp === 'string' && cp.length > 0` is true for every input in every legal state of the function, even with the entire purpose-specific mapping

**`tests/operational-email.test.mjs`** — 6 instance(s):

- **L229** · `forms.ts routes email through lib/messaging sendEmail (no direct new Resend)` · **B (comment/absence-coupled)**
  - Purports: That forms.ts actually routes its transactional email through the shared guarded sender in lib/messaging (the test's routing claim).
  - Cannot fail because: The regex's only possible satisfier is an import statement: grep shows its sole match in src/lib/forms.ts is line 9, `import { sendEmail } from '@/lib/messaging'`. Delete the sendEmail call at forms.ts:137 (or route the send elsewhere) and leave the now-unused import, and this assertion stays green — an import line alone satisfies it. The sibling assert on test line 230 (/sendEmail\(/, matching only the executable ca
- **L236** · `briefing/send routes through lib/messaging sendEmail (no direct new Resend)` · **B (comment/absence-coupled)**
  - Purports: That the briefing/send route sends through the shared lib/messaging sender.
  - Cannot fail because: Grep of src/app/api/briefing/send/route.ts shows the regex's sole match is line 6, `import { sendEmail } from '@/lib/messaging'` — an import line. Remove or bypass the sendEmail call at route.ts:122 while leaving the unused import and this assertion still passes; only the sibling /sendEmail\(/ assert (test line 237, matching the executable call at route.ts:122) binds to actual usage.
- **L245** · `workshops/register confirmation goes through the shared sender and logs failures` · **B (comment/absence-coupled)**
  - Purports: That the workshop-registration confirmation email goes through the shared lib/messaging sender.
  - Cannot fail because: Grep of src/app/api/workshops/register/route.ts shows the regex's sole match is line 5, `import { sendEmail, emailConfigured } from '@/lib/messaging'` — an import line. Delete the send at route.ts:120, keep the import, and this assertion stays green; the executable binding lives in the sibling assert at test line 246 (/const sent = await sendEmail\(/, matching only route.ts:120).
- **L248** · `workshops/register confirmation goes through the shared sender and logs failures` · **B (comment/absence-coupled)**
  - Purports: That a failed confirmation-email send is logged rather than silently dropped.
  - Cannot fail because: The regex matches ANY console.error/warn anywhere in the file, and grep shows three matches in src/app/api/workshops/register/route.ts: line 96 (`console.error('[workshop-register] insert error:', regErr)` — the registration-insert error log, unrelated to email), line 122 (the actual email-failure log), and line 125. Delete the email-failure log at 122, leaving `if (!sent.ok) { /* ignore */ }` — the sibling assert /i
- **L258** · `no operational send gates on the marketing consent table` · **B (comment/absence-coupled)**
  - Purports: That transactional sends (forms link, workshop confirmation, briefing) always go out regardless of marketing consent — i.e. no consent gating exists in these three files.
  - Cannot fail because: Negative-only text assertion: grep confirms zero occurrences of 'consents' in all three files today, and the guarantee holds vacuously for an emptied file. It pins one literal spelling only — consent gating added via `.from("consents")` (double quotes), a table-name constant, or a consent-check helper import stays green while the purported behavior is broken. Only the forms.ts leg has real behavioral backup (the exec
- **L264** · `no hardcoded from-address — all senders resolve RESEND_FROM_EMAIL` · **B (comment/absence-coupled)**
  - Purports: That no sender hardcodes a from-address — every sender resolves it from RESEND_FROM_EMAIL.
  - Cannot fail because: Presence of the token anywhere in src/lib/messaging.ts satisfies it: grep shows matches at messaging.ts:16 (`const from = process.env.RESEND_FROM_EMAIL` inside emailConfigured()) and :46 (inside sendEmail). Hardcode the from in sendEmail (e.g. `const from = 'me@gmail.com'`) and the assertion stays green via the unrelated read in emailConfigured() at line 16; a comment containing `process.env.RESEND_FROM_EMAIL` would 

**`tests/quiet-hours-scope.test.mjs`** — 1 instance(s):

- **L146** · `invalid timezone falls back to the default zone; default is America/Chicago` · **A (tautology)**
  - Purports: That the zero-argument call path of localHourInTimeZone() resolves the current hour in the default America/Chicago zone (the block's label claims default-zone fallback behavior; this assert is the only coverage of the no-arg defaults).
  - Cannot fail because: 0-23 is the entire legal output range of an hour-of-day function, so the assertion is true for every wrong-but-legal answer: the old hardcoded CST fallback `(at.getUTCHours() - 6 + 24) % 24` (src/lib/comms/local-time.ts line 186), a bug returning the raw UTC hour, or the hour in any other timezone all yield an integer in 0-23 and pass. Only a NaN/non-integer return could trip it — it checks shape, not the default-zon

**`tests/transactional-notifications.test.mjs`** — 2 instance(s):

- **L81** · `FSA inbox resolves env → reply-to → CONTACT.email (precedence)` · **A (tautology)**
  - Purports: With FSOS_NOTIFY_EMAIL and RESEND_REPLY_TO both unset, fsaNotificationInbox() falls back to the specific CONTACT.email default — the third leg of the documented env → reply-to → CONTACT.email precedence (src/lib/notifications/transactional.ts lines 32-38).
  - Cannot fail because: The regex /@/ is satisfied by every email-shaped string, i.e. every legal output of fsaNotificationInbox(). The fixture state pins exactly one right answer — CONTACT.email is 'mathelus@farmersagent.com' (src/lib/site.ts line 42) — but the assertion accepts any address: if the fallback were broken to return RESEND_FROM_EMAIL, BUSINESS mail, or a hardcoded placeholder like 'onboarding@resend.dev', it still contains '@'
- **L191** · `no transactional intake send gates on the marketing consent table` · **B (comment/absence-coupled)**
  - Purports: The transactional intake sends (visitor acks and FSA alerts from the contact route, workshop register route, and the shared helper) are never gated on the marketing `consents` table — the regression class behind the original 'no emails' outage the file header 
  - Cannot fail because: It is a negative-only absence check for one exact textual spelling in three files, but the repo's actual consent gating lives in called modules the regex never reads: src/lib/comms/policy-resolver.ts line 49 (`db.from('consents').select('status')...`), simulation.ts line 36, and consent-population-run.ts lines 91/137. Re-introducing the outage the realistic way — routing the route's send through the marketing dispatc

**`tests/workshop-comms.test.mjs`** — 6 instance(s):

- **L68** · `America/Chicago resolves to CDT/CST (−5 or −6)` · **A (tautology)**
  - Purports: utcOffsetHoursForTimezone resolves a real IANA zone to the correct UTC offset at the pinned instant (Date.UTC(2026, 6, 20, 18, 0), i.e. July 20 2026, when America/Chicago is unambiguously CDT = −5).
  - Cannot fail because: The disjunction covers America/Chicago's entire legal output range: the zone is always −5 or −6, so any DST-handling bug that returns standard time in July still passes. Worse, −6 is also the function's total-failure fallback (src/lib/workshops/reminders.ts:154 'const DEFAULT = -6' returned from the catch at lines 174–176), so an implementation whose Intl resolution throws for every zone also passes. The July fixture
- **L113** · `engine sends ONLY through the existing gate (sendThroughGate), never a raw sender` · **B (comment/absence-coupled)**
  - Purports: Every client-facing dispatch in the engine goes through the compliance gate (sendThroughGate), and no raw sender is used.
  - Cannot fail because: /sendThroughGate/ is satisfied by the header comment at src/lib/workshops/comms-engine.ts:6 ('goes through the EXISTING dispatcher/gate (sendThroughGate)') and by the import at line 26, independent of the one real call at line 361 — delete the gated dispatch, keep the comment/import, stay green. The three negative conjuncts only ban two specific identifiers and one import path; a raw fetch() to Twilio/Resend or any s
- **L114** · `durable per-channel consent guard is read + fed to the gate` · **B (comment/absence-coupled)**
  - Purports: At send time the engine reads the durable per-channel consent state from workshop_consent_events and passes that fact to the gate (durableConsentGranted: consent at the sendThroughGate call).
  - Cannot fail because: /durableConsentGranted/ matches the header comment at src/lib/workshops/comms-engine.ts:15 (and the JSDoc at 231 and the comment at 358); /workshop_consent_events/ matches the header comment at line 14 (and JSDoc at 229); /action\s*===\s*'granted'/ matches only line 242, which sits inside the exported helper's declaration (lines 233–243). None of the three conjuncts anchors to the send-path usage: delete the gate-fee
- **L116** · `is_security workshops are excluded from selection` · **B (comment/absence-coupled)**
  - Purports: The reminder pass's selection skips securities workshops (the filter 'workshop.is_security === true) continue' at comms-engine.ts:415), so securities registrants never enter the automated reminder cadence.
  - Cannot fail because: The assertion is a DISJUNCTION and its second arm /is_security === true/ matches ANY occurrence of that text in the file for any purpose: grep shows it matches src/lib/workshops/comms-engine.ts:507 (the nurture-pass FFS branch) and line 613 (constructing the lead-context object), in addition to the actual selection filter at line 415. Delete the selection exclusion at line 415 entirely — securities workshops now flow
- **L117** · `is_security registrants route to FFS (not the automated segments)` · **B (comment/absence-coupled)**
  - Purports: During the nurture pass, registrants of securities workshops are actually routed to the FFS-supervised path (the call at comms-engine.ts:508) instead of entering automated nurture segments.
  - Cannot fail because: Both regexes are satisfied entirely by the uncalled function declaration: /routeSecuritiesToFfs/ matches the declaration at src/lib/workshops/comms-engine.ts:557 (grep: only lines 508 call, 557 declaration) and /is_security: true/ matches line 558 inside that same function body. Delete the call site at line 508 — securities registrants then fall through into the automated segment path — and the declaration alone keep
- **L119** · `missing/placeholder template → deferred (template_not_approved), never sent` · **B (comment/absence-coupled)**
  - Purports: When no approved+active template exists for a (kind, channel) slot, the engine records the slot as deferred with reason template_not_approved and dispatches nothing (the block at comms-engine.ts:313–316).
  - Cannot fail because: /template_not_approved/ matches the header comment at src/lib/workshops/comms-engine.ts:20 ('(reason template_not_approved) and nothing is sent.') and the JSDoc at line 192, in addition to the real code at lines 314–315. Delete the entire template gate (lines 311–316) so unapproved slots proceed straight to dispatch, keep the comments, and the single-regex assertion stays green — it never checks the deferral, the fin

**`tests/workshop-delivery.test.mjs`** — 14 instance(s):

- **L198** · `answers CRC challenge (zoomCrcResponse)` · **B (comment/absence-coupled)**
  - Purports: The Zoom webhook route responds to Zoom's URL-validation CRC challenge event
  - Cannot fail because: Both regexes are satisfied by the route's import lines alone: src/app/api/webhooks/zoom/route.ts:4 `import { verifyZoomSignature, zoomCrcResponse } from '@/lib/zoom/webhook'` matches /zoomCrcResponse/, and line 5 `import { parseZoomParticipantEvent, ZOOM_CRC_EVENT } from '@/lib/workshops/delivery'` matches /ZOOM_CRC_EVENT/. Delete the CRC handling block (lines 48-50), keep the imports, and the test stays green.
- **L199** · `verifies HMAC signature on events` · **B (comment/absence-coupled)**
  - Purports: The webhook route actually verifies the HMAC signature before processing events
  - Cannot fail because: /verifyZoomSignature/ is satisfied by the import at src/app/api/webhooks/zoom/route.ts:4. Delete the verification call and reject branch (lines 62-63) so every event is processed unsigned, keep the import, and the assertion still passes.
- **L202** · `correlates by token then writes attendance` · **B (comment/absence-coupled)**
  - Purports: The webhook route resolves the registrant by token and writes an attendance row
  - Cannot fail because: Both identifiers appear in the import statement at src/app/api/webhooks/zoom/route.ts:7-8 (`resolveWebhookTarget,` / `applyWebhookAttendance,`). Delete the calls at lines 77 and 85 (so no attendance is ever written), keep the import, and both regexes still match.
- **L207** · `resolveWebhookTarget correlates by zoom_registrant_id (token), not name` · **B (comment/absence-coupled)**
  - Purports: Webhook correlation matches registrants by the Zoom registrant token and never by display name
  - Cannot fail because: The load-bearing half, /never by display name/, matches ONLY a JSDoc comment: src/lib/workshops/server.ts:517 `* registrant TOKEN — never by display name (§5). Resolution order:`. /zoom_registrant_id/ is also satisfied by comments (lines 519 and 740) independent of the executable .eq() at line 541. Rewrite resolveWebhookTarget to match on user_name, keep the doc comment, and the test stays green — the 'not name' guar
- **L210** · `provisioning skips cleanly when zoom disabled` · **B (comment/absence-coupled)**
  - Purports: provisionZoomForRegistration is a clean no-op when Zoom credentials are not configured
  - Cannot fail because: /zoom_disabled/ matches the JSDoc comment at src/lib/workshops/server.ts:634 (`*   - Zoom unconfigured → skip (zoom_disabled) — a clean no-op, booking/register still succeed`) independently of the executable guard at line 767. Delete the `if (!zoomEnabled()) return ...` guard, keep the comment, stay green.
- **L214** · `writes workshop_feedback` · **B (comment/absence-coupled)**
  - Purports: The feedback route persists submissions to the workshop_feedback table
  - Cannot fail because: /workshop_feedback/ matches the header comment at src/app/api/public/workshops/feedback/route.ts:13 (`// registrant's join_token. Writes workshop_feedback (rating 1–5, most_useful,`) independently of the upsert at line 51. Delete the upsert, keep the comment, and the assertion still passes.
- **L215** · `consult request reuses convertRegistrationToLead (firewalls is_security → FFS)` · **B (comment/absence-coupled)**
  - Purports: Consult requests route through convertRegistrationToLead so is_security workshops are firewalled to the FFS-supervised path
  - Cannot fail because: /convertRegistrationToLead/ is satisfied by the import at src/app/api/public/workshops/feedback/route.ts:7 and the comment at line 16, independent of the call at line 78. Delete the call (or replace it with a direct lead insert that bypasses the securities firewall), keep the import, and the test stays green. Note the regex never inspects is_security handling at all — the firewall claim in the label is entirely unins
- **L216** · `honeypot on company field` · **B (comment/absence-coupled)**
  - Purports: Bot submissions that fill the hidden company field are silently dropped
  - Cannot fail because: A single comment satisfies both conjuncts: src/app/api/public/workshops/feedback/route.ts:25 `// Honeypot — bots fill \`company\`; silently accept without writing.` matches /honeypot/i and /company/ (line 20's `// Guardrails: honeypot, ...` also matches the second half). Delete the executable check at line 26, keep the comments, stay green.
- **L217** · `per-IP rate limited` · **B (comment/absence-coupled)**
  - Purports: The public feedback route enforces a per-IP rate limit
  - Cannot fail because: /rateLimit/ is satisfied by the import at src/app/api/public/workshops/feedback/route.ts:4 (`import { rateLimit, clientIp } from '@/lib/http/rate-limit'`). Delete the enforcement at line 31, keep the import, and the assertion still passes.
- **L218** · `resolves registration by join_token (never name)` · **B (comment/absence-coupled)**
  - Purports: Feedback is tied to a registration via the personal join token, never by name/email
  - Cannot fail because: /join_token/ matches comments at src/app/api/public/workshops/feedback/route.ts:13 and 42 (`// Resolve the registration by its personal join_token (never by name/email).`) independently of the .eq() at line 46. Switch the lookup to email or name, keep the comments, stay green — and the 'never name' half of the label is not checked by any regex at all.
- **L222** · `provisions Zoom best-effort after registration` · **B (comment/absence-coupled)**
  - Purports: The register route actually triggers Zoom registrant provisioning after creating a registration
  - Cannot fail because: /provisionZoomForRegistration/ is satisfied by the import at src/app/api/public/workshops/register/route.ts:8. Delete the call at line 159 so no registrant is ever provisioned, keep the import, and the test stays green.
- **L223** · `provisioning failure is non-fatal (registration still succeeds)` · **B (comment/absence-coupled)**
  - Purports: A Zoom provisioning failure never fails the registration request
  - Cannot fail because: The second alternative matches the comment at src/app/api/public/workshops/register/route.ts:153 (`// Best-effort per-registrant Zoom provisioning (spec §A). Never blocks registration:`), and the first matches log copy inside the catch at line 161. Remove the try/catch so a provisioning error propagates and fails registration, keep the line-153 comment, and the assertion still passes — it asserts prose, not the error
- **L228** · `uses evaluateReplayAccess (consent-first order)` · **B (comment/absence-coupled)**
  - Purports: The replay loader gates access through the shared evaluateReplayAccess function in consent-first order
  - Cannot fail because: /evaluateReplayAccess/ matches the header comment at src/lib/workshops/replay.ts:3 and the import at line 11, independent of the call at line 70. Delete the gate call and serve the recording unconditionally, keep the comment/import, and the test stays green; the 'consent-first order' claim is never checked textually or behaviorally here (it is only proven for the pure function in Part 1).
- **L247** · `workshop detail renders the delivery panel` · **B (comment/absence-coupled)**
  - Purports: The staff workshop detail page loads the delivery summary and renders the delivery panel
  - Cannot fail because: Both regexes are satisfied by the import lines at src/app/(fsa)/app/workshops/[id]/page.tsx:12 (`import { WorkshopDeliveryPanel } from ...`) and 13 (`import { loadDeliverySummary, type DeliverySummary } from ...`). Delete the data load at line 79 and the JSX render at line 160, keep the imports, and the test stays green.

**`tests/workshop-ops.test.mjs`** — 5 instance(s):

- **L198** · `non-securities convert routes through convertRegistrationToLead` · **B (comment/absence-coupled)**
  - Purports: The non-securities convert_to_lead path actually calls the convertRegistrationToLead service helper (route -> service layering, native conversion marking).
  - Cannot fail because: In src/app/api/workshops/registrations/[id]/route.ts the regex is satisfied by the import at line 7 (`import { convertRegistrationToLead } from '@/lib/workshops/server'`) and by the comment at line 125 (`//    referral seeded above is the FSOS-native lead artifact; convertRegistrationToLead`). Delete both call sites (lines 67 and 128) — i.e. remove the routing behavior entirely — and the import/comment keep the test 
- **L200** · `check-in uses resolveCheckIn for idempotent no-op` · **B (comment/absence-coupled)**
  - Purports: The server check-in flow consults resolveCheckIn so a second scan of an already-attended registrant is an idempotent no-op.
  - Cannot fail because: In src/lib/workshops/server.ts the regex is satisfied by the import at line 8 (`import { resolveCheckIn, type AttendanceStatus } from './attendance'`). The sole call is at line 204; delete it (e.g. always write an attendance row, breaking idempotency) while keeping the import and the assertion stays green. Nothing here executes the check-in flow to prove the no-op — Part 1 only tests the pure function in isolation, n
- **L204** · `convert helper marks the native conversion (lead_converted_at), no GHL` · **B (comment/absence-coupled)**
  - Purports: convertRegistrationToLead stamps lead_converted_at on the registration and returns routed:'native', with no external GHL push.
  - Cannot fail because: Every conjunct is satisfiable without the behavior. /lead_converted_at/ matches the comment at server.ts line 413 (`// Non-securities: mark the registration as a converted FSOS lead (lead_converted_at).`) and the compile-time-erased type field at line 435, independent of the executable uses at lines 480/486. /routed: 'native'/ matches the type-union member at line 439 (`| { ok: true; routed: 'native'; converted: bool
- **L206** · `check-in route supports token + walk-in` · **B (comment/absence-coupled)**
  - Purports: The kiosk check-in route handles both a join-token scan and a walk-in registration path.
  - Cannot fail because: In src/app/api/workshops/[id]/check-in/route.ts a single import line satisfies BOTH conjuncts: line 8 (`import { checkInByToken, addWalkIn } from '@/lib/workshops/server'`). The actual calls are at lines 51 and 82; delete either or both branches (removing token or walk-in support entirely) and the import alone keeps the test green.
- **L208** · `attendance reconcile route is staff-gated + audited` · **B (comment/absence-coupled)**
  - Purports: The attendance reconcile route enforces staff RBAC before reconciling, and audits the mutation.
  - Cannot fail because: In src/app/api/workshops/[id]/attendance/route.ts both conjuncts are satisfied by import lines: /requirePermission/ by line 4 (`import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'`) and /reconcileAttendance/ by line 7 (`import { reconcileAttendance } from '@/lib/workshops/server'`). Delete the gate call at line 22 and the reconcile call at line 36 and the imports keep it green. Additionally th

**`tests/workshop-zoom-provision.test.mjs`** — 4 instance(s):

- **L126** · `no securities/financial data in the create body` · **A (tautology)**
  - Purports: The securities firewall: createZoomMeeting never leaks securities/financial data into the Zoom meeting-create request body.
  - Cannot fail because: The body under test is built by src/lib/zoom/client.ts (lines 148-160) exclusively from the test's own input — {topic: 'Retirement 101', startTime, durationMinutes: 45, timezone: 'America/Chicago'} — plus fixed literal keys (topic, type, start_time, duration, timezone, settings.join_before_host/waiting_room/approval_type). No securities or financial data exists anywhere in the test's scope, so there is no data path b
- **L179** · `meeting creation is non-fatal (does not block workshop create)` · **B (comment/absence-coupled)**
  - Purports: A Zoom meeting-creation failure never blocks the workshop-create route from succeeding.
  - Cannot fail because: Verified by grep against src/app/api/workshops/route.ts: /non-fatal/ matches only the console.error MESSAGE STRINGS at lines 89 and 92 ('[workshop] zoom meeting creation (non-fatal, retryable):') — descriptive log text, not control flow. /catch/ matches line 91 but also the route-wide outer '} catch (e) {' at line 112, which exists in every route regardless of the zoom wiring. Change line 91's catch to rethrow, or re
- **L195** · `start_url column flagged HOST-ONLY (never returned/logged)` · **B (comment/absence-coupled)**
  - Purports: The Zoom host start_url is never returned to a client or written to a log.
  - Cannot fail because: Verified by grep against src/lib/workshops/server.ts: the regex matches exactly one place — the trailing comment on line 682: 'zoom_start_url: meeting.startUrl ?? null, // HOST-ONLY column; never returned to a client or logged'. It is a verbatim comment match. Add 'console.log(meeting.startUrl)' or return startUrl from ensureSessionZoomMeeting while keeping the comment, and the assertion still passes; delete the enti
- **L196** · `EnsureMeetingOutcome does NOT return start_url to callers` · **B (comment/absence-coupled)**
  - Purports: The outcome ensureSessionZoomMeeting returns to callers never carries the host-only startUrl.
  - Cannot fail because: Negative-only source-text check with a vacuous fallback, and it inspects the wrong slice. 'EnsureMeetingOutcome' occurs twice in src/lib/workshops/server.ts (line 623 'export type EnsureMeetingOutcome =' and line 644 '): Promise<EnsureMeetingOutcome> {'), so split(...)[1] is only the text BETWEEN those two occurrences — the type union, doc comment, and function signature. 'export type ProvisionOutcome' (line 734) is 

**`tests/workspace-registry.test.mjs`** — 1 instance(s):

- **L168** · `registry-covers-legacy-nav (all portals): no fan-out destination dropped` · **A (tautology)**
  - Purports: That the workspace fan-out shifted no portal boundary — each legacy href resolves to a workspace in the SAME portal (per the comment on line 167: 'And the boundary did not shift: it resolves to a workspace in the same portal.').
  - Cannot fail because: activeWorkspace(portal, pathname) is portal-filtered by construction: src/lib/workspaces/registry.ts:758 does `const list = portalWorkspaces(portal)`, portalWorkspaces is `WORKSPACES.filter((w) => w.portal === portal)` (registry.ts:727), and the function returns `winner ?? list[0]` (registry.ts:768). Every workspace it can return therefore has .portal === portal for ANY pathname — even '/admin/xyz' passed with portal


CLEAN FILES (8): `tests/comms-campaign-config.test.mjs`, `tests/comms-email-senders.test.mjs`, `tests/comms-suppression.test.mjs`, `tests/comms-template-filters.test.mjs`, `tests/cron-activation.test.mjs`, `tests/public-intake.test.mjs`, `tests/social-engagement.test.mjs`, `tests/workshops-gate.test.mjs`

TOTALS: pattern A = 7, pattern B = 34, TOTAL = 41 across 18 files (10 files with instances)

---

## §11b — Baseline re-grade (2026-08-29, owner directive)

**The void:** because §11a proves the suite contains assertions that cannot fail, the
Phase 0 result "existing test suite green" (§0.1) is **not evidence of behavior**. §0.1's
"no REPOSITORY failures at baseline" is hereby restated as: *the repository's gates exit
zero* — a statement about exit codes (command output), warranting nothing about runtime
correctness. WS-001 is the constructive proof of the gap: 192 green files with a dead
engine.

**Re-grade scan:** every finding WS-001…WS-061 was checked for evidence that consists of
a passing test rather than traced code or command output. **Result: zero findings
re-graded** — every ledger entry's evidence is quoted source at file:line, executed
command output (the WS-001 Postgres proof, the §0.1 gate runs), or both. Test files are
cited only (a) as the SUBJECT of findings (WS-019, WS-058, §11a) or (b) as reusable
patterns (booking's idempotency harness), never as proof of a behavioral claim.

**Two honesty annotations recorded in the same spirit (unexecuted runtime assumptions,
not test-derived, but held to the same bar):**
- **WS-016 (send-once idempotency):** the static layers are PROVEN (unique DDL 040:184;
  the guarded-update SQL semantics). The RUNTIME claim "two overlapping ticks can never
  both win" additionally assumes supabase-js/PostgREST surfaces a 23505 unique violation
  as `ins.error` rather than throwing — its documented contract, but unexecuted here.
  Annotated **PROVEN (static) / NOT VERIFIED (runtime)** until Batch 0/1's DB-level proof
  executes the claim path. (Independently flagged by the Surface D checker.)
- **WS-028 / WS-027 consequence clauses** (duplicate referrals under overlap; stranded
  `'sending'` on a thrown send): the missing-guard claims are PROVEN static; the
  runtime-overlap/exception consequences are HYPOTHESIS pending the same proofs. The §12
  checker rounds reached the same grades independently.

**§12 grading basis:** the adversarial verify rounds were launched before this directive,
so the re-grade filter is applied at transcription: each verdict adopted into §12 was
checked to rest on quoted source (all Surface A/B/C/D/E/F verdicts do — none cites a
green test as evidence). The same filter applies to the G/H/I rounds when they land.
Verdicts already issued in §12 (Surface B) were re-checked on this basis: all stand.

---

## §12 (continued) — Verify verdicts: Surfaces A, C, D, E, F (2026-08-29)

**Surface A: 10/10 CONFIRMED** at stated grades. **Surface C: 10/10 CONFIRMED** (the
strand-forever consequence softened to HYPOTHESIS on the runtime basis — §11b). **Surface
D: 14/14 CONFIRMED** (grade adjustments: WS-014 double-confirmation and WS-028's overlap
consequence → HYPOTHESIS as runtime consequences; long-offset DST drift → severity NONE,
matching the §5 WS-006 amendment; venue-TZ quiet-hours severity graded RISK/GAP by
checkers vs BROKEN in this ledger — the ledger keeps BROKEN for the TCPA exposure and
records the spread). **Surface E: 15/15 CONFIRMED.** **Surface F: 9/9 CONFIRMED.**
Checker misses adopted below were each re-verified first-hand before adoption.

**WS-062 · A/B · GAP · PROVEN — Workshop consent revocation has no writer.**
`workshop_consent_events.action` supports `'revoked'` (038:221) and the engine's durable
guard reads latest-action (comms-engine.ts:233-243), but nothing anywhere writes a
revocation (STOP writes `dnc_entries` only) — workshop-tier consent is grant-only in its
own evidence store. DNC still blocks sends (WS-035), but the consent record cannot
reflect withdrawal.

**WS-063 · A · RISK · HYPOTHESIS — `ics_uid` is a per-workshop constant under a UNIQUE
constraint.** `ics_uid: 'wshop-${workshopId}@fsos'` (route:73) with `ics_uid text unique`
(038:144) — inserting a second session for the same workshop violates the constraint. No
multi-session create path exists in the product today, hence HYPOTHESIS on trigger.

**WS-064 · D · BROKEN · PROVEN — All six engine queries discard their error objects.**
Beyond WS-001's two: `comms-engine.ts:267, :400, :417, :477, :496, :514` all destructure
only `{ data }` — any query failure silently reads as empty and both passes report
success. (Batch 1's scope already reads every engine query's error.)

**WS-065 · D · POLISH · PROVEN — The quiet-hours deferral writes no audit row** while its
template and consent siblings do (comms-engine.ts:311-334) — audit-trail inconsistency.

**WS-066 · A · POLISH · PROVEN — `workshop_message_log.kind` has no CHECK constraint**
despite the adjacent comment claiming the same value-set as `templates.kind`
(040:172-173).

**WS-067 · C · GAP · PROVEN — Workshop email has no plaintext part.** The engine passes
no `bodyText` (comms-engine.ts:361-373) though the send path and dispatcher support
multipart (send.ts:601; dispatcher.ts:245-246) — every workshop email is HTML-only
(deliverability/spam-signal defect per the repo's own email-QA standards).

**WS-068 · C/D · BROKEN · PROVEN — The DB kill switch fails OPEN.** `loadConfig`'s
`catch { return CONFIG_DEFAULTS }` with `CONFIG_DEFAULTS.enabled = true`
(comms-engine.ts:72, :99-101) — a transient/RLS config-read error resurrects a
deliberately disabled engine; only the env kill switch survives.

**WS-069 · adjacent (booking) · BROKEN · PROVEN — Booking SMS ships the STOP line
twice.** `sms-templates.ts:9-10` asserts "the dispatcher does NOT append an SMS footer —
the body is authoritative" while `dispatcher.ts:244` appends `SMS_OPT_OUT_FOOTER`
unconditionally with no dedupe; the six booking bodies already carry "Reply STOP" inline.
Code wins over the comment. Outside workshop scope (workshop seeds assume the dispatcher
footer — consistent); recorded and suggested as a separate task.

**WS-070 · A/E/G · BROKEN · PROVEN — Workshop status has no CHECK, terminality is false,
and cancel-then-republish strands registrants on dead Zoom links.**
(a) `workshops.status` is bare text (018:86 — no CHECK anywhere). (b) The publish trigger
gates only the transition INTO `'published'` (038:296); the schema comment's
"completed/cancelled are terminal" (schemas.ts:915-916) is enforced nowhere — a bare
PATCH can take cancelled→published or completed→draft. (c) Chain: cancel deletes the
sessions' Zoom meetings but never clears `workshop_registrations.join_url` /
`zoom_registrant_id` (server.ts:717-728 touches sessions only) — republish, and every
existing registrant holds a join link to a deleted meeting.

**WS-071 · D · GAP (documented opt-in) · PROVEN — `reminder_starting` is disabled in the
shipped default config.** DB default offsets `'{10080,1440,60}'` exclude 0, with the
comment "add it here to enable it" (040:46-51); the seeded `reminder_starting` template
targets a stage that never fires by default. D-1 resolves.

**WS-072 · F · GAP · PROVEN — Workshop referral seeding loses attribution and dedupes
per-registration only.** The inserts omit `referring_agency_id` (comms-engine.ts:591-599;
registrations/[id] route) — the staff referral route sets it — and dedupe is
`if (!reg.referral_id)` per registration: one person attending three workshops seeds
three `referrals` rows with no cross-registration match.

**WS-073 · F/G · BROKEN · PROVEN — The report's consult-conversion metric measures the
automation, not consults.** `converted := !!referral_id || !!lead_converted_at`
(attendance.ts:150-151) and the nurture pass auto-stamps `lead_converted_at` for every
qualified attendee — once the engine runs, "consults booked" ≈ attendance count.

**WS-044 sharpened (D-2 input):** `pipelineSummary` is live (7 importers), but the
stage-ID helper subset (`stageAt`, `findStageById`, `isApplicationSubmittedStage`,
`isIssuedStage`, `APPLICATION_SUBMITTED_STAGE_IDS`) has ZERO importers — the GHL-era
stage taxonomy in `pipelines.ts` is dead code; the native `opportunities.stage` CHECK
(mig 009) is the live taxonomy. **Adjacent (recorded):** ADR-014's D4 schema-retirement
step was never executed — `049_ghl_schema_retirement.sql` exists only under
`docs/comms-ghl-migration/prepared/`, and the `ghl_*` tables/indexes remain live schema.

**Batch-1 test-churn note:** `tests/operational-email.test.mjs:243-259` asserts on the
legacy register route's SOURCE — removing that route (Batch 1) breaks those blocks; Batch
1 rewrites them alongside the removal.

---

## §12 (concluded) — Verify verdicts: Surfaces G, H, I (2026-08-29). All nine rounds complete.

**Surface G: 13/13 CONFIRMED** (including the check-in tap claim in its narrow reading —
reconciled with §9/WS-049: the "silently lost" reading stays refuted [3-attempt retry,
revert + toast]; the no-offline-queue GAP stands). **Surface H: 22/23 CONFIRMED, one
downgrade upheld** (below). **Surface I: 9/10 CONFIRMED, one dispute upheld** (below).
Every verdict adopted here was checked against the §11b basis (rests on quoted source,
not green tests) and re-verified first-hand.

**WS-052 CORRECTION (H-round downgrade upheld).** The invisible-failure structure is
PROVEN verbatim (general error suppressed when `fieldErr` is set; only name/email/phone
render field errors), but the user-reachable trigger is HYPOTHESIS: the non-rendered
schema fields (`workshop_id`, `session_id`, `chosen_delivery`) are page-supplied values,
not user-typed. Re-graded **RISK (structure PROVEN / trigger HYPOTHESIS)**. Batch 8 still
fixes it (render the general error whenever the named field has no rendered slot).

**WS-058 refinement (I-round dispute upheld).** The zoom-provision `start_url` slice
assertion (`workshop-zoom-provision.test.mjs:196`) is fragile, not vacuous as first
described: `split('EnsureMeetingOutcome')[1]` lands on the type-definition region
(server.ts:623-644), so the negative `/startUrl/` check does inspect a meaningful slice;
a rename still empties it via the `?? ''` fallback. Graded POLISH.

**WS-074 · G · GAP · PROVEN — `/approve` has no status precondition.** It loads only
`workshop_id, disclosure_config_id` (approve/route.ts:36-43) and approves or rejects from
ANY status — cancelled and completed included.

**WS-075 · G · RISK · PROVEN — Approving with a supplied `disclosure_body` rewrites the
shared disclosure row in place** under the same version number
(approve/route.ts:79-96: updates `workshop_disclosure_configs.body`,
`is_assumption=false`, `approved_by`) — other workshops referencing that disclosure id
silently show new text without re-approval; the version contract is broken. Mitigation
held: past consent evidence is safe (`workshop_consent_events.disclosure_text` snapshots
at registration).

**WS-076 · G · RISK · PROVEN — PATCH applies side effects before the publish gate can
reject.** `syncPresenters` + `recordMaterial` run at `[id]/route.ts:46-51`; the gate 422s
at `:54-67` — a rejected publish still mutated presenters/materials (and presenter sync
recomputes `is_security`). Related (PROVEN mechanism, not API-reachable today): the
publish trigger is `BEFORE UPDATE` only (038:316-318) — a direct INSERT with
`status='published'` would bypass it.

**H-round adoptions (refinements under existing IDs):** `WorkshopStatusControl` renders
NO action for `status='cancelled'` — no un-cancel path in the UI while the API allows
unguarded un-cancel (WS-070b inconsistency; POLISH). WS-051 refinement: `WorkshopHubFilters`
is `'use client'` and `formatWhen` runs on server (UTC) AND client (viewer TZ) — a React
hydration mismatch, after which the hub shows VIEWER-timezone times (still not venue
time). Raw `<a href>` instead of `next/link` across the public funnel
(HubFilters:107; [slug]/page.tsx:88,205,227) — full page reloads on the conversion path
(POLISH). Scope-correction accepted with no ledger change: `(fsa)/loading.tsx` covers the
authenticated tree; WS-056's no-loading-boundary claim was already public-only. Session
UUIDs are public by design (`public.ts:113`) — amplifier noted under WS-048.
`requirePermission` after `requireApiRole('fsa')` is redundant on 3 routes (POLISH).

**WS-077 · I · GAP · PROVEN — The test runner has no assertion-count contract.**
`scripts/run-tests.mjs:46-54` passes/fails on the child exit code alone — a file whose
assertions are all §11a-class (or that asserts nothing) is indistinguishable from a real
pass. This is the structural enabler of the false-green class; Batch 0 adds a per-file
minimum-assertion contract (each test prints its count; the runner enforces a floor
recorded per file).

**§11a addendum (I-round):** `workshop-delivery.test.mjs:227` — the alternation
`/kind', 'recording'|kind.*recording/` parses as two alternatives, the second satisfiable
by any "kind…recording" text; today its only match is the executable
`.eq('kind', 'recording')` (replay.ts:50 — grep verified), so it is currently anchored
but comment-satisfiable in principle. Sweep total revised: **42 instances**
(7 pattern A, 35 pattern B). Also noted: no test file references the workshop cron route
at all (`rg 'cron/workshop-reminders' tests/` is empty).
