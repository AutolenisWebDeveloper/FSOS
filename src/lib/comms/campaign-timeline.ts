// Pure geometry for the campaign timeline ribbon — the signature element shared by the
// three native campaign engines (Life Conversion, Cross-Sell Life, Pipeline Win-Back).
//
// None of the three screens showed a campaign's SHAPE: when its touches land across the
// timeline, where the cadence accelerates, and where the live enrollments currently sit.
// Phase distribution was three number-cards; the schedule was a table of rows. This module
// turns the schedule + the phase distribution into positions a ribbon can render.
//
// Everything here is PURE — no React, no DB, no tokens, no env. It converts days to
// percentages and nothing else, so the layout math is unit-tested (tests/comms-campaign-
// timeline.test.mjs) rather than eyeballed in a browser. The component
// (components/comms/campaign/CampaignTimelineRibbon.tsx) is a thin skin over this output.

/** A scheduled touch, reduced to what the ribbon needs to place and color it. */
export interface TimelineTouch {
  touch_no: number
  day_offset: number
  /** email | sms | ai_conversation | advisor_outreach (or an unrecognized kind). */
  kind: string
}

/**
 * One phase of a campaign's timeline, as the page already knows it (Life Conversion and
 * Pipeline Win-Back divide their run into early / mid / accelerated; Cross-Sell Life does
 * not, and simply omits phases). `fromDay` is the phase's inclusive start; the band runs to
 * the next phase's start, or to the end of the campaign for the last phase.
 */
export interface TimelinePhaseInput {
  key: string
  label: string
  fromDay: number
  /** Active enrollments currently sitting in this phase. */
  activeCount: number
}

export interface TimelineMark {
  touch_no: number
  day: number
  kind: string
  /** Horizontal position across the track, 0–100. */
  leftPct: number
}

export interface TimelineBand {
  key: string
  label: string
  fromDay: number
  toDay: number
  leftPct: number
  widthPct: number
  activeCount: number
  /** activeCount as a fraction of all active enrollments (0–1) — the band's share label. */
  share: number
  /** activeCount relative to the busiest band (0–1) — drives the fill height. */
  intensity: number
}

export interface ChannelCount {
  key: string
  count: number
}

export interface TimelineLayout {
  days: number
  totalTouches: number
  marks: TimelineMark[]
  bands: TimelineBand[]
  /** Day numbers to label on the axis: 0, each band boundary, and the final day. */
  axisDays: number[]
  totalActive: number
  /** Channels present on the schedule, in a stable order, for the legend. */
  channelCounts: ChannelCount[]
  acceleratesFromDay: number | null
  accelLeftPct: number | null
}

/** Clamp to the 0–100 the ribbon positions everything with; +∞→100, −∞→0, NaN→0. */
export function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/** A day offset as a percentage across a `days`-long track. A zero-length track is all 0%. */
export function dayToPct(day: number, days: number): number {
  if (days <= 0) return 0
  return clampPct((day / days) * 100)
}

// Stable legend/marker order. Unknown kinds are appended after these in first-seen order, so
// a new channel still renders rather than being silently dropped.
const CHANNEL_ORDER = ['email', 'sms', 'ai_conversation', 'advisor_outreach']

export function layoutTimeline(
  touches: readonly TimelineTouch[],
  opts: { days: number; phases?: readonly TimelinePhaseInput[]; acceleratesFromDay?: number | null },
): TimelineLayout {
  const days = opts.days > 0 ? opts.days : 0

  const marks: TimelineMark[] = touches
    .slice()
    .sort((a, b) => a.day_offset - b.day_offset || a.touch_no - b.touch_no)
    .map((t) => ({ touch_no: t.touch_no, day: t.day_offset, kind: t.kind, leftPct: dayToPct(t.day_offset, days) }))

  // Channel tally, known channels first (stable), then any unrecognized kinds in first-seen order.
  const counts = new Map<string, number>()
  for (const t of touches) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1)
  const ordered = [...CHANNEL_ORDER.filter((k) => counts.has(k)), ...[...counts.keys()].filter((k) => !CHANNEL_ORDER.includes(k))]
  const channelCounts: ChannelCount[] = ordered.map((key) => ({ key, count: counts.get(key)! }))

  // Phase bands. Each band runs from its own start to the next band's start (or to `days`).
  let bands: TimelineBand[] = []
  let totalActive = 0
  if (opts.phases && opts.phases.length > 0) {
    const sorted = opts.phases.slice().sort((a, b) => a.fromDay - b.fromDay)
    const safeCount = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)
    totalActive = sorted.reduce((sum, p) => sum + safeCount(p.activeCount), 0)
    const maxCount = sorted.reduce((max, p) => Math.max(max, safeCount(p.activeCount)), 0)
    bands = sorted.map((p, i) => {
      // Clamp both boundaries into the run. A phase configured outside 0..days (a mis-set
      // threshold, or an engine whose phases were authored against a different length) must
      // still yield coherent geometry: the last band used to take `days` unconditionally, so
      // a phase starting past the end produced toDay < fromDay, and a band whose successor
      // started past the end ran off the track. Both now hold 0 <= fromDay <= toDay <= days.
      const from = Math.min(Math.max(0, p.fromDay), days)
      const rawTo = i < sorted.length - 1 ? sorted[i + 1].fromDay : days
      const to = Math.max(from, Math.min(rawTo, days))
      const leftPct = dayToPct(from, days)
      const widthPct = clampPct(dayToPct(to, days) - leftPct)
      const activeCount = safeCount(p.activeCount)
      return {
        key: p.key,
        label: p.label,
        fromDay: from,
        toDay: to,
        leftPct,
        widthPct,
        activeCount,
        share: totalActive > 0 ? activeCount / totalActive : 0,
        intensity: maxCount > 0 ? activeCount / maxCount : 0,
      }
    })
  }

  // Axis labels: the ends and every band boundary, deduped and ordered.
  const axisSet = new Set<number>([0, days])
  for (const b of bands) axisSet.add(b.fromDay)
  const axisDays = [...axisSet].filter((d) => d >= 0 && d <= days).sort((a, b) => a - b)

  const acceleratesFromDay = opts.acceleratesFromDay ?? null
  const accelLeftPct = acceleratesFromDay != null ? dayToPct(acceleratesFromDay, days) : null

  return {
    days,
    totalTouches: touches.length,
    marks,
    bands,
    axisDays,
    totalActive,
    channelCounts,
    acceleratesFromDay,
    accelLeftPct,
  }
}
