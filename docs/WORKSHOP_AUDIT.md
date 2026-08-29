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
