# P2 — Internal Appointment Command Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (or
> `executing-plans`) task-by-task; `frontend-design` authors UI, `impeccable` gates it. Evidence
> base: the P2 surface map (below) + `docs/booking/P0-evidence-report.md`. Begin **only after** the
> one open decision in §Decisions is resolved for anything it gates.

**Goal:** Modernize the FSA's operational appointment workspace into a command center — today/
upcoming/pending/no-shows/follow-ups, a filterable list, day/week/month/agenda views, and a
per-appointment detail with its full spine + communication history — **over the existing
appointment backend, reusing existing services and action endpoints.**

**Architecture:** Extend the **existing** `/app/calendar` operational view (funnel tiles + overdue
triage + no-show recovery + agenda already exist) — **do not fork a parallel command center and do
not build a second appointment backend** (§0.6, §8.1). Follow the repo's established internal
pattern: server components load via `@/lib/data/query` → pass rows to `'use client'` list/detail
components built from the **archetype shells**; actions call the **existing** endpoints. Grid views
lift the pure math from `public/booking/month-grid.ts` (grid math is reusable; the public component
is not).

**Tech stack:** Next.js 14 RSC + `'use client'` islands, TS strict, Tailwind + shadcn/ui tokens,
archetype shells (`ListShell`/`DetailShell`/`DrawerShell`/`Section`/`StatTile`/`StatusBadge`),
`PageStatStrip`, `@/components/ui/table`. Tests: the bespoke Node runner; **no browser/a11y
harness** — a11y/responsive/visual are inspection-only (P0 §5), and this remains a hard pre-ship
gate closed by P4 (`docs/booking/deploy-notes.md`).

## Global Constraints

- **Reuse, don't rebuild** (§0.6, §8.1): one appointment model, one lifecycle service
  (`lib/appointments/service.ts` — already TOCTOU-guarded via the D1 fix), one availability engine
  (`computeSlotsForType`), one comms path (`sendThroughGate`). No parallel scheduler/model/flow.
- **Actions use existing endpoints** where they exist: `PATCH /api/app/appointments/[id]`
  (confirm→scheduled / complete / no_show / cancel, validated by the pure state machine in
  `recovery.ts`), `POST /api/app/appointments/recovery`, `POST /api/app/booking/provision-zoom`.
  Implement a **new** operation only when narrowly scoped and either already backend-supported or
  approved (§Decisions).
- **Server-enforced authz on every action:** `requireApiRole('fsa')` + `requirePermission(session,
  ['fsa','licensed_staff','super_admin'])` + `actorOf` + `writeAudit` — the established triad.
  Forbidden → `ForbiddenState`/403. The frontend never enforces permissions.
- **Guardrails still apply:** the securities firewall (booking rows are `is_security:false`) and,
  for any send, the §12 dispatcher gate (consent/quiet-hours/DNC/approved-template) — P2 never
  bypasses the gate; "send approved communication" routes through the existing send path only.
- **Read-only detail:** the detail view joins spine records and history; it does not mutate them.
- **No migration** expected in P2 (it's UI + read queries over the existing schema). If any read
  needs an index, add it as a forward-only migration and flag it (none anticipated).
- **Gate each task:** `type-check` + `lint` + `test` stay green; `build` passes before phase done.
  Commit per slice; **no push/PR/merge/deploy** without explicit human authorization.

## What exists (reuse) vs missing (build)

**Reuse:** the full `appointments` schema (contact/household/opportunity/review/type FKs,
starts_at/ends_at/duration/tz, meeting_mode, Zoom fields, booked_via, cancellation_reason,
reminder_sent_at); `recovery.ts` (state machine, `isOverdue`, `appointmentFunnel`, `needsRecovery`,
`planNoShowRecovery`); `service.ts` (`setAppointmentStatus`, `runNoShowRecovery`); the three action
endpoints; `computeSlotsForType`; `sendThroughGate` with `entity:{type:'appointment'}`; the
`activities`/`work_tasks`/`comm_messages(entity_type,entity_id)`/`audit_log` linkage; the archetype
UI kit; the `/app/calendar` page + `CalendarView` (agenda) + `AppointmentStatusControls` +
`RunAppointmentRecoveryButton`; the `HouseholdList`/`cases`/`HouseholdProfile` exemplars.

**Build:** a shared appointment **read/query layer**; a modernized command-center **overview**; a
**filterable/sortable list**; a per-appointment **detail** (drawer or `/app/calendar/[id]`) with a
unified **history/notification timeline**; **week/month grid** views (agenda exists); the
**standalone actions** not yet exposed (add-note, single-appointment follow-up task, send-approved-
comm-from-FSA) as narrowly scoped endpoints; an explicit **RBAC row** for appointments in
`docs/specs/rbac-matrix.md`; and — pending the §Decisions call — an **FSA time-change reschedule**.

---

## Decisions (resolve before the slices they gate)

**D-P2-1 — FSA-side time-change reschedule (new write path). NEEDS OWNER APPROVAL before build.**
Today the FSA can only flip status `no_show/cancelled → scheduled` (not move the time). A true
"reschedule to a new slot" from the FSA side does **not** exist — only the public signed-token flow
(`lib/booking/manage.ts`, `actor:'public'`). Options:
- **(a) Thin authenticated endpoint reusing the existing move logic** — a new
  `POST /api/app/appointments/[id]/reschedule` that reuses `computeSlotsForType` for the picker and
  the **same atomic move + Zoom-sync + notify path** as `manage.ts` (extract the move into a shared
  helper so there is ONE reschedule implementation, not two). Preferred — no second flow, honors
  §0.6. Requires a small, reviewed change near the booking engine boundary.
- **(b) Defer** — P2 ships reschedule as "cancel + rebook" / the public link only; the FSA time-
  change endpoint is its own later slice.
This is the one P2 item that adds a write near the engine; per the D-item rhythm it waits for an
explicit decision. Slices below marked *(gated: D-P2-1)* depend on it; everything else proceeds.

---

## Slices

### P2.1 — Appointment read model + command-center overview
**Files:** create `src/lib/appointments/list.ts` (pure query-shape helpers + row types; DB access
stays in the server component via `@/lib/data/query`, matching the repo pattern — no new API);
modify `src/app/(fsa)/app/calendar/page.tsx` (modernize the landing); reuse `recovery.ts` funnel.
- Overview KPI strip (`PageStatStrip`/`StatTile`): **Today**, **Upcoming (next 7d)**, **Pending
  decision (overdue)**, **No-shows (unrecovered)**, **Follow-ups due** (`work_tasks`
  entity=appointment, open), **Missing notes** (scheduled/completed with no `activities` note),
  **Calendar health** (Google connection status from `booking_calendar_connections`).
- Actionable segments beneath (reusing the existing overdue/no-show tables + agenda), each with a
  clear next action and empty/loading/error states.
- **Tests:** unit for any pure list/funnel helper added to `list.ts` (isolated-compile pattern).

### P2.2 — Filterable appointment list
**Files:** create `src/components/app/AppointmentList.tsx` (`'use client'`, mirror `HouseholdList`);
wire into the calendar page (a "List" view alongside the agenda).
- Server loads joined rows (contact name, type name, starts_at, status, meeting_mode, booked_via);
  client provides search (name/email), status tabs/filter, date-range, sort, pagination, CSV export
  with an audit ping (mirroring `HouseholdList`). Row → detail. Full states + `StatusBadge`.

### P2.3 — Appointment detail + unified history
**Files:** create `src/app/(fsa)/app/calendar/[id]/page.tsx` (or a `DrawerShell` from the list) +
`src/components/app/AppointmentDetail.tsx`; read-only joined loads.
- Joins: contact, household, opportunity, review, type, meeting/Zoom (client `join_url` only —
  **never `start_url`**, FSA-only), booked_via, cancellation_reason, reminder_sent_at.
- **Unified timeline** = `activities` + `comm_messages`(entity=appointment) + `work_tasks` +
  `audit_log`, merged chronologically — this is the "notification history" (P2.13 §8.4 continuity).
- Links out to the client/household/opportunity records. Read-only; all mutation via P2.4 actions.

### P2.4 — Actions (reuse existing endpoints; add only the narrow gaps)
**Files:** action controls in the detail/list (reuse `AppointmentStatusControls`); new **small**
endpoints only where missing.
- **Confirm / Complete / No-show / Cancel:** existing `PATCH /api/app/appointments/[id]` (status +
  optional note + opportunity link). Confirmation before destructive (`ConfirmDialog`).
- **Open client record / create follow-up task / send approved communication:** open-record is a
  link; follow-up task and send-comm reuse existing plumbing — add a **narrowly scoped**
  `POST /api/app/appointments/[id]/task` (single `work_tasks` insert + audit) and route "send" through
  the **existing** gate/send path only (approved template; no new send path, §12). Add-note = a
  small `activities` insert endpoint (or reuse the PATCH `note`).
- *(gated: D-P2-1)* **Reschedule (time change):** only if option (a) is approved — reuse the shared
  move helper; otherwise omit here.

### P2.5 — Calendar grid views (week / month)
**Files:** create `src/components/app/AppointmentCalendarGrid.tsx` reusing the **pure** month-grid
math from `public/booking/month-grid.ts` (lift/share the math, not the public component); a
view switcher Agenda ↔ Week ↔ Month on the calendar page.
- Renders appointments (not slot availability) into day/week/month grids with status coloring,
  overflow handling, keyboard nav, and the same token language. No team/multi-advisor views (§2).

### P2.6 — RBAC row, polish, a11y (inspection), P2 report
- Add an explicit **Appointment/Booking** row to `docs/specs/rbac-matrix.md` matching the code's
  enforced grants (confirm/complete/no_show/cancel/note/task/send-comm →
  fsa/licensed_staff/super_admin; config → admin/super) rather than leaving it implicit (§13.14).
- `impeccable` pass on every new surface; responsive + a11y **by inspection** (state the harness gap
  explicitly, as in P1); `docs/booking/P2-report.md` per §8/§14 with the automated-vs-inspection-vs-
  not-performed split.

## Self-review
- Every §8 command-center element maps to a slice: overview segments (P2.1), list w/ search/filter/
  sort/pagination (P2.2), detail + spine links + notification history (P2.3, §8.4), actions
  incl. confirm/reschedule/cancel/complete/no-show/notes/open-record/follow-up/send-comm (P2.4,
  §8.5 — reschedule gated), calendar day/week/month/agenda (P2.5 + existing agenda).
- No second backend/model/flow introduced; reschedule (the only engine-adjacent write) is gated on
  an explicit decision and, if built, shares ONE move implementation with `manage.ts`.
- Migration-free; RBAC documented; a11y honestly inspection-only.

## Execution handoff
Recommended: subagent-driven, one slice per subagent + adversarial review, `frontend-design` /
`impeccable` gated. **Start with P2.1** (safe read/UI, no engine touch) after this plan is reviewed.
Resolve **D-P2-1** before P2.4's reschedule. Push/PR/merge/deploy withheld pending authorization.
