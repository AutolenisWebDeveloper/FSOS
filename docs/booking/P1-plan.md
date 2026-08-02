# P1 — Premium Public `/schedule` Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Design work is gated by `frontend-design` (authoring) and
> `impeccable` (review). Evidence base: `docs/booking/P0-evidence-report.md`.

**Goal:** Transform the public `/schedule` page from a plain utility surface into a premium, native
Markist FSA website experience — over the **existing, unchanged** public booking APIs.

**Architecture:** Extend (never fork) the existing `PublicShell` primitives + `BookingFlow` /
`ManageFlow`. Extract presentation into focused sub-components under
`src/components/public/booking/**` and pure UI logic into unit-testable helpers. The booking engine,
Zod wire contracts, and the shared render/send path are untouched. New route-level `loading`/`error`
segments and a schedule-scoped brand lockup (using the approved `public/brand/farmers-logo.svg`)
complete the shell.

**Tech Stack:** Next.js 14 App Router (RSC + `'use client'` islands), TypeScript strict, Tailwind +
shadcn/ui resolved through `globals.css` / `tailwind.config.ts` tokens, `sonner` toasts, existing
`@/components/ui/*` + `@/components/forms/Field`. Tests: bespoke Node runner
(`scripts/run-tests.mjs unit`, suites in `tests/*.test.mjs`) — **no browser/a11y harness exists**
(P0 §5); UI is verified **manually**.

## Global Constraints

- **Engine is frozen.** Do NOT modify any file in the P0 §7.2 "MUST NOT modify" list
  (`api/public/booking/**`, `lib/booking/{book,manage,slots,availability,timezone,manage-tokens,ics}.ts`,
  `config-schemas.ts`, `lib/comms/personalize.ts`, `lib/booking/notify*.ts`, `lib/site.ts`,
  `lib/data/query.ts`, `lib/http/*`). If a defect blocks the UI, STOP and escalate (Binding Rule 7).
- **Wire contracts are fixed** (P0 §7.3): `PublicBookingInput` field names
  (`typeSlug, startsAt, bookerTimezone, name, email, phone?, notes?, company?`-honeypot);
  availability query (`type, tz, from, days`) and response (`{type, timezone, slots}`); manage
  GET/POST (`t`, `action: 'cancel'|'reschedule'`). The **`company` honeypot must be preserved.**
- **Title:** Markist Athelus is a **Financial Services Agent (FSA)** — never Agency Owner, Advisor,
  Wealth Manager, Fiduciary, Independent Advisor, or Investment Adviser.
- **No fabricated content:** no testimonials, reviews, ratings, awards, certifications, affiliations,
  client counts, experience figures, fiduciary/performance claims, or guarantees.
- **No sensitive public fields:** never collect SSN, full account numbers, credentials, government
  ID, medical detail, or financial documents on the public page.
- **Consent unchanged:** booking implies **email-about-this-appointment** consent only; it is NOT
  marketing consent and NOT SMS consent. Do not add an SMS opt-in in P1 (that is P5). Keep the
  existing disclosure copy semantics; refine presentation, not meaning.
- **Design direction:** premium **white** workspace, refined Farmers **blue** accents, strong
  typography/hierarchy, subtle elevation, minimal intentional motion, high contrast, WCAG 2.2 AA.
  No dominant black/dark UI, no heavy gradients/glass, no generic third-party-widget look. Resolve
  every color/spacing/font through a **token** — never hardcode a hex.
- **Tokens are append-only** to `globals.css` / `tailwind.config.ts`; any new pattern/token is
  recorded in `DESIGN.md` in the same change (§18).
- **Brand assets:** use `public/brand/farmers-logo.svg` as-is — never stretch/recolor/recreate. The
  `BrandMark` monogram is the FSA's own mark, not the Farmers trademark; don't conflate them.
- **All states required** on every surface: loading (skeleton, not bare spinner) / empty (with next
  action) / error (isolated, retryable) / success.
- **Gate each task:** `npm run type-check` + `npm run lint` + `npm test` must stay green; the
  production `npm run build` must pass before the phase is called done. Commit per task; **do not
  push / open a PR / merge** — that awaits explicit human authorization (operating mode).

---

## File Structure

**New (create):**
- `src/components/public/booking/ScheduleHero.tsx` — premium hero (approved content/assets only).
- `src/components/public/booking/BookingStepper.tsx` — step indicator (presentational).
- `src/components/public/booking/step-model.ts` — **pure** step derivation/labels (unit-tested).
- `src/components/public/booking/TypeCard.tsx` — appointment-type card (presentational).
- `src/components/public/booking/CalendarMonth.tsx` — month calendar (client island).
- `src/components/public/booking/month-grid.ts` — **pure** month-matrix + slot-day grouping (tested).
- `src/components/public/booking/ReviewSummary.tsx` — review-before-submit (presentational).
- `src/components/public/booking/PublicBrandHeader.tsx` — schedule-scoped Farmers-logo lockup.
- `src/app/schedule/loading.tsx`, `src/app/schedule/error.tsx` — route-level states.
- `tests/booking-step-model.test.mjs`, `tests/booking-month-grid.test.mjs` — pure-logic tests.

**Modify (presentation only):**
- `src/app/schedule/page.tsx` — compose hero + brand header + refined chooser.
- `src/components/public/booking/BookingFlow.tsx` — orchestrate the extracted sub-components.
- `src/components/public/booking/ManageFlow.tsx` — apply the same premium treatment.
- `src/lib/booking/display.ts` — presentational labels/format helpers only (append).
- `src/app/globals.css` / `tailwind.config.ts` — **append-only** tokens if needed.
- `DESIGN.md` — record any new pattern/token.

**Explicitly untouched:** everything in P0 §7.2.

---

### Task 0: Design foundation — brand header, route states, tokens

**Files:**
- Create: `src/components/public/booking/PublicBrandHeader.tsx`, `src/app/schedule/loading.tsx`,
  `src/app/schedule/error.tsx`
- Modify: `src/app/globals.css` / `tailwind.config.ts` (only if a new token is genuinely needed),
  `DESIGN.md`

**Interfaces:**
- Produces: `PublicBrandHeader` (RSC-safe, no props) — renders the approved
  `public/brand/farmers-logo.svg` via `next/image` with correct proportions + clear space and the
  "Markist Athelus · Financial Services Agent" wordmark, on the white shell. Used by `page.tsx` and
  the flows. `ScheduleLoading` / `ScheduleError` default exports for the route.

- [ ] **Step 1 — Read the design contract.** Load `frontend-design`; read `DESIGN.md` token/color
  sections + `src/app/globals.css` `--shell*`/card/elevation tokens + `tailwind.config.ts` mappings.
  Confirm which existing tokens express "premium white + Farmers blue." Do **not** invent tokens if
  existing ones suffice.
- [ ] **Step 2 — Build `PublicBrandHeader.tsx`.** Server-safe component: `next/image` of
  `/brand/farmers-logo.svg` (fixed intrinsic size, no distortion), plus a token-styled wordmark line
  "Markist Athelus" (`text-foreground`) + "Financial Services Agent" (`text-muted-foreground`,
  `.mono-label` scale). No fabricated credentials.
- [ ] **Step 3 — Build `src/app/schedule/loading.tsx`.** A skeleton (not a bare spinner) matching the
  page's card layout using existing skeleton utilities/tokens.
- [ ] **Step 4 — Build `src/app/schedule/error.tsx`.** `'use client'` error boundary with a plain-
  language message, a `reset()` retry button, and a link back to the site — no stack/internal detail.
- [ ] **Step 5 — Verify build + lint + types.**
  Run: `npm run type-check && npm run lint && npm run build`
  Expected: all exit 0; `/schedule` still builds; new `loading`/`error` segments registered.
- [ ] **Step 6 — Record any new token/pattern in `DESIGN.md`; commit.**
  `git add -A && git commit -m "feat(booking-ui): schedule brand header + route loading/error states"`

---

### Task 1: Pure step model (TDD)

**Files:**
- Create: `src/components/public/booking/step-model.ts`, `tests/booking-step-model.test.mjs`

**Interfaces:**
- Produces: `type BookingStep = 'type' | 'slot' | 'details' | 'review' | 'confirmed'`;
  `BOOKING_STEPS: BookingStep[]`; `stepLabel(step): string`;
  `deriveStep(s: { hasType: boolean; hasSlot: boolean; reviewing: boolean; confirmed: boolean }): BookingStep`;
  `stepIndex(step): number`; `completedSteps(current): BookingStep[]`.
  Consumed by `BookingStepper` and `BookingFlow`. **Pure — no React, no DOM, no clock.**

- [ ] **Step 1 — Write the failing test** (`tests/booking-step-model.test.mjs`):

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveStep, stepIndex, completedSteps, stepLabel, BOOKING_STEPS } from '../src/components/public/booking/step-model.ts'

test('deriveStep walks type → slot → details → review → confirmed', () => {
  assert.equal(deriveStep({ hasType: false, hasSlot: false, reviewing: false, confirmed: false }), 'type')
  assert.equal(deriveStep({ hasType: true,  hasSlot: false, reviewing: false, confirmed: false }), 'slot')
  assert.equal(deriveStep({ hasType: true,  hasSlot: true,  reviewing: false, confirmed: false }), 'details')
  assert.equal(deriveStep({ hasType: true,  hasSlot: true,  reviewing: true,  confirmed: false }), 'review')
  assert.equal(deriveStep({ hasType: true,  hasSlot: true,  reviewing: true,  confirmed: true  }), 'confirmed')
})

test('confirmed always wins and completedSteps excludes the current step', () => {
  assert.equal(deriveStep({ hasType: false, hasSlot: false, reviewing: false, confirmed: true }), 'confirmed')
  assert.deepEqual(completedSteps('details'), ['type', 'slot'])
  assert.equal(stepIndex('type'), 0)
  assert.equal(stepLabel(BOOKING_STEPS[0]).length > 0, true)
})
```

- [ ] **Step 2 — Run it; verify it fails.** Run: `npm test` → FAIL (module not found).
- [ ] **Step 3 — Implement `step-model.ts`** with the exact signatures above; `deriveStep` returns
  `confirmed` if `confirmed`, else `review` if `reviewing`, else `details` if `hasSlot`, else `slot`
  if `hasType`, else `type`. `completedSteps(current)` = steps before `stepIndex(current)`.
- [ ] **Step 4 — Run it; verify it passes.** Run: `npm test` → all pass (count increases).
- [ ] **Step 5 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): pure booking step model (TDD)"`

---

### Task 2: Pure month-grid + slot-day grouping (TDD)

**Files:**
- Create: `src/components/public/booking/month-grid.ts`, `tests/booking-month-grid.test.mjs`

**Interfaces:**
- Produces:
  `buildMonthMatrix(year: number, month0: number): { dateKey: string; day: number; inMonth: boolean }[][]`
  (6×7, Sunday-start, `dateKey` = `YYYY-MM-DD`);
  `groupSlotsByDay(slots: { startsAt: string }[], tz: string): Map<string, { startsAt: string }[]>`
  (keys are local `YYYY-MM-DD` via the existing `localDateKey` from `@/lib/booking/timezone`);
  `dayState(dateKey, availableKeys: Set<string>, todayKey: string): 'available'|'unavailable'|'past'`.
  **Pure**, clock injected (caller passes `todayKey`), reuses `timezone.ts` (read-only import).

- [ ] **Step 1 — Write the failing test** covering: a known month's matrix is 6 rows × 7 cols with
  correct leading/trailing `inMonth:false` cells and correct `dateKey`s; `groupSlotsByDay` buckets
  two ISO instants into their local day keys for `America/Chicago`; `dayState` returns `past` before
  `todayKey`, `available` when in `availableKeys`, else `unavailable`.

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMonthMatrix, groupSlotsByDay, dayState } from '../src/components/public/booking/month-grid.ts'

test('buildMonthMatrix is a 6x7 Sunday-start grid with correct in-month flags', () => {
  const m = buildMonthMatrix(2026, 7) // August 2026 (month0=7); Aug 1 2026 is a Saturday
  assert.equal(m.length, 6)
  assert.ok(m.every(r => r.length === 7))
  const aug1 = m.flat().find(c => c.dateKey === '2026-08-01')
  assert.equal(aug1.inMonth, true)
  assert.equal(aug1.day, 1)
})

test('groupSlotsByDay buckets by LOCAL day; dayState classifies', () => {
  const g = groupSlotsByDay([{ startsAt: '2026-08-03T14:00:00Z' }], 'America/Chicago') // 9:00 CDT → Aug 3
  assert.equal(g.get('2026-08-03')?.length, 1)
  assert.equal(dayState('2026-08-02', new Set(['2026-08-03']), '2026-08-03'), 'past')
  assert.equal(dayState('2026-08-03', new Set(['2026-08-03']), '2026-08-03'), 'available')
  assert.equal(dayState('2026-08-04', new Set(['2026-08-03']), '2026-08-03'), 'unavailable')
})
```

- [ ] **Step 2 — Run; verify fail.** `npm test` → FAIL.
- [ ] **Step 3 — Implement `month-grid.ts`** with the three pure functions (import `localDateKey`
  from `@/lib/booking/timezone` for grouping; matrix math uses UTC `Date` constructors on the
  first-of-month only for calendar layout, never for slot time).
- [ ] **Step 4 — Run; verify pass.** `npm test` → all pass.
- [ ] **Step 5 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): pure month-grid + slot-day grouping (TDD)"`

---

### Task 3: Premium hero + refined type chooser (`page.tsx`)

**Files:**
- Create: `src/components/public/booking/ScheduleHero.tsx`, `src/components/public/booking/TypeCard.tsx`
- Modify: `src/app/schedule/page.tsx`

**Interfaces:**
- Consumes: `PublicBrandHeader` (Task 0), active `appointment_types` from the existing server
  `load()` in `page.tsx` (unchanged query), `meetingModeLabel` (`@/lib/booking/display`).
- Produces: `ScheduleHero` (approved copy: "Schedule Your Financial Consultation" or equivalent,
  Markist Athelus, "Financial Services Agent", meeting format, duration, concise privacy line — no
  fabricated content); `TypeCard` (name, description, duration, meeting-mode indicator, `Link` to
  `/schedule?type=<slug>` — never hardcodes types).

- [ ] **Step 1 — Build `ScheduleHero.tsx`** using tokens only; content strictly from approved
  sources (`BUSINESS`/`CONTACT` from `@/lib/site` for identity/contact, static approved copy). No
  testimonials/awards/claims.
- [ ] **Step 2 — Build `TypeCard.tsx`** as an elevated token-styled card; render only fields the
  backend supplies; keep the `Link href="/schedule?type=<slug>"` navigation (real routing, no
  `useState` nav).
- [ ] **Step 3 — Recompose `page.tsx`**: `PublicPage` → `PublicBrandHeader` → `ScheduleHero` →
  chooser grid of `TypeCard` (or the existing `EmptyState` with a clear next action when no active
  type). Preserve `metadata`, `dynamic`/`runtime`, the `?type=`/`?manage=` branches, and the
  server `load()`.
- [ ] **Step 4 — Verify.** Run: `npm run type-check && npm run lint && npm run build` → exit 0.
- [ ] **Step 5 — Manual smoke** (dev): `/schedule` renders hero + cards; no-active-type path shows
  the empty state; a card click navigates to `?type=<slug>`. Record outcomes in the P1 report.
- [ ] **Step 6 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): premium hero + appointment-type chooser"`

---

### Task 4: Stepper + booking progression scaffold (`BookingFlow.tsx`)

**Files:**
- Create: `src/components/public/booking/BookingStepper.tsx`
- Modify: `src/components/public/booking/BookingFlow.tsx`

**Interfaces:**
- Consumes: `step-model.ts` (`deriveStep`, `completedSteps`, `stepLabel`, `BOOKING_STEPS`).
- Produces: `BookingStepper` props `{ current: BookingStep }` — renders current/completed/upcoming
  indicators, `aria-current="step"` on the active one, accessible names (not color-only).

- [ ] **Step 1 — Build `BookingStepper.tsx`** driven purely by `step-model`; status conveyed by
  text/icon + color (never color alone), keyboard/reader friendly.
- [ ] **Step 2 — Wire it into `BookingFlow.tsx`**: compute `current = deriveStep({...})` from
  existing state (`chosen`, `confirmation`, a new `reviewing` flag added in Task 6); render the
  stepper above the flow. Preserve all existing state, endpoints, and the slot-gone refetch.
- [ ] **Step 3 — Verify.** `npm run type-check && npm run lint && npm test` → green.
- [ ] **Step 4 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): accessible booking stepper wired to step model"`

---

### Task 5: Calendar & time selection redesign (`CalendarMonth` + `BookingFlow`)

**Files:**
- Create: `src/components/public/booking/CalendarMonth.tsx`
- Modify: `src/components/public/booking/BookingFlow.tsx`, `src/lib/booking/display.ts` (append
  presentational helpers only, e.g. slot time-of-day grouping labels)

**Interfaces:**
- Consumes: `month-grid.ts` (`buildMonthMatrix`, `groupSlotsByDay`, `dayState`), the **unchanged**
  `GET /api/public/booking/availability` response (`{type, timezone, slots}`), `COMMON_TIMEZONES` +
  `formatWallTime` from `@/lib/booking/display`.
- Produces: `CalendarMonth` props
  `{ availableDayKeys: Set<string>; todayKey: string; monthCursor: {year:number;month0:number};
     selectedDay: string|null; onSelectDay(key): void; onMonthChange(delta): void }` — a real
  month grid with available/unavailable/selected/past day states + prev/next nav, semantic table or
  grid roles, keyboard navigation.

- [ ] **Step 1 — Build `CalendarMonth.tsx`** from `buildMonthMatrix`; each cell's visual state from
  `dayState`; unavailable/past days disabled + `aria-disabled`; selected day marked
  `aria-pressed`/`aria-current`. Month prev/next buttons with accessible labels.
- [ ] **Step 2 — Integrate into `BookingFlow.tsx`**: derive `availableDayKeys` from
  `groupSlotsByDay(slots, timezone)`; keep the timezone `Select` (detected default + visible
  control), the range fetch, `PickerSkeleton` loading, `PublicAlert` error+retry, and the
  "no openings" empty state. Group the selected day's times (morning/afternoon/evening) using an
  appended pure helper in `display.ts`. **Preserve the slot-taken race handling** (`onSlotGone`).
- [ ] **Step 3 — Verify.** `npm run type-check && npm run lint && npm test && npm run build` → green.
- [ ] **Step 4 — Manual TZ + keyboard check:** switch timezone → slots re-group to correct local
  days (spot-check a DST-sensitive date); tab through the month grid and time buttons; confirm the
  server remains authoritative (selecting a slot still POSTs and can still 409). Record in report.
- [ ] **Step 5 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): month calendar + grouped time selection with full states"`

---

### Task 6: Intake presentation + review step (`DetailsForm`, `ReviewSummary`)

**Files:**
- Create: `src/components/public/booking/ReviewSummary.tsx`
- Modify: `src/components/public/booking/BookingFlow.tsx`

**Interfaces:**
- Consumes: existing `PublicBookingInput` client validation (`config-schemas` — imported, not
  modified), `@/components/forms/Field`, `@/components/ui/*`.
- Produces: refined intake fields (name*, email*, phone, notes) with persistent labels, help text,
  required indicators, inline validation presentation, correct mobile keyboards
  (`type="email"`/`inputMode="tel"`), and the **preserved `company` honeypot** (`sr-only`);
  `ReviewSummary` props `{ typeName; startsAt; timezone; durationMinutes; meetingMode; name; email;
  phone?; onEdit(step): void }` — read-back before submit with edit controls.

- [ ] **Step 1 — Refine `DetailsForm`** inside `BookingFlow.tsx`: field grouping, labels/help,
  required markers, inline errors associated via `aria-describedby`, error summary on submit failure
  with entered data preserved. Keep the honeypot and the existing consent copy (refine layout only —
  meaning unchanged; **no SMS opt-in**). Do NOT add sensitive fields.
- [ ] **Step 2 — Add a `reviewing` state + `ReviewSummary`**: after details validate, show the
  review step (feeds `deriveStep`); "Edit" jumps back to the relevant step; "Confirm" performs the
  existing `POST /api/public/booking`. Add duplicate-submit protection (disable/guard the confirm
  button while the request is in flight).
- [ ] **Step 3 — Verify.** `npm run type-check && npm run lint && npm run build` → green.
- [ ] **Step 4 — Manual:** invalid email → inline error + summary, data preserved; double-click
  Confirm → single submission; honeypot still present. Record in report.
- [ ] **Step 5 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): premium intake + review-before-confirm step"`

---

### Task 7: Confirmation + error/recovery states (`BookingConfirmed`)

**Files:**
- Modify: `src/components/public/booking/BookingFlow.tsx`

**Interfaces:**
- Consumes: the `confirmation` payload from `POST /api/public/booking`, `buildIcs`
  (`@/lib/booking/ics`, unchanged), the signed manage links surfaced by the API/flow.

- [ ] **Step 1 — Redesign `BookingConfirmed`**: success state with reference code, date/time/tz,
  duration, meeting format, next steps, "Add to calendar" (existing client-side `buildIcs`),
  reschedule/cancel affordances, and approved contact info. Only state an email "was sent" if the
  API actually reported it queued/recorded — otherwise use neutral "we'll email you" copy.
- [ ] **Step 2 — Harden error/recovery presentation** for: slot no longer available (409 → toast +
  refetch, already wired — keep), invalid input (400), rate-limit (429), timeout/network, creation
  failure (500), duplicate submission, no available dates, invalid/expired manage token. All use
  safe, plain-language messages with a recovery action; never expose internal errors.
- [ ] **Step 3 — Verify.** `npm run type-check && npm run lint && npm run build` → green.
- [ ] **Step 4 — Manual:** complete a booking end-to-end in dev (or against a seeded local slot);
  add-to-calendar downloads a valid `.ics`; force a 409 (book same slot twice) and confirm graceful
  recovery. Record in report.
- [ ] **Step 5 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): premium confirmation + hardened error/recovery states"`

---

### Task 8: `ManageFlow` premium redesign

**Files:**
- Modify: `src/components/public/booking/ManageFlow.tsx`

**Interfaces:**
- Consumes: the unchanged manage GET/POST contract and `CalendarMonth` (Task 5) for the reschedule
  picker.

- [ ] **Step 1 — Apply the shell + brand header + tokens** to `ManageFlow`; reuse `CalendarMonth`
  for the reschedule picker (21-day window preserved); keep single-purpose-per-token behavior and
  the not-scheduled guards.
- [ ] **Step 2 — Full states:** loading skeleton, invalid/expired-token error (plain language +
  "request a new link"/back-to-site), empty availability, success. Cancel keeps the optional reason
  + destructive-action confirmation.
- [ ] **Step 3 — Verify.** `npm run type-check && npm run lint && npm run build` → green.
- [ ] **Step 4 — Manual:** with a valid signed token, reschedule and cancel paths render + submit;
  an invalid token shows the safe error. Record in report.
- [ ] **Step 5 — Commit.**
  `git add -A && git commit -m "feat(booking-ui): premium manage (reschedule/cancel) experience"`

---

### Task 9: Responsive + accessibility pass, impeccable review, P1 report

**Files:** touch-ups across the P1 files as the review surfaces issues; `DESIGN.md` for any pattern
added; `docs/booking/P1-report.md` (new).

- [ ] **Step 1 — Responsive manual sweep** (§7.14): large desktop, laptop, tablet portrait/landscape,
  mobile, narrow mobile, 200% zoom, long text, empty/error states. No horizontal body scroll; wide
  content scrolls in its own container. Fix issues inline.
- [ ] **Step 2 — Accessibility manual sweep** (§7.13): full keyboard booking, logical focus order,
  visible focus, heading hierarchy, labels, error association, button names, calendar semantics,
  status not color-only, touch targets, reduced-motion. Fix issues inline. **State explicitly that
  no automated a11y harness exists — these are manual checks** (P0 §5).
- [ ] **Step 3 — `impeccable` review** against the `frontend-design` standard for every changed
  surface (hero, chooser, stepper, calendar, intake, review, confirmation, manage). Address findings.
- [ ] **Step 4 — Full gate.** Run: `npm run type-check && npm run lint && npm test && npm run build`
  — all green. Capture exact outputs.
- [ ] **Step 5 — Write `docs/booking/P1-report.md`** per program §7.16 / §14: reused backend, files
  added/changed, no API change, defects (none unless human-approved), verification (separating
  automated vs manual vs not-possible-without-harness), impeccable outcome, screenshots where dev
  tooling allows (note if not), limitations, and explicit confirmation that **no scheduling engine
  was rebuilt and no component was forked.** Verdict.
- [ ] **Step 6 — Commit.**
  `git add -A && git commit -m "docs(booking): P1 responsive+a11y pass, impeccable review, phase report"`

---

## Self-Review

- **Spec coverage:** hero (T3), progression/stepper (T1/T4), type selection (T3), new-vs-existing
  client distinction — handled by the existing API (public page never reveals account existence; no
  UI change needed beyond keeping identical error responses), calendar/time (T2/T5), intake (T6),
  review (T6), confirmation (T7), errors/recovery (T7), manage (T8), a11y+responsive+impeccable+report
  (T9). Consent-unchanged and no-SMS enforced by Global Constraints.
- **Placeholder scan:** pure-logic tasks carry real test code; UI tasks carry concrete component
  contracts + manual verification (justified — no browser/a11y harness exists, P0 §5).
- **Type consistency:** `BookingStep` union and `step-model` signatures are used identically in
  T1/T4; `CalendarMonth` prop names are stable across T5/T8; `month-grid` return types match their
  consumers.
- **Boundary:** no task touches a P0 §7.2 file; wire contracts and the honeypot are preserved.

## Execution Handoff

Plan saved to `docs/booking/P1-plan.md`. Recommended: **subagent-driven execution** (fresh subagent
per task + two-stage review), gated by `frontend-design` / `impeccable`. Execution begins only after
the human reviews this plan and the P0 evidence report; **push / PR / merge remain withheld** pending
explicit authorization (operating mode).
