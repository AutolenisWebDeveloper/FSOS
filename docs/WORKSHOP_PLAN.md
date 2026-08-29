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
(past events registerable — register-time date guard), WS-051 (public funnel renders
server-timezone dates — switch every funnel date to the session's `starts_at` rendered in
its IANA `timezone`, the ack-email pattern), WS-057 (honeypot hits logged, not silently
faked), WS-B13 (documented), WS-024's missing already-registered UX.

Scope:
- Migration `128_workshop_registration_integrity.sql` (additive):
  - `create unique index … on workshop_registrations (workshop_id, lower(email)) where
    status not in ('cancelled')` — duplicate prevention at the DB (WS-003).
  - Capacity claim function `workshop_claim_seat(p_workshop uuid, p_session uuid)` —
    `security definer` counting inside the same statement with the insert (or a
    constraint-trigger equivalent) so the last seat cannot double-fill (WS-004); counts
    PER-SESSION, not workshop-wide (WS-060); walk-in path counts too, but never blocks a
    walk-in (overflow allowed, flagged).
  - Backfill note: existing duplicate rows (if any in prod) must be deduped before the
    index — the migration uses the FSOS-032 serialization pattern from migration 122's
    backfill (already proven in this repo).
- `src/app/api/public/workshops/register/route.ts` — on unique violation, return the
  distinct `already_registered` response (200-with-state, not an error leak); atomic
  capacity via the claim function; normalize email to lowercase on write (§12); run the
  rate limiter BEFORE the honeypot short-circuit and log honeypot hits (WS-061/WS-057);
  move Zoom provisioning off the response path or give it an AbortSignal timeout (WS-059);
  verify a client-supplied session_id belongs to the workshop (WS-048); capture
  `guest_count` if Decision D-7 says yes.
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
WS-039 (no-show derivation), WS-040 (attended duality), WS-042 (session-status writer),
WS-047 (bare status flip + approval invalidation on material edit), WS-048 (session_id
must belong to the workshop), WS-050 (server-side MIME validation on asset upload).

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

**Fixes:** WS-021, WS-024 residue, WS-045 (roster export), WS-019 (test debt), WS-052
(invisible validation failure + aria-describedby fork-drift), WS-053 (unconfirmed
destructive cancel + post-cancel 404), WS-054 (filtered-empty table), WS-055 (.msite focus
indicator), WS-056 (design-system/state debt incl. stale docs/routes.md), Playwright
(Phase 5 scope).

Scope:
- Roster CSV export on the admin registrations panel (server-generated via the existing
  `exceljs` dependency; role-gated like its page) (WS-045).
- Edit-workshop UI (WS-046): mount `WorkshopForm` in edit mode on the admin detail page,
  wired to the PATCH route (which Batch 4 already extends with date/venue) — including
  `budget_spend` so cost-per-lead works; check-in door polish (WS-049): 24px consent
  targets, an undo affordance, door no-show marking.
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
- Test-debt repairs (WS-058): replace the tautological timezone assertion with a pinned
  −5 July fixture; replace comment-matching regex "guarantees" in
  `workshop-delivery.test.mjs`/`workshop-comms.test.mjs` with executed behavior (the
  engine-executing tests added in Batches 1–7 supersede most of them).
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

---

## AMENDMENT 1 (2026-08-29 — owner directive at Gate 1): BATCH 0 — TEST INTEGRITY

Ordered **ahead of every feature batch**. Rationale: WS-058/§11a — the suite contains
assertions that cannot fail, so "suite green" is void as behavioral evidence (§11b);
the foundation must be trustworthy before any feature work is "proven" by it.

**Scope (tests + test harness only; zero production-code changes):**
1. **Tautology repairs (§11a pattern A):** every instance replaced with an assertion that
   fails on a wrong value — the America/Chicago offset pinned per fixture date (July
   fixture ⇒ exactly −5, January fixture ⇒ exactly −6) plus a DST-boundary pair
   (2026-03-08 / 2026-11-01 America/Chicago) asserting the offset CHANGES across the
   boundary; same treatment for every other §11a-A instance.
2. **Comment-coupled guarantee rewrites (§11a pattern B):** each rewritten to assert
   observable behavior, per the owner's list:
   - *send-once key uniqueness under repeated cron runs* — ephemeral-Postgres proof:
     the real migrations applied, the engine's claim path executed repeatedly, exactly
     one `workshop_message_log` row per (reg, channel, kind);
   - *dispatch-time suppression blocks a send the gate would have allowed* — executed
     against the compiled send path with a suppression row present;
   - *quiet-hours deferral* — engine run at an out-of-window fixture instant produces
     `deferred`, never a dispatch;
   - *absorbing termination that does not resume* — a terminated cadence
     (STOP/DNC-backed block) stays terminated across subsequent engine runs.
3. **Removal-guard test:** a test that FAILS when a delivery guarantee's implementation
   is removed — the engine compiled with a shimmed `@/lib/comms/send`, executed, and the
   shim's recorded invocation asserted (context fields: templateId, durableConsentGranted,
   utcOffsetHours). Deleting or bypassing the `sendThroughGate` call fails this test;
   editing a comment cannot satisfy it.
4. Migration-DDL text assertions (§11a-legitimate class) are kept as-is.

**Honest sequencing constraint, stated for approval:** the four behavioral guarantee
tests in item 2 execute the engine, which WS-001 currently kills. Authored in Batch 0 as
ordered, they are **RED against the unmodified engine** — they are precisely Batch 1's
TDD reds. Batch 0's exit gate is therefore: full suite green EXCEPT the four named
guarantee tests, each red with the documented WS-001 signature; Batch 1 must follow
immediately and turns them green. (Alternative if a fully-green Batch 0 exit is required:
the four tests land in Batch 0 behind an explicit `WORKSHOP_GUARANTEE_TESTS=1` flag that
Batch 1 removes — same code, deferred redness. Default is the visible-red option.)

**Tests that PROVE Batch 0 itself:** the repaired assertions demonstrably fail when the
behavior is broken — each repair is committed with a one-line note showing the mutation
that now fails (e.g. offset forced to −6 in July ⇒ assertion fails; `sendThroughGate`
call removed ⇒ removal-guard fails). Rollback: revert the commit (test files only).

---

## AMENDMENT 1a — D-9 added to the decision list

**D-9 · Workshop test-coverage strategy for `workshop-delivery.test.mjs`.** The file's
first-hand composition (held): ~30 genuinely behavioral assertions (compiled
`delivery.ts`/`webhook.ts` executed with pinned values — webhook parse, precedence,
thresholds, duplicate-idempotence, reconnect, replay gate, CRC, HMAC incl. fail-closed),
~11 legitimate migration-DDL text checks, and **~24 regex-on-source assertions
(lines 198–247)** — the §11a pattern-B class.
  **(a) Repair in place** — rewrite the ~24 suspect assertions into invocation-guard /
  behavioral forms inside the existing file; keep everything else.
  *Batch cost: ~1 focused session inside Batch 0; one file touched; reuses the file's
  existing compiled-module harness; 2–3 assertions need a small route-invocation shim.
  Residual risk: the file keeps its mixed structure, and each rewritten assertion gets a
  bespoke mini-harness.*
  **(b) Rebuild from the guarantee list** — enumerate the delivery guarantees (CRC echo,
  signature verify + production fail-closed, correlation by registrant token never name,
  `capture_method='webhook'`, manual precedence, best-effort provisioning, replay
  recording-consent gate, no-securities-fields-to-Zoom), write a fresh
  `tests/workshop-delivery.test.mjs` that EXECUTES each (compiled modules + route-handler
  invocation with a mocked request + ephemeral PG where rows matter); port the ~30
  behavioral and ~11 DDL assertions unchanged; delete the regex tail.
  *Batch cost: ~2 focused sessions in Batch 0; builds the route-execution harness that
  every later batch's tests (Batches 1–8) then reuse; zero pattern-B residue.*
  Recommendation: **(b)** — Batch 0 is the foundation; the harness pays for itself from
  Batch 1 onward. The owner decides.

**Batch order after this amendment:** Batch 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

---

## AMENDMENT 2 (2026-08-29): §11a/§11b/§12-continuation fold-ins

- **Batch 0 scope is now sized by §11a:** 41 instances (7 tautologies, 34
  comment/absence-coupled) across 10 files — the repairs cover ALL of them, not only the
  workshop-* files; 8 files are clean and untouched. D-9's options apply to
  `workshop-delivery.test.mjs`'s 14; the remaining 27 are repaired in place in either
  option.
- **Batch 1 additions:** read + surface the error object on ALL SIX engine queries
  (WS-064); rewrite `tests/operational-email.test.mjs:243-259` alongside the legacy-route
  removal (they assert on its source).
- **Batch 3 REUSE note:** the platform already defines the `WORKSHOP` message purpose
  mapping to the `WORKSHOP_COMMUNICATIONS` consent purpose (`purpose.ts:98-124`) — Batch 3
  declares the EXISTING purpose on engine sends rather than inventing new strings; the
  transactional reminder tier maps to the servicing/transactional class per D-3.
- **Batch 4 additions:** add the missing CHECK constraints (`workshops.status` — WS-070a;
  `workshop_message_log.kind` — WS-066) and terminal-state enforcement
  (cancelled/completed are re-openable only via an explicit reopen action that re-runs the
  publish gate and re-provisions Zoom — WS-070b/c); clear registrant Zoom columns when
  their session's meeting is deleted (WS-070c); write `workshop_consent_events`
  revocations when STOP/unsubscribe arrives from a workshop registrant (WS-062).
- **Batch 5 addition:** build the plaintext part for every workshop email (WS-067);
  enable/decide `reminder_starting` per D-1 (WS-071).
- **Batch 7 additions:** kill switch fails CLOSED on a config read error (WS-068);
  audit row on quiet-hours deferral (WS-065); referral seeding carries
  `referring_agency_id` and dedupes by contact across registrations (WS-072).
- **Batch 8 addition:** fix the consult-conversion metric to count actual consult signals
  (feedback consult_requested / booked appointments), not the automation's
  `lead_converted_at` stamp (WS-073).
- **D-2 sharpened:** the `pipelines.ts` stage-ID taxonomy is dead code (zero importers);
  the native `opportunities.stage` CHECK (mig 009) is the live taxonomy — option wording
  updated accordingly: any workshop opportunity uses the NATIVE stages unless the owner
  directs otherwise.
- Adjacent, outside this plan's scope (recorded in §12): booking SMS STOP-footer
  duplication (WS-069); ADR-014 D4 GHL schema retirement never executed.

---

## AMENDMENT 3 (2026-08-29): final §12 fold-ins

- **Batch 0 addition (WS-077):** per-file assertion-count contract in
  `scripts/run-tests.mjs` — each test reports its executed-assertion count and the runner
  enforces a recorded per-file floor, so an all-vacuous file can no longer read as a pass.
  §11a total revised to 42 instances (7A/35B) including `workshop-delivery.test.mjs:227`.
- **Batch 4 additions:** `/approve` gains a status precondition (draft/pending_review
  only — WS-074); approval-time disclosure edits create a NEW disclosure version row
  instead of rewriting the shared one in place (WS-075); PATCH validates the publish gate
  BEFORE applying presenter/material side effects (WS-076).
- **Batch 8 note:** WS-052 re-graded (structure PROVEN / trigger HYPOTHESIS) — fix
  unchanged; funnel `<a href>` → `next/link`; hub timestamp rendered server-side in venue
  TZ (WS-051 hydration refinement).

---

## AMENDMENT 4 (2026-08-29): GATE 1 APPROVAL — decisions of record

**APPROVED — BATCHES 0,1,2,3,4,5.** Batches 7–8 HELD for a mid-point checkpoint after
Batch 5 (re-scope against runtime evidence from the Batch 0 harness + Batch 1
resurrection; several Batch-7 findings are HYPOTHESIS pending that evidence). Batch 6
collapses (D-4). Report per batch: commit SHA, tests run with output, manifest state,
findings closed. No merge. No deploy. No live send.

**CONSENT MODEL — SETTLED (do not re-open).** Consent is captured ONE TIME, on the signup
page. Registering IS consent for that workshop's reminders (no checkbox). ONE unchecked
box on the same form covers post-event marketing only. Both write to the registration row
at submit. Every downstream send reads the stored value and proceeds — no consent logic
in the engine, cron, templates, admin surface, or any batch after 3. STOP/DNC suppression
and quiet hours are NOT consent: they act on the phone number at DISPATCH time (standing
invariant). A STOP reply is a person withdrawing, not the signup being re-litigated.
— Consequence for WS-062: the workshop consent store remains grant-only BY DESIGN;
withdrawal is suppression's job. Resolved as documented-by-design, no writer added.

**PRE-BATCH-0:** WS-002 handled first as its own commit — reference sweep ran (no
template, page, QR, ad, or dynamic caller references the legacy route; only its own test
assertions and historical docs) → DELETE, plus the test blocks updated in the same commit.

**BATCH 0 EXIT GATE — VISIBLE RED, PINNED (not env-flagged).** An EXPECTED-FAILURE
MANIFEST: each guarantee test pinned with its WS-ID and the batch that turns it green.
The runner asserts the EXACT set — an unpinned failure hard-fails, and a PINNED TEST THAT
PASSES also fails (stale pin or vacuous assertion). The manifest IS the WS-077 assertion
contract (merged). WS-019 is named Batch 0 scope.

**REASSIGNMENTS.** Into Batch 1 (engine must not be send-capable until all five green;
sends structurally disabled until they pass): WS-005 (quiet hours → RECIPIENT-local TZ
via NPA/ZIP→IANA; never venue TZ, never a hardcoded default; unresolved → fail closed),
WS-068 (kill switch fail closed), WS-032 (restore fail-closed personalization), WS-047
(approval-gate integrity per D-5), WS-065 (quiet-hours deferral auditing).
Into Batch 2: WS-010 (CTA removal per D-4). Into Batch 3: WS-020 (soft delete — keep the
registration record), WS-036 (console waiver). Into Batch 4: WS-023 + WS-044 (per D-2),
WS-040 (moves up from Batch 7 — prerequisite for attendance-triggered placement).
Into Batch 5: WS-069 (duplicated STOP footer). DEFERRED, not dropped: WS-050, WS-063,
WS-B13.

**D-1 · (b), MODE-AWARE:** 7d email · 3d email+SMS · 1d email+SMS · day-of-AM SMS ·
starting SMS. Drop T-2h. `reminder_starting` (WS-071) enabled for VIRTUAL/HYBRID only.
**D-2 · (b), NATIVE STAGES:** opportunity created at ATTENDANCE, stage "Contacted",
native `opportunities.stage` CHECK (mig 009). `pipelines.ts` stage taxonomy is dead code
— do not revive; WS-044 resolves as documenting/removing it. Pre-event visibility is a
REPORTING need (roster, Batch 8 — held).
**D-3 · (a):** registration is consent for that workshop's reminders. Batch 3 ships
exactly: (1) one FFS-approved disclosure line at the phone field ("We'll text you
reminders about this workshop. Msg & data rates may apply. Reply STOP to opt out."),
(2) one unchecked box governing POST-EVENT marketing only, (3) consent timestamp + form
version stored on the registration row. Plus an enum allowlist naming the reminder kinds
so nurture cannot route through the reminder class.
**D-4 · REMOVE the waitlist CTAs** (Batch 2); capacity-reached state links the next
session. Waitlist build deferred until a session demonstrably fills twice under correct
per-session capacity.
**D-5 · CONFIRMED + gate integrity:** all kinds ship as DRAFTS; activation is a data
change requiring FFS principal pre-approval; no live send in any batch. WS-047 (Batch 1):
the approval record captures approver, timestamp, and the exact rendered copy version
(FINRA 2210 recordkeeping).
**D-6 · schema NOW:** `senior_focused` flag + disclosure slot added unconditionally in
Batch 3, default false; business answer separate (affects copy/activation lead times, not
code).
**D-7 · PER-SESSION, PER-MODE, PLUS GUESTS:** fix WS-060 first; enforce per-mode columns
(in-person = room constraint; virtual nullable/unbounded); guest/plus-one count consumes
IN-PERSON capacity only.
**D-8 · KEEP THE INSTANT ACK** as the confirmation of record; DELETE the engine
confirmation kind (resolves WS-014/WS-041). The .ics (WS-022) attaches to the instant
ack. Batch 5 routes the instant ack through `sendThroughGate` — exactly one send path per
channel is non-negotiable.
**D-9 · (b) REBUILD, ADD-THEN-DELETE:** Commit A adds the rebuilt delivery test file
(behavioral + DDL assertions ported, PASSING) alongside the old; Commit B deletes the
regex tail and the old file — a porting regression must show as a diff.

---

## BATCH 0 — EXECUTION RECORD (2026-08-29)

Commits: A `3ef41a0` (rebuilt delivery guarantee suite alongside old — 70 executed checks),
B `e76ed8b` (old file deleted after porting), C (this commit — §11a repairs, manifest,
runner enforcement, removal-guard, four pinned guarantee tests).

**§11a instance disposition — all 42 addressed:**
- `workshop-delivery` (15 incl. the L227 addendum): superseded by the EXECUTED guarantee
  suite (D-9b rebuild, Commits A/B).
- `workshop-comms` (6): July offset pinned to exactly −5, January −6, plus a 2026
  spring-forward and fall-back DST boundary pair; the comment/import-satisfiable Part-3
  regexes replaced by executable-statement anchors, with the BEHAVIOR now executed in
  `workshop-engine-invocation.test.mjs` (WS-019 closure for the engine-wiring class).
- `workshop-ops` (5): rewritten to executable call-site anchors (`await fn(...)`).
- `workshop-zoom-provision` (4): closed field-set pin on the Zoom create body; exact
  console-call anchor; executable column-assignment anchor; robust type-block extraction
  that FAILS when the block is missing (no vacuous `?? ''`).
- `comms-console` (1): UCS-2 segments pinned exactly (13 units → 1, 71 units → 2).
- `comms-policy` (1): the full 20-entry purpose→consent mapping pinned (deleting the
  purpose-specific switch arms now fails).
- `quiet-hours-scope` (1): no-arg default pinned against an independent Intl computation.
- `transactional-notifications` (2): fallback pinned to exactly `CONTACT.email`;
  consent-absence check extended to ban the consent-gating module imports.
- `operational-email` (4 + 2 removed with WS-002): import-line legs dropped in favor of
  call-site anchors; consents check tightened; `RESEND_FROM_EMAIL` asserted INSIDE
  sendEmail's extracted body with extraction-failure = test failure.
- `workspace-registry` (1): the by-construction portal equality deleted as a tautology
  (specific resolution stays pinned by the exact-id block; coverage by coveredInPortal).

**Removal-guard (owner item 3):** `tests/workshop-engine-invocation.test.mjs` executes
`sendWorkshopMessage` + the pass selectors with a recording stub at the ONE production
boundary — 21 checks: gate invoked exactly once with templateId/durableConsentGranted/
utcOffsetHours/entity; quiet-hours defers BEFORE the gate; revoked consent and missing
template block/defer BEFORE the gate; terminal rows absorb; claim-race loss skips; the
securities firewall is EXECUTED out of the pass. Deleting the sendThroughGate call fails
it; editing a comment cannot satisfy it. (During development this suite caught its own
fixture gap — an SMS template without an approved disclosure deferred for the wrong
reason — proof the assertions bite.)

**Expected-failure manifest (owner directive, = the WS-077 contract):**
`tests/expected-failures.json` + `scripts/run-tests.mjs` enforcement, both directions
verified by execution: the four pinned files run RED with the WS-001 signature printed
from the engine's real SQL, and a deliberately stale pin made the whole run exit 1 with
"PINNED file(s) PASSED — stale pin or vacuous assertion" (demo captured, then reverted).
Orphan pins (manifest entries for deleted files) also fail the run.

**Four pinned guarantee tests (rls set — full engine + real gate against ephemeral
Postgres, 127 migrations applied, providers stubbed at fetch):** send-once ×3 runs;
recipient-local quiet-hours defer-then-retry (venue Chicago vs +1907 Anchorage);
dispatch-time DNC suppression (SMS blocked, email still sent); absorbing termination
(3 extra runs — no resume, no attempt growth). All four red today with the WS-001
signature; manifest says green by Batch 1.

---

## BATCH 1 — EXECUTION RECORD (2026-08-29)

**The engine is alive, and every send-integrity control landed with it — one atomic
commit,** so no commit exists where a send-capable engine lacks any of the five reassigned
controls (the owner's structural-disable invariant, satisfied by atomicity).

- **WS-001**: `created_at` → `registered_at` in both pass selects + the row type; the four
  pinned guarantee tests flipped green against real Postgres (send-once ×3 runs;
  recipient-local defer-then-retry; dispatch-time DNC block with email unaffected;
  absorbing termination across 4 runs) and the manifest is EMPTY.
- **WS-005**: SMS quiet hours are RECIPIENT-local via the new NPA→IANA module
  (`src/lib/comms/recipient-timezone.ts`, dominant-zone table, DST-correct via Intl);
  venue timezone is never consulted for the decision; unresolved NPA (toll-free/non-NANP)
  FAILS CLOSED as an audited deferral. Proven at both layers: unit (venue-ignored +
  in-window mirror + gate receives the recipient offset) and real-PG (Anchorage 07:00
  deferred while venue Chicago 10:00; retry sends at 11:00 recipient-local).
- **WS-068**: an unreadable config row now DISABLES the engine for the tick (fail closed).
- **WS-032**: unknown merge tokens pass through UNRESOLVED so the gate's personalization
  step blocks them (fail-closed personalization restored; known tokens still substitute).
- **WS-047**: a bare PATCH can no longer mint `compliance_approved` (422 naming the
  approval workflow; executed route test proves no write happens) — only /approve, which
  records approver + snapshot, can.
- **WS-065**: quiet-hours + tz-unresolved deferrals write audit rows like their siblings.
- **WS-064**: all six engine queries read their errors — selection failures return
  `{ ok:false, errors[] }` and the cron route returns 500 (a failed pass can never again
  read as an invisible `{ ok:true, handled:0 }`); an attendance READ ERROR skips the
  registrant instead of misclassifying them as a no-show.
- **WS-027**: every per-slot send is exception-isolated; a throw releases the stranded
  `'sending'` claim to a retryable `deferred/send_exception` (guarded on status).
- **WS-026**: `classifySendOutcome` now defers the OPERATIONAL HOLDS (`sms_live` A2P
  staging, `frequency`, `collision`, quiet/business hours) and bounds provider-failure
  retries (`PROVIDER_RETRY_MAX` = 4 attempts, then terminal) — pinned in the pure table
  tests.
- **WS-038**: `/api/events` lists PUBLISHED workshops only.
- **`comms.error`** added to the audit action taxonomy (additive).
- Ledger corrections: FSOS-072 was stale (the cron IS scheduled — vercel.json:28);
  recorded in §12/§0 already.

Findings closed: WS-001, WS-005, WS-026, WS-027, WS-032, WS-038, WS-047, WS-064, WS-065,
WS-068 (WS-016's runtime annotation resolves — the overlap guarantee is now EXECUTED).

---

## BATCH 2 — EXECUTION RECORD (2026-08-29)

**Migration 128** (`workshop_registration_integrity`): `guest_count` column (D-7); stored
emails normalized to lowercase; existing duplicates collapsed SOFTLY (later rows →
status 'cancelled', earliest kept — nothing deleted) before the partial unique index
`(workshop_id, lower(email)) where active` (WS-003 — cancelled rows don't block a
re-registration); `workshop_claim_registration(...)` SECURITY DEFINER claim: locks the
session row, verifies workshop↔session (WS-048), published-only, refuses started
(WS-037) and cancelled sessions, counts PER-SESSION PER-MODE (WS-060: in-person cap =
session capacity_in_person with legacy max_attendees fallback, guests consume seats;
virtual cap nullable = unbounded, D-7), inserts in the same transaction, and maps a
unique-violation to a distinct 'duplicate' outcome. Execute revoked from anon/authed;
service-role only.

**Route** (`/api/public/workshops/register`): rate limiter now counts BEFORE the honeypot
(WS-061) and honeypot hits are logged (WS-057); the read-then-insert is replaced by the
atomic claim rpc; outcomes map to distinct responses — duplicate → 200
`already_registered` STATE (WS-024), full → 409 + `seats_left`, past/cancelled → 409,
mismatch → 422; session fallback selects only upcoming, non-cancelled sessions.

**WS-059**: all five Zoom fetches carry `AbortSignal.timeout(5000)` — a hung Zoom API can
no longer stall a registrant's response.

**WS-051**: every public-funnel date now renders in the VENUE zone, formatted SERVER-side
(`formatInVenueZone` incl. zone abbreviation): detail + register pages use loader-provided
`when_local`/`time_local`; hub cards receive pre-formatted strings so the client never
re-formats (the hydration viewer-zone swap is gone); hub + detail loaders consider only
upcoming, non-cancelled sessions.

**D-4**: all three waitlist CTAs removed — capacity-reached copy points at the workshops
page/other dates; no false promise remains (WS-010 resolved by removal; build deferred).

**Forms**: both registration forms handle the `already_registered` state distinctly
(role=status, no error, "no second seat was taken"), capture guests (0–4, in-person
contexts only) posting `guest_count`, and the register page's unconditional
"join link emailed after you register" promise is softened to match reality.

**Proofs**: `workshop-registration-claim.test.mjs` (rls) — 13 checks on real Postgres
incl. the overlapping LAST-SEAT RACE (lock-holder wins, waiter refused, final count =
cap) and migration-on-dirty-data safety (re-applying 128 over seeded duplicates keeps
the earliest, cancels the later, rebuilds the index). `workshop-register-route.test.mjs`
(unit) — 16 checks incl. the rate-limit-counts-honeypot order and outcome mapping.

Findings closed: WS-003, WS-004, WS-010 (per D-4), WS-024, WS-037, WS-048, WS-051,
WS-057 (mitigated: logged), WS-059, WS-060, WS-061.

---

## BATCH 3 — EXECUTION RECORD (2026-08-29)

**The SETTLED consent model is live** (owner directive, D-3(a)): consent is captured ONE
TIME on the signup surface; registering IS consent for that workshop's reminders; ONE
unchecked box governs POST-EVENT MARKETING only; both facts live on the registration row
and every downstream send just READS them — no consent logic anywhere else.

- **Migration 129**: `marketing_opt_in` + `consent_captured_at` + `consent_form_version`
  on registrations; legacy backfill maps the OLD email box (marketing-inclusive wording)
  to `marketing_opt_in` — the old SMS box was reminders-only and grants nothing;
  `senior_focused` + `senior_disclosure_config_id` on workshops (D-6, default false);
  WS-020: the workshops FK is now ON DELETE RESTRICT — a workshop with registrations
  cannot be hard-deleted, so the record of what a person signed up for is durable
  (evidence still follows its protected registration).
- **`src/lib/workshops/consent-copy.ts`**: THE capture copy, single-sourced to the forms
  AND the evidence writes — `SIGNUP_FORM_VERSION` ('signup-v2-2026-08'),
  `SMS_REMINDER_DISCLOSURE` (the D-3 wording, verbatim), `MARKETING_OPT_IN_LABEL`. Bump
  the version whenever wording changes; it stamps every registration row.
- **Engine**: consent is read from the ROW — `isReminderClass(kind) ? true :
  reg.marketing_opt_in === true`; the `REMINDER_CLASS` closed enum (the D-3 allowlist,
  incl. the D-1 kinds `reminder_3d`/`reminder_day_of` ahead of Batch 5) is what keeps a
  marketing kind from ever borrowing the registration basis (the POLICY_DEADLINE-leak
  class, kept closed); the db-querying consent helper is deleted; reminder channels =
  contact-present; nurture channels = [] unless `marketing_opt_in`; purposes declared to
  the gate: reminder class → TRANSACTIONAL, nurture → WORKSHOP (existing taxonomy — the
  engine's recipient-local quiet-hours pre-check still covers EVERY workshop SMS).
- **Route + walk-in**: rate-limit→honeypot→schema unchanged; after the claim, the row is
  stamped with the three consent facts; capture evidence rows record the DISCLOSURE
  ACTUALLY SHOWN (reminder basis per reachable channel + marketing rows when opted); the
  kiosk walk-in sheet is that person's one-time signup (same facts, `· walk-in` version
  tag).
- **Forms** (both public + kiosk): consent checkboxes GONE; the phone field carries the
  approved reminder disclosure (aria-describedby); ONE optional marketing box.
- **WS-036**: the 1:1 console waiver no longer stacks with a caller-declared
  MARKETING-class purpose (`consentWaived: !isMarketingPurpose(purpose)`) — marketing 1:1
  sends clear the real consent gate; ADR-033 servicing behavior unchanged.

**Proofs**: invocation suite grown to 37 checks — the class boundary EXECUTED (marketing
kind without the row fact → blocked `no_marketing_opt_in`, never reaches the gate; with
it → sent declaring WORKSHOP; a reminder kind sends with marketing FALSE; no consent
store queried at send time); pure allowlist closed-set test; route test asserts the row
stamp + 4 evidence rows; all five PG suites re-ran green.

Findings closed: WS-012, WS-013 (settled model supersedes both), WS-020, WS-022 → Batch 5,
WS-036, WS-062 (grant-only store is now BY DESIGN — suppression owns withdrawal).
Decision D-6 schema shipped.

---

## BATCH 4 — EXECUTION RECORD (2026-08-29)

**Lifecycle transitions exist, change comms flow, and attendance places the pipeline
opportunity** (WS-007/008/008b/009/023/029/040/044/066/070a-c/074/075/076 + the WS-072
dedupe half).

- **Migration 130** (`130_workshop_lifecycle.sql`), PROVEN on a fresh chain + probes and
  re-proven by the RLS suite:
  - WS-070a: `workshops.status` CHECK (six states; strays normalized to draft first).
  - WS-066: `kind` CHECK on BOTH `workshop_message_log` and `workshop_message_templates`
    — the full vocabulary in one write, including the D-1(b) Batch-5 kinds
    (`reminder_3d`, `reminder_day_of`, `nurture_followup`) and the Batch-4 lifecycle
    kinds (`change_reschedule`, `change_venue`, `event_cancelled`, `cancel_ack`).
  - WS-029: `cadence_generation` on sessions + message_log; the send-once key is now
    UNIQUE(registration, channel, kind, generation) (`idx_wml_claim`; the 3-part
    original dropped after backfill). One-time kinds (confirmation, nurture_*,
    cancel_ack) are BACKFILLED to and claimed at generation 0 forever — a reschedule
    re-arms exactly the pre-event reminders + change notices, never a confirmation.
  - Publish gate re-created BEFORE INSERT OR UPDATE (the 038 trigger was UPDATE-only —
    a direct INSERT of a published workshop bypassed it; now it raises).
  - WS-070b: terminality trigger — cancelled/completed exit ONLY via reopen→draft, and
    the reopen VOIDS `compliance_approval_ref` (approval rows persist as history), so
    republish re-runs the real gate against a FRESH approval. Proven end-to-end:
    approve→publish→cancel→reopen→republish RAISES.
  - WS-008: workshop→cancelled CASCADES scheduled sessions to cancelled (AFTER
    trigger) — every cancel path produces the engine's signal, route or direct SQL.
  - `workshop_registrations.cancelled_at`; sessions `change_kind`/`change_recorded_at`;
    7 placeholder template seeds for the new kinds (D-5: drafts, engine-invisible).
- **Engine**: claims are generation-scoped (`claimGeneration` in reminders.ts;
  REARMABLE_KINDS closed set); new `runChangePass` — cancelled sessions ⇒
  `event_cancelled` to every active registrant; pending `change_kind` on a published,
  scheduled session ⇒ that notice to registrants who signed up BEFORE
  `change_recorded_at` (later signups saw the new details); both channels where the
  contact exists; the SAME claimed path (one notice per registrant/channel/generation);
  securities workshops stay excluded (standing firewall). Cron route runs
  changes→reminders→nurture and fails the run if ANY pass errors. WS-008b: the nurture
  pass now skips cancelled sessions and non-published/completed workshops (the reminder
  pass already did). `{{cancel_url}}` merge token available to every template (WS-009).
  REMINDER_CLASS widened by exactly the four lifecycle SERVICE kinds (they service the
  registration itself — D-3 basis; STOP/DNC still applies at dispatch).
- **WS-007**: `PATCH /api/workshops/[id]` accepts session changes
  (starts_at/ends_at/timezone/venue_name/venue_address, optional session_id; IANA zone
  validated) — writes the SESSION, bumps the generation + records the change kind ONLY
  on a material change (time dominates venue: one notice), mirrors
  `workshops.scheduled_at`, audits before/after. WS-076: the publish gate + terminality
  + session validation ALL run before any presenter/material side effect — a rejected
  PATCH now applies zero writes. Terminal-state PATCH gets a clean 422; reopen returns
  `requires: [fresh compliance approval, zoom re-provisioning]`.
- **WS-009**: `POST /api/public/workshops/cancel` (join_token, rate-limited, idempotent,
  past-event 409) + the `/workshops/cancel` confirm page (explicit POST from a button —
  a mail-client prefetch can never cancel anyone; found/already-cancelled/past/confirm
  states, venue-zone time, PublicPage chrome). Cancelling frees the seat + duplicate
  guard (128 already excludes cancelled) and terminates the cadence STRUCTURALLY;
  `sendCancelAcknowledgment` rides the engine's claimed path at generation 0 (email;
  placeholder ⇒ deferred per D-5; the cancellation stands regardless).
- **WS-070c**: `cancelWorkshopZoomMeetings` now also clears the per-registrant
  `join_url` + `zoom_registrant_id` (join_token kept — it is the manage identity).
- **D-2(b) / WS-023**: `routeSegmentToSpine` places the pipeline opportunity AT
  ATTENDANCE for qualified segments — NATIVE stage `'prospect'` (the mig-009 CHECK's
  entry stage; the owner's "Contacted" label maps here — the CHECK has no such value),
  engagement `'direct'`, stage_history seeded, deduped on the referral. The manual
  referral convert route now ENRICHES an attendance-placed opportunity
  (household/product/premium) instead of double-counting the pipeline. Two latent
  defects fixed in the same function: the referral insert wrote the engine's ACTOR
  string into uuid `owner_scope` (failed every insert, error discarded) — now null with
  the error surfaced; WS-072 dedupe half: referral REUSED by email across registrations
  (attribution half N/A-by-design: workshop signups are direct engagements).
- **WS-074/075** on `/approve`: decisions only for draft/pending_review; an
  approval-time body edit inserts a NEW disclosure version (kind kept, version max+1,
  approved on arrival) — the shared row is never rewritten, so every earlier approval
  snapshot keeps pointing at the exact text it approved; snapshot + gate-open reference
  the new version. Unchanged body = metadata-only bless.
- **WS-040**: the registrations PATCH attendance mark writes `workshop_attendance`
  through `reconcileAttendance` (manual capture, legacy flag synced) — the duality that
  made PATCH-marked attendees nurture as no-shows is closed.
- **WS-044**: `pipelines.ts` carries the DO-NOT-REVIVE notice naming the native
  `opportunities.stage` CHECK as the live taxonomy; the module stays only as the
  display-time resolver for historical ghl_* ids (7 read-only importers).

**Harness (integrity preserved):** guarantee fixtures now publish THROUGH the real gate
(mig 130 guards INSERT — `freshWorkshopDb` + the claim test seed approval+disclosure
then update to published); postgrest-shim gained a fail-loud `.or()` translator;
fakeDb gained ilike/or/gt/lt recorders; the engine bundle exports the new pass + ack.

**Proofs:** `tests/workshop-lifecycle.test.mjs` (RLS) — 23 checks against the REAL
engine + Postgres: generation re-arm (2×gen1+2×gen2 rows), change-notice
once-per-generation with re-tick absorption + late-registrant exclusion→inclusion
across two reschedules, cancel_ack absorbing at gen 0, durable registrant-cancel
termination, cancel cascade → event_cancelled exactly once per ACTIVE registrant +
reminder silence, and the five DB guards (INSERT gate, terminality, approval-voiding
reopen, kind CHECK, 4-part key). `tests/workshop-lifecycle-routes.test.mjs` (unit) —
36 checks: WS-076 zero-side-effect rejection, terminal 422 + reopen contract, material
vs immaterial session change + mirror, WS-074 precondition, WS-075 new-version +
snapshot references, cancel route 404/idempotent/409/success incl. the claimed ack
deferring on the placeholder, WS-040 upserts. Closed-set pins updated deliberately
(REMINDER_CLASS 11, REARMABLE 9, claimGeneration, pickChangeKind — workshop-comms now
60 checks). Full gates green: 196 unit files, 21 RLS files, type-check, lint, build
(`/workshops/cancel` in the route table). Manifest: EMPTY (no pins).

Findings closed: WS-007, WS-008, WS-008b, WS-009, WS-023, WS-029, WS-040, WS-044,
WS-066, WS-070a, WS-070b, WS-070c, WS-074, WS-075, WS-076, WS-072 (dedupe half; the
referring_agency_id half is N/A-by-design for direct workshop signups). D-2(b) shipped
with "Contacted" mapped to the native entry stage `'prospect'` — the native CHECK has no
Contacted value and the owner mandated native stages; flagged for the owner in the
batch report.

---

## BATCH 5 — EXECUTION RECORD (2026-08-29)

**The D-1(b) cadence is complete and the confirmation is singular (D-8).**
(WS-005 was finished in Batch 1; this batch closes WS-011, WS-014, WS-022, WS-034,
WS-041, WS-067, WS-069, WS-071.)

- **Migration 131**: D-1(b) default offsets `{10080, 4320, 1440, 0}` (column default +
  a guarded move of a config row still on the OLD shipped default — operator-edited
  sets untouched); `nurture_followup_delay_minutes` (default 2880 = T+2d, config-driven
  per D-1's "T+2/3d"); placeholder seeds for `reminder_3d` (email+sms),
  `reminder_day_of` (sms), `nurture_followup` (email+sms) — all drafts (D-5); and the
  instant-ack GATE HANDLE: one comm_templates row seeded APPROVED deliberately — it is
  the PRE-EXISTING live production receipt being brought UNDER the gate (the 040
  pattern: approval handle in comm_templates, copy with the sender), not a new kind.
- **Cadence (reminders.ts + engine)**: offset map gains 4320→3d (60→1h retained as
  CAPABILITY only — pinned by the three guarantee fixtures configuring it explicitly);
  `reminder_day_of` is a WALL-CLOCK kind — 9:00 AM on the session's VENUE calendar
  date, derived per tick via Intl (DST-correct; a session starting before 9 AM local
  has an empty window; same registered-before-fire skip as the offsets); WS-071:
  `reminder_starting` fires for VIRTUAL/HYBRID sessions only (the pass now selects
  delivery_mode); channel matrix per D-1(b): 7d email · 3d email+SMS · 1d email+SMS ·
  day-of SMS · starting SMS. Stray config offsets are LOGGED once per pass
  (unmappedOffsets), never silently dropped. The engine 'confirmation' kind is DELETED
  (D-8 — resolves WS-014's double confirmation and WS-041's T-8d lateness): nothing
  produces it; the kind string stays legal for historical log rows.
- **D-8 + WS-022**: the register route's instant ack now rides `sendThroughGate`
  (TRANSACTIONAL, registration basis, the mig-131 handle for step 4) — DNC/suppression
  now enforced even on the receipt; `sendVisitorAck` is gone from the route (exactly
  one send path per channel); the `.ics` (REUSED pure builder `booking/ics.ts`; the
  session's stable `ics_uid`; DTEND falls back to +60min) attaches to that ack.
  Attachments are a NEW capability of the single path (SendContext → DispatchRequest →
  sendEmail → Resend), email-only, dispatched only when the gate clears.
- **WS-067**: every workshop email now carries a real text/plain part — the engine
  derives it from the final HTML (footer included) via `toPlainText`; the ack passes
  the shared renderer's own text part.
- **WS-034 (fail closed)**: with no configured app URL every link in a workshop email —
  the CAN-SPAM one-click unsubscribe above all — degrades to a relative, broken URL.
  The engine now DEFERS email sends (`app_url_unconfigured`, audited, retryable the
  moment the env exists) instead of shipping broken mail.
- **T+2/3d follow-up (D-1 pairing)**: a second nurture leg — registrants who received
  the same-day nurture (`nurtured_at` set, real segment) get ONE `nurture_followup`
  per channel once anchor+delay elapses; the generation-0 claim is the once-ever
  idempotency; marketing basis stays the ROW (`marketing_opt_in` — no claim is even
  minted without it); securities-routed rows (segment 'ffs') are excluded.
- **WS-069 (adjacent, booking)**: the dispatcher appends `SMS_OPT_OUT_FOOTER` only
  when the body does not already carry "Reply STOP" — the six booking bodies (inline
  STOP) stop double-footering; workshop templates (no inline STOP) keep the appended
  footer byte-for-byte.

**Proofs**: `workshop-lifecycle.test.mjs` grew to 30 checks — three new REAL-PG
fixtures: day-of fires after 9:00 venue-local as SMS ONLY + 3d rides both channels +
zero confirmation rows (D-8); starting SMS reaches the VIRTUAL registrant and never the
in-person one (WS-071); the follow-up sends once per channel at generation 0, re-tick
absorbed, and mints NOTHING for a non-opted registrant. `workshop-lifecycle-routes`
grew to 43 — the ack executed through a recording gate stub (TRANSACTIONAL + handle +
plaintext + the decoded VCALENDAR with DTSTART/UID/DTEND), and the dispatcher executed
for the WS-069 dedupe both ways. `workshop-comms` 68 checks (day-of DST pair CDT/CST,
mode gate, follow-up delay, toPlainText, offset map + unmappedOffsets, D-8 absence);
`workshop-engine-invocation` 40 (WS-034 defers BEFORE the gate with the audited
reason). Fixture updates pinned deliberately: the three 1h guarantee fixtures now
configure the retained capability offset explicitly; `transactional-notifications`
pins the route's gate call and the ABSENCE of the direct-send ack. Full gates green:
196 unit files, 21 RLS files, type-check, lint, build. Manifest: EMPTY.

Findings closed: WS-011, WS-014, WS-022, WS-034, WS-041 (superseded by D-8 — the late
engine confirmation no longer exists), WS-067, WS-069, WS-071.

---

## MID-POINT CHECKPOINT (2026-08-29, after Batch 5) — Batches 7–8 RE-SCOPED

Held per Gate 1; re-graded against Batch 0–5 runtime evidence. HOLDING — nothing below
is implemented.

**Batch 7 items now CLOSED by earlier batches (dropped from scope):**
- WS-032 fail-closed personalization — Batch 1 (unknown tokens pass through to the gate).
- WS-034 URL-context guard — Batch 5 (email defers on missing app URL, audited).
- WS-040 attended duality — Batch 4 (reconcileAttendance from the PATCH).
- WS-042 cancel→session cascade half — Batch 4 (DB trigger, route-independent).
- WS-047 bare-status-flip half — Batch 1 route guard + Batch 4 WS-074/075.
- WS-048 session-ownership — Batch 2 (claim RPC session_mismatch) + Batch 4 PATCH check.
- Amendment-2 additions WS-065/WS-068 (Batch 1) and WS-072 (Batch 4, dedupe half).
- WS-050 remains owner-DEFERRED (not dropped).

**Batch 7 REMAINING scope (shrunk):**
1. WS-025 — defer commercial email while `sender_physical_address` still carries the
   placeholder marker (engine guard; PROVEN open: no guard in comms-engine.ts today).
2. WS-033 — HELP in the SMS footer + inbound HELP auto-response (copy per D-5);
   carrier Advanced Opt-Out stays a go-live checklist item.
3. WS-030 — cron auth: Bearer required whenever CRON_SECRET is set (PROVEN open:
   `x-vercel-cron` header alone still authorizes).
4. WS-028 (narrowed) — claim `nurtured_at` BEFORE side effects; Batch 4's email-dedupe
   + referral-keyed opportunity already bound the duplicate blast radius, so the
   remaining exposure is concurrent passes over a NO-EMAIL registrant.
5. WS-031 — bound per-tick work + batch the per-registration log lookups.
6. WS-039 — derive durable no_show attendance rows (adds 'derived' capture_method);
   segmentation already treats null as registered_no_show, so this is REPORTING truth.
7. WS-042 residue — recording_url writer (or drop it from the replay contract).
8. WS-043 — consult request fires notifyFsa.
9. WS-020 residue — graceful UI refusal on delete (DB already RESTRICTs since Batch 3).
10. WS-047 residue — material edits after approval do not invalidate compliance_approved
    (approval-snapshot staleness guard).

**Batch 8 items now CLOSED (dropped):**
- WS-021 core — the legacy /events/[id] page renders the SHARED settled-model form
  (SMS_REMINDER_DISCLOSURE at the phone field; claim RPC handles capacity/duplicate);
  residue: its workshop-wide seats display is cosmetic vs the per-session claim.
- WS-019/WS-058 test debt — Batch 0 (§11a 42/42; manifest; rebuilt suites).
- WS-024 form-state residue — Batch 2 (already-registered + full states shipped).
- WS-051 hydration + funnel `<a href>` — Batch 2 rewrite (no `<a href` remains in
  HubFilters / [slug] page; hub renders venue-TZ server strings).
- The "correctness suite re-run" bullet — now IS the standing RLS gate (send-once,
  quiet-hours, suppression, termination, lifecycle × 30, claim × 13).
- E2E waitlist scenario — collapsed by D-4 (no waitlist); becomes full→next-session.

**Batch 8 REMAINING scope (shrunk):** roster CSV export (WS-045 — the D-2 reporting
need); edit-workshop UI mount incl. budget_spend (WS-046) + check-in door polish
(WS-049); complete-state matrix + a11y pass + 375px proof on the public funnel
(WS-052/053/054/055/056 incl. stale docs/routes.md); WS-073 consult-conversion metric;
Playwright E2E (captured-transport, no real sends) over the owner's scenario list minus
waitlist; final full-gates run.

Deferred-not-dropped (unchanged): WS-050, WS-063, WS-B13.

---

## BATCH 7 — EXECUTION RECORD (2026-08-29)

Owner-approved shrunk scope + the three re-graded items + the two checkpoint rulings.

**WS-030 FIRST (owner: highest-severity item left).** The cron route triggers a LIVE
SEND ENGINE, and `x-vercel-cron` is client-supplied. Header-trust is GONE: authorization
is the Bearer `CRON_SECRET`, full stop; with no secret configured the route refuses
everything (fail closed). Platform stripping behavior stays NOT VERIFIED and is not
relied on. (The catch-all `/api/cron/[job]` route keeps its own auth — out of this
subsystem's scope, recorded here as adjacent.)

**WS-063 — REFUTED, not built.** `workshop_sessions.ics_uid text unique` (mig 038:144);
the live constraint `workshop_sessions_ics_uid_key` is verified on the applied chain and
now PINNED in the RLS suite, so two sessions cannot share a calendar UID and .ics files
cannot overwrite each other in an attendee's calendar. One line of verification, nothing
larger. Closed as refuted.

**WALK-IN CONSENT DEFAULT — reported, then made structural.** What Batch 3's walk-in
path writes TODAY (server.ts addWalkIn): `marketing_opt_in: input.marketing_opt_in ===
true` — FALSE unless the kiosk box is ticked — plus `consent_captured_at` and
`consent_form_version` ('signup-v2-2026-08 · walk-in') stamped in the same insert, with
evidence rows carrying the shown disclosure. So the default was already correct and the
capture record was already written. The HOLE was that nothing ENFORCED it: any other
path could set the flag true with no capture. Migration 132 adds
`wreg_marketing_capture_chk` — `marketing_opt_in = false OR (consent_captured_at is not
null AND consent_form_version is not null)` — making "no path sets it true without a
capture record" a database fact. The claim RPC (public form) leaves the column at its
FALSE default; the route stamps all three together after the claim. No tier added.
(The constraint immediately caught two TEST FIXTURES seeding an opted-in row with no
capture — they were corrected to model a real capture.)

**RULING — D-2 stage.** 'prospect' retained. Added per the ruling: `opportunities.source`
(mig 132, partial index) set to `'workshop_attendance'` on every attendance-time
placement, so district reporting segments these from conversion and cross-sell
opportunities in the same stage. **The `opportunities.stage` CHECK is the taxonomy of
record (migration 009:250-252), enumerated:** `prospect` → `fact_find` →
`quoted_proposed` → `application` → `underwriting_suitability` → `placed_issued` |
`lost`. `pipelines.ts` stays dead (do-not-revive notice, Batch 4).

**RULING — instant-ack gate handle: seeded approval REVERSED.** Migration 132 moves the
handle to `approval_status='submitted'` with an explicit PROVENANCE body (pre-existing
production receipt copy brought under the gate by D-8 — NOT principal-approved) and
names it as the FIRST item in the FFS queue. No approver is recorded on any template.
Until a firm principal approves it, gate step 4 blocks the registration receipt: a
DEPLOY BLOCKER, carried on the go-live checklist (Batch 8) for exactly that reason.
The 132 update is guarded on the provenance marker, so a later principal approval
survives a chain re-run (proven).

**Remaining scope, all shipped:**
- **WS-025** — commercial email DEFERS (`sender_address_placeholder`, audited) while the
  config holds the placeholder mailing address; transactional reminder-class receipts are
  NOT held hostage to a marketing config item (both halves proven, unit + PG).
- **WS-033** — `SMS_OPT_OUT_FOOTER` becomes 'Reply STOP to opt out, HELP for help.'; a
  bare HELP/INFO keyword gets the carrier-required identification reply as the webhook's
  own TwiML response (business identity + live contact + rates note + STOP) — a direct
  answer to the inbound message, delivered regardless of opt-out state, and NOT a second
  send path. Recorded in conversation history + audited. Carrier-level Advanced Opt-Out
  stays a go-live checklist item, NOT VERIFIED here.
- **WS-028** — the nurture pass CLAIMS `nurtured_at` (guarded null→set update) BEFORE any
  side effect, so concurrent passes cannot double-seed the spine; the securities-routing
  branch claims the same way.
- **WS-031** — every per-tick selection is bounded and ordered (200 sessions/tick, 1000
  registrations/session); ONE batched send-log read per session replaces the per-slot
  lookups, consumed as a HINT (the atomic claim is untouched — a stale hint just loses
  its race and skips).
- **WS-039** — an ended session with no attendance capture now gets a durable
  `no_show` row (`capture_method='derived'`, added to the CHECK in 132) so reports and the
  no_show segment work without staff reconcile; shipped segmentation is unchanged
  (proven: the same registrant still nurtures as registered_no_show with delta −2).
- **WS-042** — the replay surface's data source finally has a writer: `recording_url` +
  `recording_expires_at` via the workshops PATCH, targeting the most recent non-cancelled
  session (recordings land AFTER the event), never material (no generation bump, no
  change notice).
- **WS-043** — a consult request fires the `notifyFsa` ops alert (best-effort; the spine
  routing remains the durable record).
- **WS-047 residue** — material edits under a standing approval now INVALIDATE it:
  publish + material change in one request is rejected up front (zero writes), and a
  presenter/material edit on an approved/published workshop demotes to `pending_review`
  with the approval pointer voided, audited as `approval.decided / invalidated`. This
  takes a published workshop off the air — changed materials are unapproved materials.
- **WS-020 residue** — CLOSED as nothing-to-refuse: there is NO workshop hard-delete path
  anywhere (no DELETE route, no delete button, no `.delete()` on workshops); the mig-129
  `ON DELETE RESTRICT` remains the backstop.

**Proofs:** migration 132 applied on a fresh chain (133 files) with 6 probe groups green
— handle submitted+provenance and idempotent under re-run after a simulated principal
approval; `source` column + index; `derived` accepted / bogus rejected; marketing-true
without capture rejected, compliant shapes accepted, RPC default false; the WS-063
constraint. `workshop-lifecycle.test.mjs` → **40 checks** (adds derived no-show + segment
unchanged, ONE opportunity across two passes with `source='workshop_attendance'` and ONE
referral, the three standing 132 guards, and the WS-025 email-defers/SMS-sends pair).
`workshop-lifecycle-routes.test.mjs` → **59 checks** (adds WS-030 four ways, WS-047
residue three ways, WS-042 recording write, WS-043 notify, WS-033 TwiML + the real
`helpResponseBody`). `workshop-engine-invocation` → **43** (WS-025 both tiers).
Harness: the `NextResponse` stub became a real Response subclass (the webhook route
constructs one). Full gates: **196 unit files, 21 RLS files, type-check, lint, build** —
all green. Manifest: EMPTY.

Findings closed: WS-020 (residue), WS-025, WS-028, WS-030, WS-031, WS-033 (code side),
WS-039, WS-042, WS-043, WS-047 (residue), WS-063 (refuted). Deferred-not-dropped:
WS-050, WS-B13.
