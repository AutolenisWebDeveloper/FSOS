# FSOS Workshop Subsystem — Remediation & Completion Plan

> **Structure: APPEND-ONLY.** Amendments are appended as dated sections referencing batch IDs.
> Companion to `docs/WORKSHOP_AUDIT.md` (finding IDs `WS-*` referenced throughout).
> **Status: AWAITING GATE 1 APPROVAL — no product code has been written.**

Ordering principle (per the owner's directive): **broken flows → missing comms →
correctness hardening → enhancements → polish.** Each batch is one commit, independently
verifiable (its named tests prove it) and independently revertable (rollback stated per
batch; DB changes are additive so a code revert is always safe, with a compensating
migration named where a schema object must be withdrawn).

Construction order inside every batch: **REUSE → EXTEND → CONSOLIDATE → CREATE.** The
proven primitives to reuse (held in the audit): the 7-step `sendThroughGate` path with
dispatcher-boundary suppression re-check (WS-035), the `(reg, channel, kind)` atomic claim
(WS-016), the booking subsystem's `.ics` builder (`src/lib/booking/ics.ts`), the booking
signed-token manage flow (cancel/reschedule UX in `ManageFlow.tsx` + its API pattern), the
booking SMS template set's STOP language, the ephemeral-Postgres proof harness
(`tests/booking-reminder-idempotency.test.mjs` pattern + `scripts/run-tests.mjs` RLS set),
and the platform consent/purpose stores (`comm_contact_consents`, `purpose.ts`).

---

## Batch 1 — Resurrect the engine; retire the rogue endpoint (BROKEN FLOWS)

**Fixes:** WS-001 (dead query), WS-002 (legacy route), WS-027 (exception isolation),
WS-026 (terminal-vs-retryable), WS-016 (stranded `'sending'` reclaim).

Scope:
- `src/lib/workshops/comms-engine.ts` — select `registered_at` (aliased or mapped to the
  existing `RegRow` type); **read and surface the PostgREST `error`** on every engine query
  (an errored selection aborts the pass loudly — cron 500s with the message, never a silent
  zero-work 200); wrap each per-registration unit in try/catch so one failure cannot strand
  the pass (WS-027); on a caught failure after claim, finalize the log row `'deferred'`
  with the error as `reason` (WS-026: transient = retryable); classify gate step `sms_live`
  and provider failures (`blockedStep == null && !sent`) as `'deferred'`, keeping
  consent/DNC/securities/template blocks terminal; add a stale-claim reclaim (an
  `updated_at` older than 30 min at `'sending'` is re-claimable — guarded update, same
  atomic pattern) (WS-016).
- `src/lib/workshops/reminders.ts` — extend `classifySendOutcome(sent, blockedStep,
  errorish?)` pure logic accordingly (kept pure; TDD first).
- Public `/api/events` feed gains the `status='published'` filter (WS-038 draft leak —
  same commit, two-line fix).
- Legacy route `src/app/api/workshops/register/route.ts` — **remove**; `/events/[id]` page
  (`src/app/events/[id]/page.tsx`) retargeted to the live flow: load by id, render the same
  `WorkshopRegisterForm` but posting to `/api/public/workshops/register` (it already does)
  with `sms_disclosure`/`session_id` supplied (also resolves WS-021's missing disclosure),
  or 302 to `/workshops/[slug]` when a slug exists. GET consumers: none in-repo (PROVEN).
- `AUDIT_LEDGER.md` — append a correction note to FSOS-012/FSOS-072 (route removed; cron
  scheduled) per that ledger's own append-only convention.

Tests that PROVE it:
- `tests/workshop-engine-query.test.mjs` (RLS set) — ephemeral Postgres: apply the real
  migrations, insert a workshop+session+registration, run the engine's selection SQL
  verbatim; asserts rows return (fails on `created_at` regression) — the regression test
  for WS-001.
- `tests/workshop-reminder-idempotency.test.mjs` (RLS set, mirrors booking's) — cron pass
  run 3× against ephemeral PG with a stubbed gate: exactly one `workshop_message_log` row
  per (reg, channel, kind); a thrown send marks `'deferred'` and the pass continues;
  a stale `'sending'` row older than the lease is reclaimed; `sms_live` block re-arms.
- `tests/workshop-comms.test.mjs` — extended: `classifySendOutcome` new cases.
- Route removal proven by `npm run build` route manifest + a unit assertion that the file
  is gone (`tests/workshops-gate.test.mjs` extension).

Rollback: revert the commit (no schema change in this batch).

---

## Batch 2 — Registration integrity (BROKEN FLOWS)

**Fixes:** WS-003 (duplicates), WS-004 (capacity atomicity + configurability), WS-037
(past events registerable — register-time date guard), WS-B13 (documented), WS-024's
missing already-registered UX.

Scope:
- Migration `128_workshop_registration_integrity.sql` (additive):
  - `create unique index … on workshop_registrations (workshop_id, lower(email)) where
    status not in ('cancelled')` — duplicate prevention at the DB (WS-003).
  - Capacity claim function `workshop_claim_seat(p_workshop uuid, p_session uuid)` —
    `security definer` counting inside the same statement with the insert (or a
    constraint-trigger equivalent) so the last seat cannot double-fill (WS-004);
    walk-in path counts too, but never blocks a walk-in (overflow allowed, flagged).
  - Backfill note: existing duplicate rows (if any in prod) must be deduped before the
    index — the migration uses the FSOS-032 serialization pattern from migration 122's
    backfill (already proven in this repo).
- `src/app/api/public/workshops/register/route.ts` — on unique violation, return the
  distinct `already_registered` response (200-with-state, not an error leak); atomic
  capacity via the claim function; capture `guest_count` if Decision D-6 says yes.
- `src/lib/validation/schemas.ts` — `WorkshopPatchSchema` gains `max_attendees` (and
  session capacity when Decision D-7 chooses per-mode); `WorkshopForm.tsx` sends it.
- `src/components/public/site/WorkshopRegisterFormSite.tsx` + `WorkshopRegisterForm.tsx` —
  render the already-registered state.

Tests: `tests/workshop-capacity-concurrency.test.mjs` (RLS set) — two concurrent
transactions for the last seat: exactly one confirmed (+ one waitlisted after Batch 5);
duplicate insert rejected by the index; `tests/public-intake.test.mjs` extension for the
already-registered response shape.

Rollback: revert commit + compensating migration dropping the index/function (named in the
migration header).

---

## Batch 3 — Two-tier consent + purpose declaration (MISSING COMMS / compliance core)

**Fixes:** WS-012 (single-tier model), WS-013 (silo/no-purpose/frequency no-op), WS-036
(process note). Gated on **Decisions D-2, D-3**.

Scope:
- Model (additive migration `129_workshop_consent_tiers.sql`): `workshop_consent_events.scope`
  (`'event_transactional' | 'marketing'`) with backfill of existing rows per D-3's ruling;
  registration form copy split: (a) event-operational updates for THIS event (covers
  confirmation + reminders + change notices; email always on registration per CAN-SPAM
  transactional class; SMS per D-3), (b) ongoing marketing (nurture, future workshops).
- `src/lib/workshops/comms-engine.ts` — reminder kinds consume the transactional tier;
  nurture kinds require the marketing tier; every send declares a typed `purpose`
  (`workshop_reminder` transactional-class / `workshop_nurture` marketing-class) wired into
  `purpose.ts` so quiet-hours scope, §9 frequency caps and §10 collision engage (WS-013);
  `comm_messages.purpose` stops being NULL for workshop sends.
- Materialization: on registration, upsert the platform consent store
  (`comm_contact_consents` via the existing public-intake grant path from migration 074)
  so the gate's additive consent OR (`send.ts` member/contact/durable) sees workshop
  grants; revocation events flow both ways (STOP already does via DNC).
- Copy changes to the two forms + `/sms-terms` cross-reference (copy itself is
  placeholder-badged until D-5 approval).

Tests: `tests/workshop-consent-tiers.test.mjs` (unit; compiles engine's pure tier logic) —
reminder allowed on transactional tier without marketing grant; nurture blocked without
marketing grant; purpose string asserted on the gate context (stubbed gate capture);
RLS-set extension proving the consent upsert.

Rollback: revert commit; scope column is additive (compensating migration named).

---

## Batch 4 — Lifecycle transitions + change comms (MISSING COMMS)

**Fixes:** WS-007 (reschedule/venue unrepresentable), WS-008/WS-008b (silent cancel;
nurture ignores cancellation), WS-009 (registrant cancel absent), WS-029 (key can't re-arm).

Scope:
- Migration `130_workshop_lifecycle.sql` (additive): `workshop_sessions.cadence_generation
  int not null default 1`; `workshop_registrations.cancelled_at timestamptz`;
  `workshop_message_log` unique key becomes `(registration_id, channel, kind,
  cadence_generation)` (new index + column, old constraint retained until backfilled —
  ordered steps in-migration; WS-029).
- Reschedule/venue change: `WorkshopPatchSchema` + `PATCH /api/workshops/[id]` accept
  `starts_at`/`ends_at`/`timezone`/`venue_name`/`venue_address` (writes the SESSION —
  single source of truth; the legacy `workshops.scheduled_at` mirror updated in the same
  transaction); on a material change (time or venue), bump `cadence_generation` (re-arms
  reminders) and enqueue `change_reschedule` / `change_venue` sends to all active
  registrations — through the engine's claimed path, not inline.
- Agency cancel: transition into `'cancelled'` enqueues `event_cancelled` to all active
  registrations (WS-008); nurture + reminder passes both filter session
  `status='cancelled'` AND non-published workshops (WS-008b).
- Registrant cancel: signed-token route `POST /api/public/workshops/cancel` (join_token —
  the booking manage-flow pattern), sets `status='cancelled'` + `cancelled_at`, sends the
  cancellation acknowledgment, and cadence termination is structural (engine already
  filters `status='cancelled'` — PROVEN comms-engine.ts:421,501); every reminder/nurture
  email + SMS template carries the cancel link token (WS-009).
- New template kinds seeded as placeholders (D-5 approval before activation):
  `change_reschedule`, `change_venue`, `event_cancelled`, `cancel_ack`.

Tests: `tests/workshop-lifecycle.test.mjs` (RLS set) — reschedule bumps generation and
re-arms exactly the pre-event kinds; cancel enqueues `event_cancelled` once per
registration; registrant cancel terminates the cadence (no further claims win) and is
durable (a later tick cannot resurrect it); nurture skips cancelled sessions.
E2E (Batch 8): cancel link path.

Rollback: revert commit + compensating migration (columns/indexes named); template rows
are placeholder/inactive so no send-path risk while reverting.

---

## Batch 5 — Cadence completion + calendar (MISSING COMMS)

**Fixes:** WS-011 (missing offsets), WS-022 (no .ics), WS-014 (double confirmation),
WS-005 (quiet-hours timezone). Gated on **Decision D-1** (cadence set).

Scope:
- `src/lib/workshops/reminders.ts` — offset map extended per D-1 (default proposal:
  `4320 → reminder_3d`, `120 → reminder_2h`); new **wall-clock kind** `reminder_dayof_am`
  computed at 9:00 in the SESSION's IANA timezone via `Intl` (the WS-006-amendment
  construct — DST-safe because it is derived from the venue calendar date each tick, not a
  precomputed instant); unknown config offsets go from silently-dropped to logged-skip.
- `.ics` attachment on confirmation email: REUSE `src/lib/booking/ics.ts` (pure builder) —
  a public `GET /api/public/workshops/ics?token=` endpoint serving `text/calendar` (tokens
  already exist per-registrant), and the `ics_url` merge token points at it (WS-022).
- WS-014: engine `confirmation` kind becomes the single confirmation of record; the
  register route's transactional ack is retained ONLY as the fallback when the engine
  confirmation is not yet active (template unapproved) — resolved by checking template
  sendability at registration time, so exactly one confirmation goes out in every
  configuration.
- WS-005: quiet hours computed against the MORE CONSERVATIVE of (venue-TZ local hour,
  US-continental floor): defer if outside 9:00–20:00 in ANY of venue TZ / Eastern / Pacific
  when the recipient's own timezone is unknown (registrants' TZ is not captured; this
  bounds TCPA exposure for virtual attendees without new data collection). Recorded as an
  interim: capturing recipient TZ/state at registration is a D-6 option.
- Post-event second touch: the owner matrix pairs the same-day thank-you (existing
  `nurture_*` kinds, `nurture_delay_minutes` default 180) with a T+2/3d follow-up — a new
  `nurture_followup` kind on the same claimed cadence (one per registration), delay
  config-driven (D-1 sets the day count).
- Template seeds for the new kinds (placeholder, D-5).

Tests: `tests/workshop-comms.test.mjs` extensions (offset map, day-of-AM wall-clock across
a DST boundary — the venue-TZ fixture pair `2026-03-07/2026-03-09` America/Chicago);
`tests/workshop-reminder-idempotency.test.mjs` extension for the new kinds; conservative
quiet-hours function unit-proven.

Rollback: revert commit (config-only + pure logic + one route).

---

## Batch 6 — Waitlist (ENHANCEMENT the UI already promises)

**Fixes:** WS-010. Gated on **Decision D-4** (claim window; or the owner may instead direct
removing the CTAs — then this batch shrinks to copy changes).

Scope (build variant):
- Migration `131_workshop_waitlist.sql`: `workshop_registrations.status` gains
  `'waitlisted'` (text status already unconstrained — PROVEN 018:97; enum check added
  covering the full set) + `waitlist_position`, `promotion_offered_at`,
  `promotion_expires_at`.
- Register route: capacity-full → waitlisted registration (distinct response + UI state);
  seat release (cancel/admin removal) → promote the head of the waitlist via the engine's
  claimed send (`waitlist_promoted` kind carrying a time-boxed claim link — join_token +
  expiry per D-4); expiry lapses to the next in line (cron tick handles expiry — same
  idempotent claim pattern).
- Templates: `waitlist_added`, `waitlist_promoted` (placeholders, D-5).
- Both public forms + hub cards render the real waitlist state (replacing WS-010's dead
  copy).

Tests: RLS-set — concurrent last-seat yields exactly one confirmed + one waitlisted
(extends Batch 2's test); promotion fires exactly once per released seat; expiry promotes
the next registrant; E2E in Batch 8.

Rollback: revert commit + compensating migration; CTAs fall back to Batch 2's
capacity-full state.

---

## Batch 7 — Correctness & compliance hardening

**Fixes:** WS-025, WS-032, WS-034, WS-033 (code side), WS-030, WS-028, WS-020, WS-031,
WS-039 (no-show derivation), WS-040 (attended duality), WS-042 (session-status writer).

Scope:
- Fail-closed context guards (WS-025/WS-032/WS-034): the engine DEFERS (never sends) when
  `sender_physical_address` still carries the placeholder marker, when `appBase()` is
  empty and the template references any URL token, or when any workshop token substitutes
  empty for a template that references it — restoring the gate's fail-closed
  personalization semantics for workshop sends (unknown tokens are no longer pre-blanked;
  they pass through to `unresolvedBlockingTokens`).
- WS-033: append HELP to the SMS footer (`'Reply STOP to opt out, HELP for help.'` — the
  booking templates' existing language) and add the inbound HELP auto-response through the
  existing inbound path (business identity + contact — copy per D-5); carrier-level
  Advanced Opt-Out remains a go-live checklist item (NOT VERIFIED here).
- WS-030: cron auth requires the Bearer secret whenever `CRON_SECRET` is set (header alone
  no longer suffices); header-only remains only when no secret is configured.
- WS-028: nurture's spine seeding made idempotent — `nurtured_at` claim BEFORE
  side-effects via a guarded update (same atomic pattern), referral insert keyed
  ON CONFLICT on `(registration_id)` linkage (`workshop_registrations.referral_id` set in
  the same guarded step).
- WS-020: `DeleteEventButton`/`eventDeletion.ts` refuse deletion for workshops with any
  registration/consent/message rows — cancel + retain (17a-4 posture); hard delete remains
  for empty drafts only.
- WS-031: bound the engine's per-tick work (`limit` + `order starts_at`) and hoist the
  per-registration existing-log lookup into one batched select per session.
- WS-039: the nurture pass derives no-show BEFORE segmenting — a registrant with no
  attendance row for an ended session gets a `workshop_attendance` row
  `status='no_show', capture_method='manual'`-equivalent (`'derived'` added to the
  capture_method check) so reports and the no_show segment work without staff reconcile.
- WS-040: `PATCH registrations/[id] {attended:true}` also upserts the
  `workshop_attendance` row (single source of truth; the boolean stays as a legacy mirror).
- WS-042: workshop cancel ALSO sets its sessions `status='cancelled'` (making the
  existing reminder-pass filter real); recording_url gains its admin write path in the
  delivery panel (or the field is dropped from replay's contract — smallest sound fix
  chosen at implementation).
- WS-043: consult requests trigger the existing `notifyFsa` ops alert.

Tests: unit extensions (footer text asserted; fail-closed guards; classify outcomes);
RLS-set: nurture claim under overlap (two concurrent passes → one referral);
deletion-refusal proof; cron-auth unit test on the route's `authorized()`.

Rollback: revert commit (no schema change).

---

## Batch 8 — Frontend states, a11y completion, E2E + full gates (POLISH + PROOF)

**Fixes:** WS-021, WS-024 residue, WS-045 (roster export), WS-019 (test debt), Playwright
(Phase 5 scope).

Scope:
- Roster CSV export on the admin registrations panel (server-generated via the existing
  `exceljs` dependency; role-gated like its page) (WS-045).
- Public surfaces complete-state matrix: already-registered, waitlisted, cancelled-event,
  past-event, server-error retry on both register forms + hub + detail; `/events/[id]`
  passes `sms_disclosure`/`session_id` (or 302s — per Batch 1); a11y pass (labels/
  `aria-describedby` error association audit; focus-visible; keyboard path) with
  `frontend-design` + `impeccable` skills; mobile-first proof at 375px.
- Playwright: add `@playwright/test` devDependency + config using the container's
  chromium (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, `executablePath /opt/pw-browsers/chromium`);
  captured-transport mode: a test-only env flag routes `lib/messaging` provider calls to a
  capture file (NO real sends — asserted by the tests themselves; mocks prove code
  behavior, not live provider integration — stated honestly in the report).
- E2E scenarios (minimum, per the owner's list): happy-path registration → confirmation
  page + captured confirmation comms · duplicate registration → already-registered ·
  capacity-full → waitlist → promotion · registrant cancel → cadence terminates · agency
  reschedule → notification captured · admin check-in at mobile viewport · post-event
  no-show branch.
- Correctness suite (RLS set, from prior batches, re-run as a whole): cron 3× → one row
  per key · quiet-hours deferral · dispatch-time suppression blocks a gate-passed send ·
  STOP mid-cadence terminates durably (DNC + no auto-resume) · concurrent last seat ·
  venue-TZ day-of-AM across DST.
- Full repo gates: `type-check`, `lint`, `build`, `npm test`, `npm run test:rls`,
  Playwright suite.

Rollback: revert commit; Playwright is dev-only tooling.

---

## OWNER DECISIONS (required at Gate 1 — the plan decides none of these)

**D-1 · Reminder cadence timings.** Options:
  (a) Owner matrix in full: T-7d email · T-3d email+SMS · T-1d SMS · day-of-AM SMS · T-2h
      SMS (5 pre-event touches; heaviest SMS load; frequency-cap interaction).
  (b) Current set + gaps closed: 7d email · 3d email+SMS · 1d email+SMS · day-of-AM SMS ·
      starting SMS (drops 2h as redundant with day-of-AM).
  (c) Keep the implemented 7d/1d/1h/starting and add nothing.
  Tradeoff: each added SMS touch increases opt-out and carrier-filtering risk; day-of-AM +
  2h + starting is 3 SMS in one day.

**D-2 · Pipeline placement.** Options:
  (a) Create a Prospect/Client opportunity at REGISTRATION (stage "New Opportunity") —
      fullest funnel visibility; inflates pipeline with no-shows.
  (b) Create it at ATTENDANCE (extend the existing qualified-segment referral seeding to
      also place a Pipeline-A opportunity at "Contacted") — matches the current
      referral-spine semantics; loses pre-event pipeline visibility.
  (c) Keep referral-spine only (status quo; no opportunity until manual conversion).
  All options extend `src/lib/pipelines.ts` usage — no parallel pipeline is built.

**D-3 · Reminder SMS consent class.** Options:
  (a) Transactional: providing a phone at registration + explicit event-updates disclosure
      makes reminder SMS event-operational (no marketing checkbox needed for reminders;
      nurture still requires the marketing tier). Requires FFS-approved disclosure copy at
      the capture point.
  (b) Current posture: ALL SMS (reminders included) require the explicit SMS checkbox.
      Safest; means un-ticked registrants get email-only reminders (and the promise copy
      must say so).
  This decision sets the Batch 3 tier mapping. (TCPA: informational texts require prior
  express consent; marketing requires prior express written consent — (a) is defensible
  with clean disclosure, (b) is conservative.)

**D-4 · Waitlist.** Build with what claim window (proposal: 24 h, expiring to next in
  line), or remove the three waitlist CTAs instead? (WS-010 must resolve one way or the
  other.)

**D-5 · Template copy.** Every kind (13 existing + ~8 new: change/cancel/waitlist/3d/
  day-of/2h/help) ships as placeholder DRAFTS; **FFS principal pre-approval is required
  before any activation** — activation is a data change (approve + activate + link), never
  code. No live send occurs in any batch of this plan.

**D-6 · Senior-focused seminars?** If these workshops target seniors/retirees, several
  states impose seminar-advertising notice/filing rules, which affects disclosure configs
  and template copy (D-5). Owner answer required; the plan adds a per-workshop
  `senior_focused` flag + disclosure slot only if YES.

**D-7 · Capacity semantics (secondary).** Single `max_attendees` (simplest, Batch 2
  default) vs per-mode in-person/virtual capacities (the columns exist, unenforced —
  WS-004). Also: capture a guest/plus-one count that consumes capacity? (currently absent).

**D-8 · Double-confirmation resolution (secondary, Batch 5).** Engine confirmation as the
  single record (proposed) vs keeping the instant transactional ack as the only
  confirmation and deleting the engine kind.

---

## What this plan deliberately does NOT do

- No merge, no deploy, no real sends, no production data or env changes (owner boundary).
- No parallel send path, no auto-enroll, no AI recommendation surface — every new comm is
  a template kind through the existing engine + gate.
- No redesign of unrelated surfaces; the two public form styling systems are consolidated
  only to the extent Batch 8's state work requires.
- Securities-flagged workshops keep their firewall exactly as-is (PROVEN sound — WS-035,
  §2 WS-018); nothing in this plan touches that boundary.
