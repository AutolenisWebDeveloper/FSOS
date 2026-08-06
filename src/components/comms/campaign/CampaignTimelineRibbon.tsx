import * as React from 'react'
import { Section, EmptyState } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { touchKind, type CampaignEngine } from '@/lib/comms/campaign-presentation'
import { layoutTimeline, type TimelineTouch, type TimelinePhaseInput } from '@/lib/comms/campaign-timeline'

/*
 * The campaign timeline ribbon — the signature element the three campaign screens are built
 * around. Before it, none of the three showed a campaign's SHAPE: when its touches land, where
 * the cadence accelerates, and where the live enrollments actually sit. Phase distribution was
 * three number-cards; the schedule was a table of rows. This draws the campaign as one object.
 *
 * Two rows share one horizontal day scale:
 *   • Cadence      — every scheduled touch, placed by day and colored by channel (the
 *                    categorical chart ramp, §15 — a data-series hue, never a compliance status).
 *   • Active book  — where the live enrollments sit across the phases. This is the ONE bold
 *                    element on the ribbon: a brand-blue fill per phase, sized by its share of
 *                    the active book. Everything else stays quiet so this reads at a glance.
 *
 * Cross-Sell Life has no phases, so it renders the cadence row alone — honest about what it
 * measures rather than faking a distribution.
 *
 * Server-Component-safe: no hooks, no handlers, no motion. All geometry comes from the pure,
 * unit-tested layoutTimeline(); this file only skins it. The authoritative, fully accessible
 * per-touch detail lives in the Schedule table below — the ribbon is the overview, not the record.
 */

// Channel → categorical chart hue (design-system.md §15). Brand blue (chart-1) is deliberately
// NOT used here — it is reserved for the active-book fill, so the two never read as the same thing.
const CHANNEL_FILL: Record<string, string> = {
  email: 'bg-chart-2', // cyan
  sms: 'bg-chart-4', // violet
  ai_conversation: 'bg-chart-3', // emerald
  advisor_outreach: 'bg-chart-8', // slate — the human touch reads as neutral, not a colored send
}
function channelFill(kind: string): string {
  return CHANNEL_FILL[kind] ?? 'bg-chart-8'
}

export function CampaignTimelineRibbon({
  engine,
  touches,
  phases,
  acceleratesFromDay,
}: {
  engine: CampaignEngine
  touches: TimelineTouch[]
  /** Life Conversion + Pipeline Win-Back only. Cross-Sell Life omits it and shows cadence alone. */
  phases?: TimelinePhaseInput[]
  /** Day the cadence tightens — drawn as a marker so acceleration is visible, not just tabulated. */
  acceleratesFromDay?: number | null
}) {
  const layout = layoutTimeline(touches, { days: engine.days, phases, acceleratesFromDay })
  const hasBands = layout.bands.length > 0

  const description = `Where this campaign's ${engine.touches} touches land across ${engine.days} days${
    hasBands ? ', and where the active enrollments currently sit' : ''
  }. The schedule below is the authoritative per-touch record.`

  if (layout.totalTouches === 0) {
    return (
      <Section title="Campaign timeline" description={description}>
        <EmptyState
          title="No schedule yet"
          description={`Run migration ${engine.seedMigration} to seed the ${engine.title} timeline.`}
        />
      </Section>
    )
  }

  // A plain-language summary so the ribbon is not information-only-in-color for a screen reader.
  const bookSummary = hasBands
    ? layout.totalActive > 0
      ? ` Active enrollments: ${layout.bands.map((b) => `${b.label.toLowerCase()} ${b.activeCount} (${Math.round(b.share * 100)}%)`).join(', ')}.`
      : ' No active enrollments yet.'
    : ''

  return (
    <Section title="Campaign timeline" description={description}>
      <Card className="p-5">
        <p className="sr-only">
          {`${engine.title}: ${layout.totalTouches} touches over ${engine.days} days.${bookSummary}`}
        </p>

        {/* ── Legend ─────────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {layout.channelCounts.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn('h-2 w-2 rounded-full', channelFill(c.key))} />
              {touchKind(c.key).label}
              <span className="numeric text-muted-foreground/70">{c.count}</span>
            </span>
          ))}
          {hasBands ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-sm bg-primary" />
              Active enrollments
            </span>
          ) : null}
        </div>

        {/* ── The ribbon ─────────────────────────────────────────────────── */}
        <div aria-hidden className="select-none">
          {/* Row 1 — cadence: every touch, placed by day, colored by channel. */}
          <div className="relative h-11 overflow-hidden rounded-lg border bg-sunken">
            {/* Phase band tints — alternating so the boundaries read without shouting. */}
            {layout.bands.map((b, i) => (
              <div
                key={b.key}
                className={cn(
                  'absolute inset-y-0 border-r border-border/60 last:border-r-0',
                  i % 2 === 1 && 'bg-muted/40',
                )}
                style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
              />
            ))}
            {/* Acceleration marker — where the cadence tightens. Neutral, not the attention token:
                a faster cadence is a schedule fact, not something wrong. */}
            {layout.accelLeftPct != null && layout.accelLeftPct > 0 && layout.accelLeftPct < 100 ? (
              <div
                title={`Cadence accelerates from day ${layout.acceleratesFromDay}`}
                className="absolute inset-y-0 border-l border-dashed border-muted-foreground/50"
                style={{ left: `${layout.accelLeftPct}%` }}
              />
            ) : null}
            {/* Touch ticks. */}
            {layout.marks.map((m) => (
              <div
                key={m.touch_no}
                title={`Touch #${m.touch_no} · Day ${m.day} · ${touchKind(m.kind).label}`}
                className={cn('absolute top-2 bottom-2 w-[3px] -translate-x-1/2 rounded-full', channelFill(m.kind))}
                style={{ left: `${m.leftPct}%` }}
              />
            ))}
          </div>

          {/* Row 2 — active book: where the live enrollments sit, per phase. The bold element.
              The label strip carries the exact figures; the bar below is the shape, so the two
              never overlap and a full-height bar can rise to the top freely. */}
          {hasBands ? (
            <div className="mt-2">
              {/* Label strip — its own height, so a full-height bar can never reach the text. */}
              <div className="relative mb-1.5 h-5">
                {layout.bands.map((b) => (
                  <div
                    key={b.key}
                    className="absolute inset-y-0 flex items-baseline justify-between gap-1 px-1"
                    style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                  >
                    <span className="truncate text-[0.6875rem] font-medium text-muted-foreground">{b.label}</span>
                    <span className="numeric shrink-0 text-[0.6875rem] text-muted-foreground/70">
                      {b.activeCount}
                      {layout.totalActive > 0 ? ` · ${Math.round(b.share * 100)}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
              {/* Bar strip — the bars share one baseline, so their heights compare directly. */}
              <div className="relative h-16">
                {layout.bands.map((b) => (
                  <div
                    key={b.key}
                    className="absolute inset-y-0 flex flex-col justify-end px-1"
                    style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                  >
                    <div
                      className={cn('rounded-t-md', b.activeCount > 0 ? 'bg-primary/85' : 'bg-muted/40')}
                      style={{ height: `${b.activeCount > 0 ? Math.max(10, Math.round(b.intensity * 100)) : 4}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Axis — the ends and each phase boundary. */}
          <div className="relative mt-1.5 h-4">
            {layout.axisDays.map((d, i) => {
              const isFirst = i === 0
              const isLast = i === layout.axisDays.length - 1
              return (
                <span
                  key={d}
                  className={cn(
                    'numeric absolute top-0 text-[0.6875rem] text-muted-foreground',
                    !isFirst && !isLast && '-translate-x-1/2',
                    isLast && '-translate-x-full',
                  )}
                  style={{ left: `${dayLabelLeft(d, engine.days)}%` }}
                >
                  {d === 0 ? 'Day 0' : d}
                </span>
              )
            })}
          </div>
        </div>

        {hasBands && layout.totalActive === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No active enrollments yet — the phase bands fill in as this campaign enrolls contacts.
          </p>
        ) : null}
      </Card>
    </Section>
  )
}

// The last label is right-anchored and the first left-anchored, so neither clips the track edge.
function dayLabelLeft(day: number, days: number): number {
  if (days <= 0) return 0
  return Math.max(0, Math.min(100, (day / days) * 100))
}
