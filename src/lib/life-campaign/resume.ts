// src/lib/life-campaign/resume.ts
// The Life Conversion Campaign's resume decision, PURE (no DB/clock). This is the correctness
// core for §4b "no automatic catch-up": when an admin-paused enrollment resumes, touches that came
// due DURING the pause must be recorded as Skipped and the cadence fast-forwarded to the next
// FUTURE touch — never fired late, one-per-tick, as a delayed burst. The tick's per-day advance is
// not a substitute for this: it would still deliver every missed touch, just spread out.
//
// Kept pure (mirrors states.ts/schedule.ts) so the skip/replay/fast-forward behavior is provable
// offline (tests/life-campaign-resume.test.mjs); controls.ts wraps it with the DB reads/writes.
import { computeTouchPlan, TOUCH_SCHEDULE } from './schedule'

// Resume strategy vocabulary (§4b). Life owns its own copy (bounded context) even though the
// string values match the reference Cross-Sell engine.
export type ResumeBehavior = 'all_active' | 'only_admin_paused' | 'restart_day_1' | 'only_new'
export type ReplayPolicy = 'skip' | 'replay'

/** The daily send instant appended to a due date (matches the tick's 13:00Z touch scheduling). */
const SEND_TIME = 'T13:00:00.000Z'

export interface ResumePlanInput {
  /** Enrollment baseline (Day 1), ISO date. */
  baselineDate: string
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
  const plan = computeTouchPlan(input.baselineDate)
  const future = plan.filter((p) => p.touch_no > input.currentTouchNo)

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

/** The channel/kind for a given touch number, from the frozen schedule — used to stamp the
 *  skipped execution row so analytics can tell which channel was skipped. */
export function touchKind(touchNo: number): string | null {
  return TOUCH_SCHEDULE.find((t) => t.touch_no === touchNo)?.kind ?? null
}

/** Total touches in the frozen cadence (20). Exposed so the wiring can detect completion. */
export const TOTAL_TOUCHES = TOUCH_SCHEDULE.length
