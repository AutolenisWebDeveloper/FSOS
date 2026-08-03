// src/lib/appointments/list.ts
// PURE read-model helpers for the internal appointment command center (P2). DB-free and
// clock-injected so the command-center buckets are unit-provable in isolation — the server
// component does the DB reads and passes rows + a precomputed window here. Reuses the lifecycle
// core (recovery.ts) rather than re-deriving overdue/no-show, so there is ONE definition.

import { isOverdue, needsRecovery, type Appointment } from './recovery'

/** A command-center row: the lifecycle core's columns plus the native start instant. */
export interface CommandRow extends Appointment {
  /** Native booking start (UTC). Native rows keep scheduled_at = starts_at; legacy rows may
   *  have only scheduled_at, so the effective start falls back to it. */
  starts_at: string | null
}

/** Effective start (ms) — the native `starts_at`, else the legacy `scheduled_at`, else null. */
export function apptStartMs(a: { starts_at: string | null; scheduled_at: string | null }): number | null {
  const iso = a.starts_at ?? a.scheduled_at
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Local YYYY-MM-DD for an instant in a given IANA zone (the FSA's business zone). */
export function localDateKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  )
}

/** The window + side-tables the summary needs — all precomputed by the caller (keeps this pure). */
export interface CommandContext {
  nowMs: number
  /** The FSA's business timezone (config default), for the "today" bucket. */
  tz: string
  /** Today's local date key (YYYY-MM-DD in `tz`) — passed in so the function stays clock-free. */
  todayKey: string
  /** Upper bound (ms) of the "upcoming" window, e.g. now + 7 days. */
  weekEndMs: number
  /** Appointment ids that carry an OPEN follow-up task (work_tasks, entity=appointment). */
  openFollowupApptIds: Set<string>
  /** Appointment ids that already have a logged note (activities, kind='appointment_note'). */
  notedApptIds: Set<string>
}

export interface CommandSummary {
  /** Scheduled appointments whose start falls on today (FSA-local). */
  today: number
  /** Scheduled appointments starting after today, within the upcoming window. */
  upcoming: number
  /** Scheduled but past — needs a held/no-show decision. */
  overdue: number
  /** No-shows (missed, awaiting recovery). */
  noShow: number
  /** Appointments with an open follow-up task. */
  followUpsDue: number
  /** Completed appointments with no note logged yet. */
  missingNotes: number
}

/**
 * Bucket the book into the command-center KPIs. Every count is derived, honest, and clock-free
 * (the caller supplies `nowMs`/`todayKey`/`weekEndMs`). `today` and `upcoming` are mutually
 * exclusive; `overdue`/`noShow` reuse the lifecycle core so they can never drift from the triage
 * tables that use the same predicates.
 */
export function summarizeCommandCenter(rows: CommandRow[], ctx: CommandContext): CommandSummary {
  const now = new Date(ctx.nowMs)
  let today = 0
  let upcoming = 0
  let overdue = 0
  let noShow = 0
  let followUpsDue = 0
  let missingNotes = 0

  for (const a of rows) {
    if (isOverdue(a, now)) overdue += 1
    if (needsRecovery(a)) noShow += 1
    if (ctx.openFollowupApptIds.has(a.id)) followUpsDue += 1
    if (a.status === 'completed' && !ctx.notedApptIds.has(a.id)) missingNotes += 1

    if (a.status === 'scheduled') {
      const startMs = apptStartMs(a)
      if (startMs !== null) {
        if (localDateKey(startMs, ctx.tz) === ctx.todayKey) today += 1
        else if (startMs > ctx.nowMs && startMs <= ctx.weekEndMs) upcoming += 1
      }
    }
  }

  return { today, upcoming, overdue, noShow, followUpsDue, missingNotes }
}
