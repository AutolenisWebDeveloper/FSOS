// src/components/public/booking/CalendarMonth.tsx
// Month calendar for the public booking day picker (P1). Presentational client island: the
// layout + day classification come from the PURE, unit-tested month-grid helpers, and the
// availability data comes from the UNCHANGED availability API (the caller passes the set of
// available local-day keys). This component never talks to the engine — it renders a grid and
// reports day/month intent upward.
//
// A11y: a real <table role="grid"> with a weekday header; only AVAILABLE in-month days are
// focusable buttons (past / unavailable / out-of-month days are inert), so keyboard users tab
// straight through the bookable days; the selected day is aria-pressed + aria-current="date";
// availability is signalled by a shape (dot) + interactivity, not by color alone.
'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WEEKDAYS } from '@/lib/booking/display'
import { buildMonthMatrix, dayState } from './month-grid'
import { type MonthCursor, canGoToPrevMonth } from './calendar-model'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** Full, human date label for a YYYY-MM-DD key (layout only — noon UTC avoids any zone drift). */
function fullDayLabel(dateKey: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00Z`))
}

export interface CalendarMonthProps {
  /** Local YYYY-MM-DD keys that have at least one open slot (from groupSlotsByDay). */
  availableDayKeys: Set<string>
  /** Today in the booker's chosen zone (YYYY-MM-DD) — the floor for navigation + past days. */
  todayKey: string
  monthCursor: MonthCursor
  selectedDay: string | null
  onSelectDay: (key: string) => void
  onMonthChange: (delta: -1 | 1) => void
}

export function CalendarMonth({
  availableDayKeys,
  todayKey,
  monthCursor,
  selectedDay,
  onSelectDay,
  onMonthChange,
}: CalendarMonthProps) {
  const matrix = buildMonthMatrix(monthCursor.year, monthCursor.month0)
  const monthTitle = `${MONTH_NAMES[monthCursor.month0]} ${monthCursor.year}`

  // Don't allow navigating to a month entirely in the past (todayKey is the floor).
  const canGoPrev = canGoToPrevMonth(monthCursor, todayKey)

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-elev-sm sm:p-4">
      {/* Month navigation */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canGoPrev && onMonthChange(-1)}
          disabled={!canGoPrev}
          aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <h3 aria-live="polite" className="text-sm font-semibold text-foreground">
          {monthTitle}
        </h3>
        <button
          type="button"
          onClick={() => onMonthChange(1)}
          aria-label="Next month"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <table role="grid" aria-label={monthTitle} className="w-full table-fixed border-collapse">
        <thead>
          <tr role="row">
            {WEEKDAYS.map((d) => (
              <th
                key={d.value}
                scope="col"
                role="columnheader"
                className="pb-1.5 text-center text-xs font-medium text-muted-foreground"
              >
                <span aria-hidden>{d.short.charAt(0)}</span>
                <span className="sr-only">{d.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, ri) => (
            <tr key={ri} role="row">
              {row.map((cell) => {
                const state = dayState(cell.dateKey, availableDayKeys, todayKey)
                const isSelectable = cell.inMonth && state === 'available'
                const isSelected = isSelectable && cell.dateKey === selectedDay
                return (
                  <td key={cell.dateKey} role="gridcell" className="p-0.5 text-center align-middle">
                    {isSelectable ? (
                      <button
                        type="button"
                        onClick={() => onSelectDay(cell.dateKey)}
                        aria-pressed={isSelected}
                        aria-current={isSelected ? 'date' : undefined}
                        aria-label={`${fullDayLabel(cell.dateKey)}, available`}
                        className={cn(
                          'relative mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          isSelected
                            ? 'bg-primary font-semibold text-primary-foreground shadow-elev-sm'
                            : 'font-medium text-foreground ring-1 ring-inset ring-primary/25 hover:bg-primary/10 hover:text-primary',
                        )}
                      >
                        {cell.day}
                        {/* Availability dot — a shape cue so availability isn't color-only. */}
                        {!isSelected ? (
                          <span aria-hidden className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" />
                        ) : null}
                      </button>
                    ) : (
                      <span
                        aria-hidden={!cell.inMonth}
                        className={cn(
                          'mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-sm',
                          cell.inMonth ? 'text-muted-foreground/60' : 'text-muted-foreground/30',
                        )}
                      >
                        {cell.day}
                      </span>
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
