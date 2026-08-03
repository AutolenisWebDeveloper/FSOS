// src/components/app/booking/WeeklyAvailabilitySummary.tsx
// Read-only, at-a-glance view of the recurring weekly availability TEMPLATE. Presentational only —
// it renders the DayAvailability[] produced by the shared describeWeeklyAvailability() interpreter
// (which reads the same engine rules clients book against). It explicitly labels itself the
// recurring template and notes that blackouts / one-off exceptions apply on top — it does not claim
// to be the live bookable-slot list.

import type { DayAvailability } from '@/lib/booking/availability-summary'

export function WeeklyAvailabilitySummary({ days, timezone }: { days: DayAvailability[]; timezone: string | null }) {
  const hasAny = days.some((d) => d.windows.length > 0)

  return (
    <div className="space-y-2 text-sm">
      <ul className="divide-y rounded-lg border">
        {days.map((d) => (
          <li key={d.weekday} className="flex items-start justify-between gap-3 p-2.5">
            <span className="w-28 shrink-0 font-medium">{d.label}</span>
            <div className="flex-1 text-right">
              {d.windows.length === 0 ? (
                <span className="text-muted-foreground">Unavailable</span>
              ) : (
                <ul className="space-y-0.5">
                  {d.windows.map((w, i) => (
                    <li key={i} className="tabular-nums">
                      {w.start} – {w.end}
                      {w.effectiveStart || w.effectiveEnd ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({w.effectiveStart ?? '…'} → {w.effectiveEnd ?? '…'})
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {hasAny ? 'Recurring weekly template' : 'No weekly hours set yet'}
        {timezone ? ` · times in ${timezone.replace(/_/g, ' ')}` : ''}. Blackout dates and one-off exceptions apply on
        top; actual bookable slots are computed by the availability engine.
      </p>
    </div>
  )
}
