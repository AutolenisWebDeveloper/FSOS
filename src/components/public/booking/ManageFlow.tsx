'use client'

// src/components/public/booking/ManageFlow.tsx
// Self-service reschedule / cancel over the UNCHANGED manage API (GET summary, POST
// cancel|reschedule via the signed token). P1 T8 premium redesign: the reschedule picker reuses
// the SAME CalendarMonth + SlotTimeList + calendar-model as the booking flow, anchored on the
// existing appointment (initialMonth opens the appointment's month when it's in the future).
// No engine/contract change — only presentation and the shared client model.

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PublicCard, PublicAlert } from '@/components/public/PublicShell'
import { postJson } from '@/lib/client/api'
import { meetingModeLabel } from '@/lib/booking/display'
import { CONTACT } from '@/lib/site'
import { groupSlotsByDay } from './month-grid'
import {
  type MonthCursor,
  addMonths,
  fetchFromKey,
  firstOpenDayInMonth,
  initialMonth,
  monthPrefixOf,
} from './calendar-model'
import { CalendarMonth } from './CalendarMonth'
import { SlotTimeList } from './SlotTimeList'

interface Summary {
  purpose: 'cancel' | 'reschedule'
  appointment: {
    typeName: string | null
    typeSlug: string | null
    startsAt: string | null
    bookerTimezone: string | null
    meetingMode: string | null
    status: string
    durationMinutes: number | null
  }
}
interface Slot {
  startsAt: string
  localDate: string
  localTime: string
}

// The reschedule picker fills a 6-week grid; 42 days from the month's first day stays within the
// availability API's 45-day clamp (matches the booking flow).
const FETCH_DAYS = 42

function fullWhen(iso: string | null, tz: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/Chicago',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso))
}
/** "Monday, August 3" heading over the day's times. */
function selectedDayLabel(dateKey: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(`${dateKey}T12:00:00Z`),
  )
}
/** Today (YYYY-MM-DD) in a given zone. */
function localTodayISO(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  )
}
/** The appointment's own local day (YYYY-MM-DD) — the reschedule anchor for initialMonth. */
function localDayInTz(iso: string | null, tz: string): string | null {
  if (!iso) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  )
}

export function ManageFlow({ token }: { token: string }) {
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [done, setDone] = React.useState<null | { kind: 'cancelled' | 'rescheduled'; when?: string }>(null)

  React.useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await fetch(`/api/public/booking/manage?t=${encodeURIComponent(token)}`)
        const json = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) setLoadError('This link is invalid or has expired.')
        else setSummary(json as Summary)
      } catch {
        if (live) setLoadError('We couldn’t load your appointment. Please check your connection and try again.')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [token])

  if (loading) {
    return (
      <PublicCard subtitle="Manage your appointment">
        <div className="animate-pulse space-y-3" aria-hidden>
          <div className="h-5 w-48 rounded bg-muted" />
          <div className="h-20 rounded-lg bg-muted" />
        </div>
        <span className="sr-only" role="status">
          Loading your appointment
        </span>
      </PublicCard>
    )
  }
  if (loadError || !summary) {
    return (
      <PublicCard subtitle="Manage your appointment">
        <h1 className="text-lg font-semibold text-foreground">This link isn’t working</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {loadError || 'This link is invalid or has expired.'} Manage links expire for your security. Open the most
          recent confirmation email for a fresh link, or reach us and we’ll help.
        </p>
        <div className="mt-5">
          <Button asChild variant="outline">
            <a href={`tel:${CONTACT.phoneE164}`}>Call {CONTACT.phoneDisplay}</a>
          </Button>
        </div>
      </PublicCard>
    )
  }
  if (done) {
    return (
      <PublicCard subtitle="Manage your appointment">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-won/15 text-status-won"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.29 6.8-6.8a1 1 0 011.4 0z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">
              {done.kind === 'cancelled' ? 'Your appointment is cancelled' : 'Your appointment is rescheduled'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {done.kind === 'cancelled'
                ? 'We’ve cancelled it and a confirmation is on its way. You’re welcome to book again any time.'
                : `Your new time is ${done.when}. A fresh confirmation is on its way.`}
            </p>
          </div>
        </div>
      </PublicCard>
    )
  }

  const appt = summary.appointment
  const notScheduled = appt.status !== 'scheduled'

  return summary.purpose === 'cancel' ? (
    <CancelView token={token} appt={appt} disabled={notScheduled} onDone={() => setDone({ kind: 'cancelled' })} />
  ) : (
    <RescheduleView
      token={token}
      appt={appt}
      disabled={notScheduled}
      onDone={(when) => setDone({ kind: 'rescheduled', when })}
    />
  )
}

function ApptSummary({ appt }: { appt: Summary['appointment'] }) {
  return (
    <div className="rounded-lg border border-border bg-accent/30 px-4 py-3 text-sm">
      <div className="font-semibold text-foreground">{appt.typeName ?? 'Appointment'}</div>
      <div className="mt-0.5 text-muted-foreground">{fullWhen(appt.startsAt, appt.bookerTimezone)}</div>
      <div className="text-xs text-muted-foreground">{meetingModeLabel(appt.meetingMode)}</div>
    </div>
  )
}

function CancelView({
  token,
  appt,
  disabled,
  onDone,
}: {
  token: string
  appt: Summary['appointment']
  disabled: boolean
  onDone: () => void
}) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const inFlight = React.useRef(false)

  async function cancel() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setErr(null)
    try {
      const res = await postJson('/api/public/booking/manage', {
        t: token,
        action: 'cancel',
        reason: reason.trim() || undefined,
      })
      if (!res.ok) {
        setErr(
          res.error.reason === 'not_cancellable'
            ? 'This appointment can no longer be cancelled.'
            : 'We couldn’t cancel this appointment. Please try again in a moment.',
        )
        return
      }
      onDone()
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  return (
    <PublicCard subtitle="Cancel your appointment">
      <h1 className="text-lg font-semibold text-foreground">Cancel this appointment?</h1>
      <div className="mt-3">
        <ApptSummary appt={appt} />
      </div>
      {disabled ? (
        <PublicAlert className="mt-4">This appointment can no longer be cancelled.</PublicAlert>
      ) : (
        <>
          <div className="mt-4">
            <label htmlFor="cancel-reason" className="mb-1.5 block text-sm text-muted-foreground">
              Reason (optional)
            </label>
            <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {err ? <PublicAlert className="mt-3">{err}</PublicAlert> : null}
          <div className="mt-5 flex items-center gap-2">
            <Button variant="destructive" loading={busy} onClick={cancel}>
              {busy ? 'Cancelling…' : 'Cancel appointment'}
            </Button>
          </div>
        </>
      )}
    </PublicCard>
  )
}

function RescheduleView({
  token,
  appt,
  disabled,
  onDone,
}: {
  token: string
  appt: Summary['appointment']
  disabled: boolean
  onDone: (when: string) => void
}) {
  const tz = appt.bookerTimezone || 'America/Chicago'
  const today = React.useMemo(() => localTodayISO(tz), [tz])
  const anchor = React.useMemo(() => localDayInTz(appt.startsAt, tz), [appt.startsAt, tz])

  const [monthCursor, setMonthCursor] = React.useState<MonthCursor>(() => initialMonth(today, anchor))
  const [slots, setSlots] = React.useState<Slot[]>([])
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null) // startsAt of the in-flight pick
  const inFlight = React.useRef(false)

  // Monotonic request id — month paging fires overlapping fetches; ignore non-latest responses.
  const reqSeq = React.useRef(0)
  const load = React.useCallback(
    async (cursor: MonthCursor) => {
      if (disabled || !appt.typeSlug) {
        setLoading(false)
        return
      }
      const seq = ++reqSeq.current
      setLoading(true)
      setErr(null)
      const from = fetchFromKey(cursor, today)
      const monthPrefix = monthPrefixOf(cursor)
      try {
        const params = new URLSearchParams({ type: appt.typeSlug, tz, from, days: String(FETCH_DAYS) })
        const res = await fetch(`/api/public/booking/availability?${params.toString()}`)
        const json = await res.json().catch(() => ({}))
        if (seq !== reqSeq.current) return
        if (!res.ok) {
          setErr('We couldn’t load available times. Please try again.')
          setSlots([])
          setSelectedDay(null)
          return
        }
        const next = (json.slots ?? []) as Slot[]
        setSlots(next)
        setSelectedDay(firstOpenDayInMonth(groupSlotsByDay(next).keys(), monthPrefix))
      } catch {
        if (seq !== reqSeq.current) return
        setErr('We couldn’t reach the server. Please check your connection and try again.')
        setSlots([])
        setSelectedDay(null)
      } finally {
        if (seq === reqSeq.current) setLoading(false)
      }
    },
    [appt.typeSlug, tz, today, disabled],
  )

  React.useEffect(() => {
    load(monthCursor)
  }, [monthCursor, load])

  const byDay = React.useMemo(() => groupSlotsByDay(slots), [slots])
  const availableDayKeys = React.useMemo(() => new Set(byDay.keys()), [byDay])
  const monthPrefix = monthPrefixOf(monthCursor)
  const dayCount = [...byDay.keys()].filter((k) => k.startsWith(monthPrefix)).length
  const daySlots = selectedDay ? byDay.get(selectedDay) ?? [] : []

  async function pick(slot: Slot) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(slot.startsAt)
    setErr(null)
    let res
    try {
      res = await postJson<{ ok: boolean; startsAt: string }>('/api/public/booking/manage', {
        t: token,
        action: 'reschedule',
        newStartsAt: slot.startsAt,
      })
    } finally {
      setBusy(null)
      inFlight.current = false
    }
    if (!res.ok) {
      const reason = res.error.reason
      if (reason === 'taken' || reason === 'unavailable') {
        toast.error('That time was just taken. Please pick another.')
        setErr(null)
        load(monthCursor) // refresh — the slot is gone
        return
      }
      setErr(
        reason === 'not_reschedulable'
          ? 'This appointment can no longer be rescheduled.'
          : 'We couldn’t reschedule to that time. Please pick another.',
      )
      return
    }
    onDone(fullWhen(res.data.startsAt, tz))
  }

  return (
    <PublicCard subtitle="Reschedule your appointment" className="max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground">Pick a new time</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your current time</p>
      <div className="mt-2">
        <ApptSummary appt={appt} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">New times shown in {tz}</p>

      <div className="mt-4">
        {disabled ? (
          <PublicAlert>This appointment can no longer be rescheduled.</PublicAlert>
        ) : !appt.typeSlug ? (
          <PublicAlert>
            We can’t load new times for this appointment online. Please contact us at {CONTACT.phoneDisplay}.
          </PublicAlert>
        ) : err && slots.length === 0 ? (
          <div className="space-y-3">
            <PublicAlert>{err}</PublicAlert>
            <Button variant="outline" size="sm" onClick={() => load(monthCursor)}>
              Try again
            </Button>
          </div>
        ) : loading ? (
          <ReschedSkeleton />
        ) : (
          <div className="grid gap-5 md:grid-cols-[minmax(0,20rem)_1fr]">
            <CalendarMonth
              availableDayKeys={availableDayKeys}
              todayKey={today}
              monthCursor={monthCursor}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              // Freeze month paging while a pick is committing so the 409-recovery refetch can't
              // race a month change and leave the calendar and time list on different months.
              onMonthChange={(delta) => {
                if (busy) return
                setMonthCursor((c) => addMonths(c, delta))
              }}
            />
            <div className="min-w-0">
              {err ? <PublicAlert className="mb-3">{err}</PublicAlert> : null}
              {dayCount === 0 ? (
                <div className="flex h-full flex-col justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">No openings this month</p>
                  <p className="mt-1 text-sm text-muted-foreground">Use the arrows to check another month.</p>
                  <div className="mt-4">
                    <Button variant="outline" size="sm" onClick={() => setMonthCursor((c) => addMonths(c, 1))}>
                      Next month →
                    </Button>
                  </div>
                </div>
              ) : selectedDay ? (
                <SlotTimeList dayLabel={selectedDayLabel(selectedDay)} slots={daySlots} onPick={pick} busyKey={busy} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">Select an available day to see open times.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PublicCard>
  )
}

function ReschedSkeleton() {
  return (
    <div className="grid animate-pulse gap-5 md:grid-cols-[minmax(0,20rem)_1fr]" aria-hidden>
      <div className="rounded-xl border border-border bg-card p-3 shadow-elev-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="h-8 w-8 rounded-md bg-muted" />
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="h-8 w-8 rounded-md bg-muted" />
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 42 }).map((_, i) => (
            <div key={i} className="mx-auto h-9 w-9 rounded-lg bg-muted" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
