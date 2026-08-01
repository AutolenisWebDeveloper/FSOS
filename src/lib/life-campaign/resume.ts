// src/lib/life-campaign/resume.ts
// The campaign resume decision, PURE (no DB/clock/schedule). This is the correctness core for the
// "no automatic catch-up" contract (Life §4b / Win-Back §5a): when an admin-paused enrollment
// resumes, touches that came due DURING the pause must be recorded Skipped and the cadence
// fast-forwarded to the next FUTURE touch — never fired late, one-per-tick, as a delayed burst.
//
// It is SCHEDULE-AGNOSTIC: the caller passes the enrollment's already-dated timeline (`plan`), so
// the SAME core serves both the Life Conversion (20-touch) and Pipeline Win-Back (28-touch) engines
// — the reuse Win-Back's engine.ts facade already establishes for the state machine (ADR-031 shared
// campaign-engine primitives). controls.ts wraps it with the DB reads/writes.
import { computeTouchPlan } from './schedule'

// Resume strategy vocabulary (Life §4b / Win-Back §5a). Shared by both engines.
export type ResumeBehavior = 'all_active' | 'only_admin_paused' | 'restart_day_1' | 'only_new'
export type ReplayPolicy = 'skip' | 'replay'

/** The daily send instant appended to a due date (matches the tick's 13:00Z touch scheduling). */
const SEND_TIME = 'T13:00:00.000Z'

/** One dated touch on an enrollment's timeline — the shape both campaigns' computeTouchPlan emits. */
export interface PlanTouch {
  touch_no: number
  kind: string
  /** ISO date (YYYY-MM-DD) this touch is due. */
  dueDate: string
}

export interface ResumePlanInput {
  /** The enrollment's dated timeline (from the campaign's own computeTouchPlan(baseline)). */
  plan: PlanTouch[]
  /** Cursor — the last touch that fired for this enrollment (0 = nothing sent yet). */
  currentTouchNo: number
  /** Evaluation date, ISO date (nowISO.slice(0,10)). */
  today: string
  /** skip (default, no catch-up): past-due touches are recorded Skipped and the cadence jumps to
   *  the next future touch. replay: resume at the next pending touch and let it fire immediately. */
  replay: ReplayPolicy
}

export interface ResumePlan {
  /** Touch numbers to persist as status='skipped' (skip policy only — empty under replay). */
  skippedTouchNos: number[]
  /** The cursor to write back after skipping the past-due touches. */
  newCursor: number
  /** ISO timestamp of the next touch to fire, or null when the timeline is exhausted. */
  nextTouchAt: string | null
  /** No remaining touch — the enrollment should complete instead of returning to active. */
  complete: boolean
}

/**
 * Decide how a single admin-paused enrollment resumes WITHOUT catch-up.
 *
 * skip (default): walk the plan forward from the cursor; every touch whose due date is strictly
 * before `today` is recorded Skipped and the cursor advances past it; the first touch due today or
 * later becomes next_touch_at. If none remain in the future, the enrollment completes.
 *
 * replay (opt-in): do not skip — set next_touch_at to today so the next pending touch fires on the
 * next tick; subsequent touches then advance normally (the deliberate, non-default catch-up mode).
 */
export function planResume(input: ResumePlanInput): ResumePlan {
  const future = input.plan.filter((p) => p.touch_no > input.currentTouchNo)

  if (input.replay === 'replay') {
    const next = future[0] ?? null
    return {
      skippedTouchNos: [],
      newCursor: input.currentTouchNo,
      nextTouchAt: next ? `${input.today}${SEND_TIME}` : null,
      complete: next == null,
    }
  }

  // skip policy
  const skipped: number[] = []
  let cursor = input.currentTouchNo
  for (const p of future) {
    if (p.dueDate < input.today) {
      skipped.push(p.touch_no)
      cursor = p.touch_no
    } else {
      return { skippedTouchNos: skipped, newCursor: cursor, nextTouchAt: `${p.dueDate}${SEND_TIME}`, complete: false }
    }
  }
  // Nothing due today or later remained.
  return { skippedTouchNos: skipped, newCursor: cursor, nextTouchAt: null, complete: true }
}

/** The channel/kind for a touch number within a plan — used to stamp the skipped execution row. */
export function kindForTouch(plan: PlanTouch[], touchNo: number): string | null {
  return plan.find((p) => p.touch_no === touchNo)?.kind ?? null
}

// Re-export the Life schedule builder so life-campaign callers keep a single import site. Win-Back
// passes its OWN computeTouchPlan result into planResume (different cadence, same algorithm).
export { computeTouchPlan }
