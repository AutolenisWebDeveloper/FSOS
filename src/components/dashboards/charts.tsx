import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Numeric } from '@/components/ui/typography'
import { EmptyNote, toneBar, toneText, type Tone } from './primitives'

/*
 * Server-rendered SVG/flex charts for the Production Operations command centers.
 * No client runtime, no chart library — every mark is a token-colored primitive
 * that ships in the server payload. Each chart carries an accessible role/label.
 */

// ─── FunnelChart: descending pipeline stages with step conversion ─────────────

export interface FunnelStage {
  label: string
  value: number
  href?: string
  tone?: Tone
}

export function FunnelChart({ stages, valueLabel = 'records' }: { stages: FunnelStage[]; valueLabel?: string }) {
  const top = stages.length ? Math.max(stages[0].value, 1) : 1
  if (!stages.length || stages.every((s) => s.value === 0)) return <EmptyNote>No pipeline activity yet.</EmptyNote>
  return (
    <ol className="space-y-2" aria-label="Conversion funnel">
      {stages.map((stage, i) => {
        const pct = Math.max(2, Math.round((stage.value / top) * 100))
        const stepRate = i > 0 && stages[i - 1].value > 0 ? Math.round((stage.value / stages[i - 1].value) * 100) : null
        const tone = stage.tone ?? 'brand'
        const inner = (
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground">{stage.label}</span>
              <div className="flex shrink-0 items-center gap-2">
                {stepRate != null ? <span className="text-[11px] text-muted-foreground">{stepRate}% of prior</span> : null}
                <Numeric className="text-sm font-semibold tabular-nums">{stage.value.toLocaleString()}</Numeric>
              </div>
            </div>
            <div className="mt-1.5 h-6 w-full overflow-hidden rounded-md bg-muted/70">
              <div
                className={cn('flex h-full items-center rounded-md transition-all', toneBar(tone))}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
          </div>
        )
        return (
          <li key={stage.label}>
            {stage.href ? (
              <Link href={stage.href} className="block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        )
      })}
      <li className="sr-only">Values expressed in {valueLabel}.</li>
    </ol>
  )
}

// ─── BarList: ranked horizontal bars (distribution / aging / mix) ─────────────

export interface BarItem {
  label: string
  value: number
  href?: string
  tone?: Tone
  /** Optional secondary text rendered under/next to the value. */
  meta?: string
}

export function BarList({
  items,
  format = (n) => n.toLocaleString(),
  emptyLabel = 'No data in this segment yet.',
  maxOverride,
}: {
  items: BarItem[]
  format?: (n: number) => string
  emptyLabel?: string
  maxOverride?: number
}) {
  if (!items.length || items.every((i) => i.value === 0)) return <EmptyNote>{emptyLabel}</EmptyNote>
  const max = maxOverride ?? Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const pct = Math.max(item.value > 0 ? 3 : 0, Math.round((item.value / max) * 100))
        const tone = item.tone ?? 'brand'
        const row = (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-foreground">{item.label}</span>
              <div className="flex shrink-0 items-baseline gap-2">
                {item.meta ? <span className="text-[11px] text-muted-foreground">{item.meta}</span> : null}
                <Numeric className="text-sm font-semibold tabular-nums">{format(item.value)}</Numeric>
              </div>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full', toneBar(tone))} style={{ width: `${pct}%` }} aria-hidden />
            </div>
          </>
        )
        return (
          <li key={item.label}>
            {item.href ? (
              <Link href={item.href} className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ─── DonutChart: proportional mix with legend ─────────────────────────────────

export interface DonutSegment {
  label: string
  value: number
  tone?: Tone
  href?: string
}

const DONUT_TONES: Tone[] = ['brand', 'positive', 'attention', 'security', 'neutral', 'critical']

export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  emptyLabel = 'No records to chart.',
}: {
  segments: DonutSegment[]
  centerValue?: React.ReactNode
  centerLabel?: string
  emptyLabel?: string
}) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (!total) return <EmptyNote>{emptyLabel}</EmptyNote>
  const r = 42
  const c = 2 * Math.PI * r
  let offset = 0
  const withTone = segments.map((s, i) => ({ ...s, tone: s.tone ?? DONUT_TONES[i % DONUT_TONES.length] }))
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-[132px] w-[132px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Distribution by segment">
          <circle cx="50" cy="50" r={r} fill="none" className="text-muted" stroke="currentColor" strokeWidth="14" />
          {withTone.map((s) => {
            const frac = s.value / total
            const dash = frac * c
            const seg = (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                className={toneText(s.tone!)}
                stroke="currentColor"
                strokeWidth="14"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label}: ${s.value.toLocaleString()} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            )
            offset += dash
            return seg
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <Numeric className="text-xl font-semibold leading-none">{centerValue ?? total.toLocaleString()}</Numeric>
          {centerLabel ? <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{centerLabel}</span> : null}
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {withTone.map((s) => {
          const pct = Math.round((s.value / total) * 100)
          const content = (
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', toneBar(s.tone!))} aria-hidden />
                <span className="truncate text-sm text-foreground">{s.label}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5">
                <Numeric className="text-sm font-semibold tabular-nums">{s.value.toLocaleString()}</Numeric>
                <span className="text-[11px] text-muted-foreground">{pct}%</span>
              </span>
            </div>
          )
          return (
            <li key={s.label}>
              {s.href ? (
                <Link href={s.href} className="block rounded px-1 py-0.5 -mx-1 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── HeatGrid: intensity matrix (opportunity heat map) ────────────────────────

export interface HeatCell {
  value: number
  href?: string
  title: string
}

export function HeatGrid({
  columns,
  rows,
  cells,
  tone = 'brand',
  format = (n) => n.toLocaleString(),
}: {
  /** Column headers (e.g. urgency tiers). */
  columns: string[]
  /** Row headers (e.g. agencies / age bands), aligned to `cells` rows. */
  rows: string[]
  /** cells[rowIndex][colIndex]. */
  cells: HeatCell[][]
  tone?: Tone
  format?: (n: number) => string
}) {
  const flat = cells.flat().map((c) => c.value)
  const max = Math.max(...flat, 1)
  if (!flat.length || flat.every((v) => v === 0)) return <EmptyNote>No opportunities to plot yet.</EmptyNote>
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="w-px" />
            {columns.map((c) => (
              <th key={c} className="px-2 pb-1 text-center align-bottom mono-label text-[10px] text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((rowLabel, ri) => (
            <tr key={rowLabel}>
              <th scope="row" className="max-w-[10rem] truncate pr-2 text-left text-xs font-medium text-foreground">
                {rowLabel}
              </th>
              {columns.map((_, ci) => {
                const cell = cells[ri]?.[ci]
                const v = cell?.value ?? 0
                const intensity = v === 0 ? 0 : 0.12 + (v / max) * 0.78
                const styled = (
                  <div className="relative">
                    <div
                      className={cn('absolute inset-0 rounded-md', v === 0 ? 'bg-muted/40' : toneBar(tone))}
                      style={v === 0 ? undefined : { opacity: intensity }}
                      aria-hidden
                    />
                    <div className="relative flex h-9 items-center justify-center text-xs font-semibold tabular-nums">
                      <span className={v === 0 ? 'text-muted-foreground/40' : intensity > 0.5 ? 'text-white' : 'text-foreground'}>
                        {v === 0 ? '·' : format(v)}
                      </span>
                    </div>
                  </div>
                )
                return (
                  <td key={ci} className="p-0">
                    {cell?.href && v > 0 ? (
                      <Link href={cell.href} className="block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={cell.title}>
                        {styled}
                      </Link>
                    ) : (
                      styled
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
