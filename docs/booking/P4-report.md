# P4 — Observability + Pre-Ship Verification — Completion Report

> Companion to the P1–P3 reports. P4 delivered two owner-decided things: **booking analytics /
> observability derived from existing data** (no new table, no migration), and **closure of the
> a11y/responsive pre-ship gate via a manual checklist** (no automated browser-test platform).

## 1. Executive summary

P4 gave the booking program its observability layer and closed the standing a11y/responsive
verification prerequisite — both to explicit owner decisions. Analytics are computed purely from the
existing `appointments`, `comm_messages`, and `comm_message_events` rows (no schema change). The a11y
gate is now closed by a documented manual pre-ship checklist rather than an automated harness (a
prototyped Playwright+axe harness was **reverted**, unpushed, as disproportionate for a single-FSA
tool).

## 2. Scope confirmation (owner decisions)

- **Analytics:** derive from existing tables only — **no new events table, no migration.** ✅
- **A11y harness:** do **not** install Playwright/axe/a CI browser platform; close the prerequisite
  as a **manual pre-ship checklist** (browser tab-through + axe extension + SR + responsive). ✅
- Read-only observability; no engine touch; §9.6 (notification config read-only) untouched.

## 3. Files changed

**Analytics (Decision 1):**
- `lib/appointments/analytics.ts` (pure, 4 tests) — `bookedViaBreakdown`, `meetingModeBreakdown`,
  `reminderCoverage`, `notificationStats` (delivery/open/click, deduped by message); reuses
  `appointmentFunnel`.
- `app/(fsa)/app/calendar/analytics/page.tsx` — read-only observability page over appointments +
  appointment `comm_messages`/`comm_message_events`; archetype kit; linked from the command center.
- `tests/appointments-analytics.test.mjs` — 4 assertions.

**A11y gate (Decision 2):**
- `docs/adr/ADR-035-a11y-preship-checklist.md` — the decision (manual checklist, not a platform) +
  rationale + alternatives.
- `docs/booking/a11y-preship-checklist.md` — the checklist (axe extension scan, keyboard, SR,
  responsive breakpoints, contrast) across the booking surfaces, with a sign-off table.
- `docs/booking/deploy-notes.md` — the a11y gate now points to the checklist as its closure.
- `CLAUDE.md` §19 — ADR-035 indexed.
- (Reverted, unpushed: `playwright.config.ts`, `e2e/`, the Playwright/axe devDeps, `test:a11y`.)

## 4. Database changes

**None.** No migration. Analytics read existing tables only.

## 5. Verification

- `type-check` ✓ · `lint` ✓ · `build` ✓ (`/app/calendar/analytics` compiles) · `npm test` ✓ —
  **135 unit test files** (incl. the 4 new analytics assertions).
- Metrics are honest: percentages are 0 (never NaN) with no data (§32); open/click deduped by
  message; show-rate reuses the command-center funnel so it can't diverge.
- a11y/responsive: closed procedurally (the manual checklist is run before each ship — see ADR-035).

## 6. Security / ledger

- The analytics page is FSA-portal-guarded and reads via service-role (`getDb`), consistent with the
  rest of `/app`. It reads `comm_messages`/`comm_message_events` — **already covered by the existing
  comms-RLS pre-multi-tenant ledger entry** (app-layer isolation, single-FSA acceptable, hard blocker
  before multi-tenant). **No new ledger item** for analytics.
- Pre-multi-tenant ledger remains: (1) comms row-isolation app-layer-only; (2) availability-conflict
  check point-in-time. Both gate on the same deferred multi-tenant boundary.

## 7. Known limitations / follow-ups

1. **A11y verification is manual, not CI-enforced** — relies on running the checklist before each
   ship; not regression-proof between runs (the accepted trade-off in ADR-035 for a single-FSA tool).
2. **Visual-regression** (pixel diff) remains a separate, unaddressed concern.
3. **Analytics are all-time aggregates**, not a time-series/trend — a per-period trend is a possible
   follow-up (would stay pure over the same tables; still no new table needed).
4. a11y/responsive across authenticated surfaces is covered by the checklist's surface list; there is
   no automated auth-fixture (by decision).

## 8. Verdict

P4 is complete and green on every automated gate, to both owner decisions: observability derived from
existing data with no migration, and the a11y/responsive gate closed by a proportionate manual
checklist. No new subsystem, no dependency, no CI change. **No push/PR/deploy performed — withheld
pending authorization.**
