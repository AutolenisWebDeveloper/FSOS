'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PublicCard, PublicAlert } from '@/components/public/PublicShell'
import { postJson } from '@/lib/client/api'
import { formatWallTime, meetingModeLabel } from '@/lib/booking/display'

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
function dayLabel(dateIso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(`${dateIso}T00:00:00Z`),
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
        if (!res.ok) setLoadError(json?.error || 'This link is invalid or has expired.')
        else setSummary(json as Summary)
      } catch {
        if (live) setLoadError('Could not load the appointment. Please try again.')
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
        <div className="h-24 animate-pulse rounded-lg bg-muted" aria-hidden />
      </PublicCard>
    )
  }
  if (loadError || !summary) {
    return (
      <PublicCard subtitle="Manage your appointment">
        <PublicAlert>{loadError || 'This link is invalid or has expired.'}</PublicAlert>
      </PublicCard>
    )
  }
  if (done) {
    return (
      <PublicCard subtitle="Manage your appointment">
        <h1 className="text-lg font-semibold text-foreground">
          {done.kind === 'cancelled' ? 'Your appointment is cancelled' : 'Your appointment is rescheduled'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {done.kind === 'cancelled'
            ? "We've cancelled it and sent a confirmation. You're welcome to book again any time."
            : `Your new time is ${done.when}. A fresh confirmation is on its way.`}
        </p>
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

  async function cancel() {
    setBusy(true)
    setErr(null)
    const res = await postJson('/api/public/booking/manage', { t: token, action: 'cancel', reason: reason.trim() || undefined })
    setBusy(false)
    if (!res.ok) return setErr(res.error.error || 'Could not cancel. Please try again.')
    onDone()
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
  const [slots, setSlots] = React.useState<Slot[]>([])
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const tz = appt.bookerTimezone || 'America/Chicago'

  React.useEffect(() => {
    if (disabled || !appt.typeSlug) {
      setLoading(false)
      return
    }
    let live = true
    ;(async () => {
      try {
        const params = new URLSearchParams({ type: appt.typeSlug as string, tz, days: '21' })
        const res = await fetch(`/api/public/booking/availability?${params.toString()}`)
        const json = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) setErr(json?.error || 'Could not load availability.')
        else setSlots((json.slots ?? []) as Slot[])
      } catch {
        if (live) setErr('Could not load availability. Please try again.')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [appt.typeSlug, tz, disabled])

  async function pick(slot: Slot) {
    setBusy(slot.startsAt)
    setErr(null)
    const res = await postJson<{ ok: boolean; startsAt: string }>('/api/public/booking/manage', {
      t: token,
      action: 'reschedule',
      newStartsAt: slot.startsAt,
    })
    setBusy(null)
    if (!res.ok) {
      setErr(res.error.error || 'Could not reschedule. Please pick another time.')
      // Slot may have just been taken — refresh availability.
      if (res.error.reason === 'taken' || res.error.reason === 'unavailable') {
        toast.error('That time was just taken. Please pick another.')
      }
      return
    }
    onDone(fullWhen(res.data.startsAt, tz))
  }

  const byDate = new Map<string, Slot[]>()
  for (const s of slots) {
    const a = byDate.get(s.localDate)
    if (a) a.push(s)
    else byDate.set(s.localDate, [s])
  }
  const days = Array.from(byDate.keys()).sort()

  return (
    <PublicCard subtitle="Reschedule your appointment" className="max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground">Pick a new time</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your current time:</p>
      <div className="mt-2">
        <ApptSummary appt={appt} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Times shown in {tz}</p>

      <div className="mt-4 min-h-[8rem]">
        {disabled ? (
          <PublicAlert>This appointment can no longer be rescheduled.</PublicAlert>
        ) : loading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" aria-hidden />
        ) : err && slots.length === 0 ? (
          <PublicAlert>{err}</PublicAlert>
        ) : days.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No open times in the next few weeks. Please check back soon.
          </div>
        ) : (
          <div className="space-y-4">
            {err ? <PublicAlert>{err}</PublicAlert> : null}
            {days.map((d) => (
              <div key={d}>
                <div className="mb-2 text-sm font-medium text-foreground">{dayLabel(d)}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(byDate.get(d) ?? []).map((s) => (
                    <Button
                      key={s.startsAt}
                      variant="outline"
                      size="sm"
                      loading={busy === s.startsAt}
                      disabled={!!busy}
                      onClick={() => pick(s)}
                    >
                      {formatWallTime(s.localTime)}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PublicCard>
  )
}
