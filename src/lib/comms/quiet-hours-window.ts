// src/lib/comms/quiet-hours-window.ts
// Configurable quiet hours — the PURE window algebra (no DB, no clock, no env), so it is
// unit-testable offline (tests/quiet-hours-window.test.mjs).
//
// THE MODEL. A send's permitted time is the INTERSECTION of up to three windows:
//
//     effective = statutory floor  ∩  campaign config  ∩  worker config
//
// Config NARROWS, never widens. That is enforced structurally by intersection, not by a
// validation rule that could be forgotten: the intersection of any window with the floor
// can only ever be a subset of the floor. There is no code path by which a campaign or
// worker row grants a send a time the floor forbids.
//
// TWO KINDS OF "OUT OF WINDOW", and they are NOT the same outcome:
//
//   • Outside the STATUTORY FLOOR → an escalating compliance block (`quiet_hours`).
//     This is the TCPA control. It suppresses the send and raises it to the FSA.
//   • Inside the floor but outside a CONFIGURED narrowing → a non-escalating DEFERRAL
//     (`configured_window`). The operator asked for a tighter window; missing it is an
//     operational hold, not a compliance violation. The send waits for the next opening.
//
// That split matters most for the purposes with NO statutory floor (POLICY_DEADLINE,
// APPOINTMENT, and all email — see purpose.ts quietHoursApply). Those MAY carry a
// configured window, and out-of-window on them DEFERS. It must never suppress: a
// term-conversion deadline notice held by an operator preference is a delayed message,
// not a blocked one. Default is NO configured window, so behavior is unchanged until an
// operator configures one.

/** A recurring daily window in the evaluation zone. `endHour` is EXCLUSIVE. */
export interface HoursWindow {
  /** Inclusive start hour, 0–23. */
  startHour: number
  /** Exclusive end hour, 1–24. */
  endHour: number
  /** Permitted days of week: 0=Sun … 6=Sat. */
  days: readonly number[]
}

/** Which layer a window came from — recorded so a block can name what actually stopped it. */
export type WindowScope = 'floor' | 'campaign' | 'worker'

export interface ScopedWindow {
  scope: WindowScope
  window: HoursWindow
}

/**
 * The statutory TCPA floor: 9:00–20:00 recipient-local, every day. Mirrors
 * `compliance/guardrail.withinQuietHours` (9 ≤ h < 20), which stays the canonical
 * predicate for the un-configured path. Expressed as a window here so it can take part
 * in the intersection.
 */
export const STATUTORY_FLOOR: HoursWindow = {
  startHour: 9,
  endHour: 20,
  days: [0, 1, 2, 3, 4, 5, 6],
}

const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6]

/** True when the window can never permit a send (empty hour span or no permitted day). */
export function isEmptyWindow(w: HoursWindow | null): boolean {
  return !w || w.startHour >= w.endHour || w.days.length === 0
}

/**
 * Intersect any number of windows. The result is a subset of EVERY input, so adding a
 * window can only narrow. Returns null when the inputs have no overlap at all (an empty
 * window), which callers must treat as "no permissible time" — never as "unrestricted".
 *
 * An empty input list returns null as well; callers distinguish "no windows configured"
 * (unrestricted — do not call this) from "windows that do not overlap" before calling.
 */
export function intersectWindows(windows: readonly HoursWindow[]): HoursWindow | null {
  if (windows.length === 0) return null
  let start = 0
  let end = 24
  let days: readonly number[] = ALL_DAYS
  for (const w of windows) {
    start = Math.max(start, w.startHour)
    end = Math.min(end, w.endHour)
    const allowed = new Set(w.days)
    days = days.filter((d) => allowed.has(d))
  }
  const result: HoursWindow = { startHour: start, endHour: end, days: [...days] }
  return isEmptyWindow(result) ? null : result
}

/** True when `localHour` on `localDay` falls inside the window. */
export function withinWindow(localHour: number, localDay: number, w: HoursWindow): boolean {
  if (!w.days.includes(localDay)) return false
  return localHour >= w.startHour && localHour < w.endHour
}

/**
 * Hours until the window next opens, from `localHour` on `localDay`. 0 when already open.
 * Pure integer-hour arithmetic in the evaluation zone; the caller converts to an instant.
 * Returns null when the window can never open (empty).
 *
 * This is what makes a configured-window miss a DEFERRAL rather than a drop: the send is
 * held to a specific, computable next opening instead of being silently dropped or retried
 * blindly every tick.
 */
export function hoursUntilWindowOpens(localHour: number, localDay: number, w: HoursWindow): number | null {
  if (isEmptyWindow(w)) return null
  if (withinWindow(localHour, localDay, w)) return 0
  // Walk forward hour by hour over one full week (168h). Bounded and exact; a closed-form
  // version would have to special-case day gaps and is not worth the subtlety here.
  for (let delta = 1; delta <= 168; delta++) {
    const h = (localHour + delta) % 24
    const dayAdvance = Math.floor((localHour + delta) / 24)
    const d = (localDay + dayAdvance) % 7
    if (withinWindow(h, d, w)) return delta
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// The composed decision
// ─────────────────────────────────────────────────────────────────────────────

export interface QuietHoursInput {
  /** Recipient-local hour, 0–23, in the RESOLVED recipient zone. */
  localHour: number
  /** Recipient-local day of week, 0=Sun … 6=Sat, in the RESOLVED recipient zone. */
  localDay: number
  /**
   * Whether the STATUTORY floor applies to this send (purpose.ts quietHoursApply):
   * SMS with a marketing-class or unclassified purpose. Email and transactional/servicing
   * SMS are exempt from the FLOOR — but not from a configured window.
   */
  floorApplies: boolean
  /** Operator's campaign-scoped window, when one is configured and enabled. */
  campaignWindow?: HoursWindow | null
  /** Operator's worker(agent)-scoped window, when one is configured and enabled. */
  workerWindow?: HoursWindow | null
}

export type QuietHoursOutcome =
  /** Inside every applicable window (or none applies). */
  | 'allowed'
  /** Outside the statutory floor — escalating compliance block. */
  | 'outside_floor'
  /** Inside the floor but outside a configured narrowing — non-escalating deferral. */
  | 'outside_configured_window'
  /** The configured windows do not overlap the floor at all — misconfiguration, deferral. */
  | 'window_unsatisfiable'

export interface QuietHoursDecision {
  outcome: QuietHoursOutcome
  allowed: boolean
  /**
   * True only for `outside_floor`. A configured-window miss is an operational hold, so it
   * does NOT escalate and does NOT record a compliance event — matching how the existing
   * `business_hours` deferral behaves.
   */
  escalate: boolean
  /** Which layer stopped it, for the audit + the operator-facing reason. */
  blockedBy?: WindowScope | 'intersection'
  /** The effective window actually applied, when any did. */
  effective?: HoursWindow
  /** Hours until the effective window next opens — the deferral target. Null when never. */
  hoursUntilOpen?: number | null
  reason?: string
}

/**
 * Evaluate quiet hours for one send.
 *
 * Order is deliberate: the STATUTORY floor is checked first and on its own, so a send
 * outside the legal window always surfaces as the escalating compliance block and is never
 * masked as a benign configured-window deferral. Only then is the narrowed intersection
 * applied. This mirrors gate.ts, which checks the legal floor early and the operational
 * deferrals last for exactly the same reason.
 */
export function evaluateQuietHours(input: QuietHoursInput): QuietHoursDecision {
  const { localHour, localDay, floorApplies } = input

  // ── 1. The statutory floor, alone. Escalating when missed. ──
  if (floorApplies && !withinWindow(localHour, localDay, STATUTORY_FLOOR)) {
    return {
      outcome: 'outside_floor',
      allowed: false,
      escalate: true,
      blockedBy: 'floor',
      effective: STATUTORY_FLOOR,
      hoursUntilOpen: hoursUntilWindowOpens(localHour, localDay, STATUTORY_FLOOR),
      reason: 'Outside permitted quiet hours (9:00–20:00 recipient-local).',
    }
  }

  // ── 2. Configured narrowing. Deferral when missed. ──
  const configured: ScopedWindow[] = []
  if (input.campaignWindow) configured.push({ scope: 'campaign', window: input.campaignWindow })
  if (input.workerWindow) configured.push({ scope: 'worker', window: input.workerWindow })

  // No configured window → unchanged behavior (the floor above was the whole decision).
  if (configured.length === 0) return { outcome: 'allowed', allowed: true, escalate: false }

  const layers = [
    ...(floorApplies ? [STATUTORY_FLOOR] : []),
    ...configured.map((c) => c.window),
  ]
  const effective = intersectWindows(layers)

  if (!effective) {
    // The operator configured windows that cannot overlap (each other, or the floor).
    // Fail closed — hold the send — but do NOT escalate as a compliance event: this is a
    // configuration error for the operator to fix, not a violation by the send.
    return {
      outcome: 'window_unsatisfiable',
      allowed: false,
      escalate: false,
      blockedBy: 'intersection',
      hoursUntilOpen: null,
      reason: 'Configured send window does not overlap the permitted hours — held; check the hours policy.',
    }
  }

  if (withinWindow(localHour, localDay, effective)) {
    return { outcome: 'allowed', allowed: true, escalate: false, effective }
  }

  // Name the narrowest layer that actually excluded this moment, so the operator sees
  // which row to edit rather than a generic "outside window".
  const culprit = configured.find((c) => !withinWindow(localHour, localDay, c.window))
  return {
    outcome: 'outside_configured_window',
    allowed: false,
    escalate: false,
    blockedBy: culprit?.scope ?? 'intersection',
    effective,
    hoursUntilOpen: hoursUntilWindowOpens(localHour, localDay, effective),
    reason: `Outside the configured ${culprit?.scope ?? 'send'} window (${effective.startHour}:00–${effective.endHour}:00 recipient-local) — deferred to the next opening.`,
  }
}
