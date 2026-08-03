# P2 — Internal Appointment Command Center — Completion Report

> Companion to `docs/booking/P2-plan.md`. Records what was built, how it was verified, and what
> remains. Same operating mode as P1: automated gates are harness-backed; a11y/responsive/visual are
> **verified by inspection only** (no browser/a11y harness in the repo) — that remains a hard
> pre-ship gate closed by P4 (`docs/booking/deploy-notes.md`).

## 1. Executive summary

Modernized the FSA's operational appointment workspace at `/app/calendar` into a command center —
**over the existing appointment backend, with no parallel scheduler and no migration**. Added: an
attention-first KPI strip; a filterable/sortable list; a per-appointment detail with a reusable
communications + audit timeline; internal note + follow-up-task actions; an owner-approved FSA
time-change reschedule (reusing the one booking mover); an approved-communication resend through the
existing §12 gate; and week/month calendar grids. All decision-gated writes (reschedule, send) were
reviewed as diffs before commit. Every automated gate is green throughout.

## 2. Scope confirmation

- **Reuse, not rebuild:** one appointment model, one lifecycle service, one availability engine, one
  comms gate, one reschedule mover. No second appointment backend, no competing pattern (§6, §0.6).
- **No migration** (P2 goal): pure UI + read queries + narrow additive writes over existing tables.
- **Guardrails:** appointment rows are `is_security=false`; the note/task actions are green-zone
  (contact no one); the send action routes only an approved template through the §12 gate.
- **Decision gating honored:** D-P2-1 (reschedule) resolved to option (a) and built as a reviewed
  diff; the send action was likewise reviewed before commit.

## 3. Files changed

**Pure logic (DB-free, unit-tested):**
- `src/lib/appointments/list.ts` — command-center read model (KPI buckets) + `tests/appointments-list.test.mjs` (4)
- `src/lib/comms/timeline.ts` — timeline normalize/redact/merge + `tests/comm-timeline.test.mjs` (6)
- `src/lib/appointments/grid.ts` — week-layout + calendar-nav math + `tests/appointments-grid.test.mjs` (4)

**Server (services / loaders):**
- `src/lib/appointments/service.ts` — `addAppointmentNote`, `createAppointmentFollowupTask` (new)
- `src/lib/comms/timeline-load.ts` — RLS-scoped, role-redacted timeline loader (new)
- `src/lib/booking/manage.ts` — `rescheduleAppointment` gains `actor` + reminder re-anchor; `loadManagedAppointment` (new)
- `src/lib/booking/notify.ts` — `sendBookingConfirmation` optional `actor` (backward-compatible)

**API routes (all `requireApiRole('fsa')` + `requirePermission` + `actorOf` + `writeAudit`):**
- `src/app/api/app/appointments/[id]/note/route.ts` (new)
- `src/app/api/app/appointments/[id]/task/route.ts` (new)
- `src/app/api/app/appointments/[id]/reschedule/route.ts` (new — GET slots + POST move)
- `src/app/api/app/appointments/[id]/send/route.ts` (new)
- `src/app/api/public/booking/manage/route.ts` (call-site: passes `'public'` actor)

**Components:**
- `src/components/app/AppointmentList.tsx`, `AppointmentActions.tsx`, `RescheduleControl.tsx`, `AppointmentCalendarGrid.tsx` (new)
- `src/components/comms/CommTimeline.tsx` (new, reusable — P5.13 mounts it)
- `src/components/app/CalendarView.tsx` (export shared `STATUS_MAP`)

**Pages:**
- `src/app/(fsa)/app/calendar/page.tsx` — KPI strip + book-health + filterable list + calendar grid
- `src/app/(fsa)/app/calendar/[id]/page.tsx` — appointment detail + timeline + actions (new)

**Docs:** `docs/specs/rbac-matrix.md` (Appointment & Booking row); `docs/booking/P2-plan.md`
(decisions + P5 handoff notes); this report.

## 4. Database changes

**None.** No migration. All reads/writes are over existing tables (`appointments`, `activities`,
`work_tasks`, `comm_messages`, `comm_message_events`, `audit_log`). No index was required.

## 5. Verification

### 5.1 Automated (harness-backed) — run at every slice, green at completion
- `npm run type-check` — clean.
- `npm run lint` — clean (no warnings or errors).
- `npm run build` — success; `/app/calendar`, `/app/calendar/[id]`, and all four new API routes compile.
- `npm test` — **129 unit test files pass**, including the RLS/guardrail/auth-matrix suites and the
  **14 new P2 assertions** (list 4, timeline 6, grid 4).

### 5.2 Verified by inspection — no automated a11y/responsive/visual harness
- **Keyboard + labels:** list search/filter/sort controls labeled (`aria-label` / `sr-only` + `htmlFor`);
  detail timeline is an `<ol aria-label>` with `<time dateTime>`; note textarea labeled; calendar
  view switcher is a labeled `role="group"` with `aria-pressed`; prev/next carry `aria-label`; the
  month label is `aria-live="polite"`; chips and "+N more" are focusable links/buttons with visible
  focus rings and descriptive `aria-label`s.
- **States:** loading / empty (with next action) / error (retryable) / success present on the
  overview, list, detail, timeline, reschedule picker, and grid.
- **Responsive:** wide tables and the calendar grid are wrapped in `overflow-x-auto` containers; the
  page body never scrolls horizontally; KPI strips reflow at sm/lg/xl.
- **Tokens/brand:** status colors resolve through the existing `STATUS_MAP` → `Badge` variants
  (AA-tuned tokens); no hardcoded colors introduced.

### 5.3 Not performed (harness gap — same as P1)
- No browser/e2e run; no automated a11y (axe) or contrast audit; no visual-regression capture.
- No live-Supabase integration test of the new endpoints — they follow the established guarded
  service pattern and RLS remains the row guarantee. These remain the P4 pre-ship gate.

## 6. Security & compliance

- **Server-enforced authz** on every action endpoint (`requireApiRole('fsa')` +
  `requirePermission(['fsa','licensed_staff','super_admin'])`) before any work; audited via `writeAudit`.
- **Timeline redaction is server-side:** message bodies, recipients (PII), and provider ids are
  dropped in the pure mappers per the viewer's role (`revealFor`) before an entry leaves the server;
  FSA sees bodies/recipients but not provider ids, ops/compliance/super see provider ids, partner/
  client see none. Raw audit `diff` is never dumped.
- **Send path:** re-sends only the **approved** appointment confirmation through the one dispatcher
  gate (`sendThroughGate`) — consent, quiet hours, DNC, approved-template all enforced. Zod accepts
  `kind:'confirmation'` only (no free-text, no AI content) → no red-line surface. A gate block is a
  reported outcome, never forced or faked.
- **Reschedule:** reuses the shared mover — the D1 status-guarded conditional UPDATE (fail-closed on
  concurrent change; unique index turns a racing claim into a clean 409) — validates the new slot
  against live availability, and **re-anchors the reminder** (clears `reminder_sent_at`; also fixes a
  latent gap in the public flow).
- **Securities firewall:** all appointment rows `is_security=false`; no securities data touched.

## 7. Known limitations / follow-ups

1. **Reschedule notice reclassification (P5).** The reschedule currently re-sends the confirmation
   template; when P5's communication-lifecycle classification lands it must route as a `"rescheduled"`
   event (not a fresh confirmation) and gate any SMS leg on consent. (Recorded in the plan's P5
   handoff notes; the reminder re-anchor is already correct.)
2. **Audit-timeline title convention (P5).** Friendly titles depend on a semantic `diff.event`
   string with a generic fallback; new audited events should set `diff.event` and extend
   `EVENT_TITLES`. (Recorded in the plan.)
3. **Calendar grid semantics.** The grid uses a CSS grid of focusable links/buttons (keyboard- and
   SR-reachable) rather than a `role="grid"` widget with arrow-key cell traversal — a future a11y
   enhancement, not a blocker.
4. **Send scope.** Only "resend confirmation" is exposed; a single-appointment "send reminder now"
   was intentionally deferred (reminders stay cron-driven). Extend the send endpoint's `kind` enum
   with additional approved templates when needed.
5. **Booking-config (G) grants** in the RBAC row reflect intended scoping (FSA owns own availability/
   types; super full); verify against the config endpoints when booking-config work is next touched.
6. **a11y / responsive / visual** are inspection-verified only — the automated harness gap is the
   standing P4 pre-ship gate.

## 8. Verdict

P2 is functionally complete and green on every automated gate, over the existing backend with no
migration and no parallel subsystem. The two engine-adjacent / outward-facing writes (reschedule,
send) were owner-reviewed as diffs before commit and confirmed to reuse the single write path and
the single §12 gate. Remaining items are documented follow-ups (chiefly the P5 lifecycle
reclassification) and the standing inspection-harness gate at P4. **No push/PR/deploy performed —
withheld pending authorization.**
