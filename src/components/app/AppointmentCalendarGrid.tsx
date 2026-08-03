'use client'

// src/components/app/AppointmentCalendarGrid.tsx
// Internal week/month calendar for the FSA command center (P2.5). Renders APPOINTMENTS (not slot
// availability) into grids, colored by status. Reuses the PURE public booking month math
// (buildMonthMatrix / dateKeyOf / dayState) and the pure week/nav helpers (lib/appointments/grid) —
// no duplicate grid implementation — and buckets appointments by the same localDateKey the KPIs
// use, so the grid, the list, and the KPI strip all agree on which day an appointment falls in.

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { STATUS_MAP } from '@/components/app/CalendarView'
import { localDateKey } from '@/lib/appointments/list'
import type { AppointmentListRow } from '@/components/app/AppointmentList'
import { buildMonthMatrix, dateKeyOf, dayState } from '@/components/public/booking/month-grid'
import { parseDateKey, buildWeekDays, addDaysKey, addMonths } from '@/lib/appointments/grid'

type View = 'month' | 'week'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_CELL_MAX = 2

function variantOf(status: string): React.ComponentProps<typeof Badge>['variant'] {
  return (STATUS_MAP[status]?.key ?? 'draft') as React.ComponentProps<typeof Badge>['variant']
}
function firstName(full: string): string {
  return full.split(' ')[0] || full
}

export function AppointmentCalendarGrid({ rows, tz }: { rows: AppointmentListRow[]; tz: string }) {
  const [view, setView] = React.useState<View>('month')
  // Anchor: today in the business zone. Computed once on the client.
  const [anchor, setAnchor] = React.useState(() => localDateKey(Date.now(), tz))
  const todayKey = React.useMemo(() => localDateKey(Date.now(), tz), [tz])

  // Bucket appointments by their local calendar day (same tz as the KPIs), newest-time first.
  const byDay = React.useMemo(() => {
    const m = new Map<string, AppointmentListRow[]>()
    for (const r of rows) {
      if (!r.whenIso) continue
      const ms = Date.parse(r.whenIso)
      if (Number.isNaN(ms)) continue
      const key = localDateKey(ms, tz)
      const arr = m.get(key)
      if (arr) arr.push(r)
      else m.set(key, [r])
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.whenIso ?? '').localeCompare(b.whenIso ?? ''))
    return m
  }, [rows, tz])

  const timeOf = React.useCallback(
    (iso: string | null) =>
      iso ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '',
    [tz],
  )

  const { year, month0 } = parseDateKey(anchor)
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month0, 1)),
  )
  const weekDays = buildWeekDays(anchor)
  const weekLabel = `${fmtDay(weekDays[0])} – ${fmtDay(weekDays[6])}`

  function prev() {
    if (view === 'month') {
      const { year: y, month0: m } = addMonths(year, month0, -1)
      setAnchor(dateKeyOf(y, m, 1))
    } else setAnchor(addDaysKey(anchor, -7))
  }
  function next() {
    if (view === 'month') {
      const { year: y, month0: m } = addMonths(year, month0, 1)
      setAnchor(dateKeyOf(y, m, 1))
    } else setAnchor(addDaysKey(anchor, 7))
  }

  function Chip({ r }: { r: AppointmentListRow }) {
    return (
      <Link
        href={`/app/calendar/${r.id}`}
        className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${timeOf(r.whenIso)} ${r.personName} — ${STATUS_MAP[r.status]?.label ?? r.status}`}
      >
        <Badge variant={variantOf(r.status)} className="flex w-full items-center gap-1 truncate font-normal">
          <span className="tabular-nums">{timeOf(r.whenIso)}</span>
          <span className="truncate">{firstName(r.personName)}</span>
        </Badge>
      </Link>
    )
  }

  const matrix = buildMonthMatrix(year, month0)
  const availableKeys = React.useMemo(() => new Set(byDay.keys()), [byDay])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={prev} aria-label={view === 'month' ? 'Previous month' : 'Previous week'}>
            ‹
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(todayKey)}>
            Today
          </Button>
          <Button size="sm" variant="outline" onClick={next} aria-label={view === 'month' ? 'Next month' : 'Next week'}>
            ›
          </Button>
        </div>
        <p className="text-sm font-medium" aria-live="polite">
          {view === 'month' ? monthLabel : weekLabel}
        </p>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Calendar view">
          <Button size="sm" variant={view === 'week' ? 'default' : 'outline'} onClick={() => setView('week')} aria-pressed={view === 'week'}>
            Week
          </Button>
          <Button size="sm" variant={view === 'month' ? 'default' : 'outline'} onClick={() => setView('month')} aria-pressed={view === 'month'}>
            Month
          </Button>
        </div>
      </div>

      {view === 'month' ? (
        <div className="overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-1.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {matrix.flat().map((cell) => {
                const day = byDay.get(cell.dateKey) ?? []
                const state = dayState(cell.dateKey, availableKeys, todayKey)
                const isToday = cell.dateKey === todayKey
                return (
                  <div
                    key={cell.dateKey}
                    className={`min-h-[6rem] border-b border-r p-1.5 ${cell.inMonth ? '' : 'bg-muted/30'} ${
                      state === 'past' ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`text-xs tabular-nums ${
                          isToday
                            ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground'
                            : cell.inMonth
                              ? 'text-foreground'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {cell.day}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {day.slice(0, MONTH_CELL_MAX).map((r) => (
                        <Chip key={r.id} r={r} />
                      ))}
                      {day.length > MONTH_CELL_MAX ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAnchor(cell.dateKey)
                            setView('week')
                          }}
                          className="w-full rounded px-1 text-left text-[11px] text-muted-foreground hover:underline"
                        >
                          +{day.length - MONTH_CELL_MAX} more
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[44rem] grid-cols-7 gap-2">
            {weekDays.map((key) => {
              const day = byDay.get(key) ?? []
              const isToday = key === todayKey
              return (
                <div key={key} className="rounded-lg border">
                  <div className={`border-b px-2 py-1.5 text-xs font-medium ${isToday ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
                    {fmtWeekdayDay(key)}
                  </div>
                  <div className="max-h-80 space-y-1 overflow-y-auto p-1.5">
                    {day.length === 0 ? (
                      <p className="px-1 py-2 text-[11px] text-muted-foreground">—</p>
                    ) : (
                      day.map((r) => <Chip key={r.id} r={r} />)
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtDay(key: string): string {
  const { year, month0, day } = parseDateKey(key)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month0, day)))
}
function fmtWeekdayDay(key: string): string {
  const { year, month0, day } = parseDateKey(key)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month0, day)))
}
