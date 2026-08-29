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
