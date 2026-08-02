// src/components/public/booking/SlotTimeList.tsx
// Shared time-of-day slot list for BOTH the booking picker and the reschedule picker (P1 T8).
// One implementation of the Morning / Afternoon / Evening grouping so the two flows can't drift.
// Presentational; the caller supplies the day's slots and the pick handler. `busyKey` (the
// startsAt of an in-flight pick) disables the grid and shows a spinner on that button — used by
// reschedule, where picking a time immediately POSTs; the booking flow leaves it unset.
'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { formatWallTime, timeOfDayBucket, TIME_OF_DAY_SECTIONS } from '@/lib/booking/display'

export interface TimeSlotLike {
  startsAt: string
  localTime: string
}

export function SlotTimeList<T extends TimeSlotLike>({
  dayLabel,
  slots,
  onPick,
  busyKey = null,
}: {
  dayLabel: string
  slots: T[]
  onPick: (slot: T) => void
  busyKey?: string | null
}) {
  const groups = React.useMemo(() => {
    const m = new Map<string, T[]>()
    for (const s of slots) {
      const b = timeOfDayBucket(s.localTime)
      const arr = m.get(b)
      if (arr) arr.push(s)
      else m.set(b, [s])
    }
    return m
  }, [slots])

  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-foreground">{dayLabel}</div>
      <div className="space-y-4">
        {TIME_OF_DAY_SECTIONS.map(({ key, label }) => {
          const items = groups.get(key)
          if (!items || items.length === 0) return null
          return (
            <div key={key}>
              <div className="mono-label mb-1.5 text-muted-foreground">{label}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {items.map((s) => (
                  <Button
                    key={s.startsAt}
                    type="button"
                    variant="outline"
                    className="justify-center font-medium"
                    loading={busyKey === s.startsAt}
                    disabled={!!busyKey && busyKey !== s.startsAt}
                    onClick={() => onPick(s)}
                  >
                    {formatWallTime(s.localTime)}
                  </Button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
