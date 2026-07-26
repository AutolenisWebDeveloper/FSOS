'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { PublicCard, PublicAlert } from '@/components/public/PublicShell'
import { postJson, firstFieldError } from '@/lib/client/api'
import { PublicBookingInput, isValidIanaZone } from '@/lib/booking/config-schemas'
import { COMMON_TIMEZONES, formatWallTime, meetingModeLabel } from '@/lib/booking/display'
import { buildIcs } from '@/lib/booking/ics'

interface PublicType {
  slug: string
  name: string
  description: string | null
  durationMinutes: number
  meetingMode: string
}
interface Slot {
  startsAt: string
  endsAt: string
  durationMinutes: number
  localDate: string
  localTime: string
  label: string
  offset: string
}
interface Confirmation {
  reference: string
  typeName: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  meetingMode: string
  bookerTimezone: string
  joinUrl: string | null
  meetingStatus: 'none' | 'provisioned' | 'pending'
}

const WINDOW_DAYS = 14

function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && isValidIanaZone(tz) ? tz : 'America/Chicago'
  } catch {
    return 'America/Chicago'
  }
}
/** Today's date (YYYY-MM-DD) in the booker's zone. */
function localTodayISO(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  )
}
function addDaysISO(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
/** "Mon, Jul 27" from a YYYY-MM-DD (rendered zone-neutrally). */
function dayLabel(dateIso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(`${dateIso}T00:00:00Z`),
  )
}
function fullWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}
function modeNote(mode: string, status?: 'none' | 'provisioned' | 'pending'): string {
  if (mode === 'video') {
    return status === 'provisioned'
      ? 'Use the video link below to join. It&rsquo;s also in your confirmation email.'
      : 'A video meeting link will be included in your confirmation email.'
  }
  if (mode === 'phone') return 'We&rsquo;ll call you at the number you provided at the scheduled time.'
  return 'Meeting location details will be included in your confirmation email.'
}

export function BookingFlow({ type, backHref }: { type: PublicType; backHref?: string }) {
  const [tz, setTz] = React.useState<string>('America/Chicago')
  const [rangeStart, setRangeStart] = React.useState<string>('') // YYYY-MM-DD, booker-local
  const [today, setToday] = React.useState<string>('')
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [slots, setSlots] = React.useState<Slot[]>([])
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null)
  const [chosen, setChosen] = React.useState<Slot | null>(null)
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null)

  // Detect the booker's timezone once, client-side, and seed the range at "today".
  React.useEffect(() => {
    const detected = detectTimezone()
    const t = localTodayISO(detected)
    setTz(detected)
    setToday(t)
    setRangeStart(t)
  }, [])

  const loadAvailability = React.useCallback(
    async (zone: string, from: string) => {
      setLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams({ type: type.slug, tz: zone, from, days: String(WINDOW_DAYS) })
        const res = await fetch(`/api/public/booking/availability?${params.toString()}`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setLoadError(json?.error || 'Could not load availability.')
          setSlots([])
          return
        }
        const next = (json.slots ?? []) as Slot[]
        setSlots(next)
        setSelectedDate(next.length ? next[0].localDate : null)
      } catch {
        setLoadError('Could not load availability. Please check your connection and try again.')
        setSlots([])
      } finally {
        setLoading(false)
      }
    },
    [type.slug],
  )

  React.useEffect(() => {
    if (tz && rangeStart) loadAvailability(tz, rangeStart)
  }, [tz, rangeStart, loadAvailability])

  const byDate = React.useMemo(() => {
    const m = new Map<string, Slot[]>()
    for (const s of slots) {
      const arr = m.get(s.localDate)
      if (arr) arr.push(s)
      else m.set(s.localDate, [s])
    }
    return m
  }, [slots])
  const days = React.useMemo(() => Array.from(byDate.keys()).sort(), [byDate])
  const canGoEarlier = rangeStart > today

  // ── Success state ────────────────────────────────────────────────────────────
  if (confirmation) {
    return <BookingConfirmed confirmation={confirmation} onBookAnother={() => { setConfirmation(null); setChosen(null); if (tz) loadAvailability(tz, today); setRangeStart(today) }} />
  }

  // ── Details step ─────────────────────────────────────────────────────────────
  if (chosen) {
    return (
      <DetailsForm
        type={type}
        slot={chosen}
        tz={tz}
        onBack={() => setChosen(null)}
        onBooked={(c) => setConfirmation(c)}
        onSlotGone={() => {
          setChosen(null)
          toast.error('That time was just taken. Please pick another.')
          if (tz && rangeStart) loadAvailability(tz, rangeStart)
        }}
      />
    )
  }

  // ── Slot-picker step ─────────────────────────────────────────────────────────
  return (
    <PublicCard subtitle={`${type.durationMinutes}-minute ${meetingModeLabel(type.meetingMode).toLowerCase()} meeting`} className="max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{type.name}</h1>
          {type.description ? <p className="mt-1 text-sm text-muted-foreground">{type.description}</p> : null}
        </div>
        {backHref ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={backHref}>Change</Link>
          </Button>
        ) : null}
      </div>

      {/* Timezone control — the booker always knows what zone they're booking in. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Times shown in</span>
        <label className="sr-only" htmlFor="booking-tz">
          Timezone
        </label>
        <Select
          id="booking-tz"
          value={COMMON_TIMEZONES.includes(tz as (typeof COMMON_TIMEZONES)[number]) ? tz : ''}
          onChange={(e) => setTz(e.target.value || tz)}
          className="h-8 w-auto min-w-[12rem] text-sm"
        >
          {!COMMON_TIMEZONES.includes(tz as (typeof COMMON_TIMEZONES)[number]) ? <option value="">{tz} (detected)</option> : null}
          {COMMON_TIMEZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </div>

      {/* Range navigation */}
      <div className="mt-4 flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={!canGoEarlier || loading} onClick={() => setRangeStart(addDaysISO(rangeStart, -WINDOW_DAYS) < today ? today : addDaysISO(rangeStart, -WINDOW_DAYS))}>
          ← Earlier
        </Button>
        <span className="text-xs text-muted-foreground">{loading ? 'Loading…' : `Next ${WINDOW_DAYS} days`}</span>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setRangeStart(addDaysISO(rangeStart, WINDOW_DAYS))}>
          Later →
        </Button>
      </div>

      <div className="mt-4 min-h-[12rem]">
        {loading ? (
          <PickerSkeleton />
        ) : loadError ? (
          <div className="space-y-3">
            <PublicAlert>{loadError}</PublicAlert>
            <Button variant="outline" size="sm" onClick={() => loadAvailability(tz, rangeStart)}>
              Try again
            </Button>
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">No openings in this range</p>
            <p className="mt-1 text-sm text-muted-foreground">Try the next set of dates.</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => setRangeStart(addDaysISO(rangeStart, WINDOW_DAYS))}>
              Show later dates →
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Day selector */}
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Available days">
              {days.map((d) => {
                const active = d === selectedDate
                return (
                  <button
                    key={d}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedDate(d)}
                    className={
                      'shrink-0 rounded-lg border px-3 py-2 text-center text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ' +
                      (active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-foreground hover:border-ring/60')
                    }
                  >
                    <div className="font-medium">{dayLabel(d)}</div>
                    <div className={active ? 'text-primary-foreground/80' : 'text-muted-foreground'}>
                      {byDate.get(d)?.length} open
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Time slots for the selected day */}
            {selectedDate ? (
              <div>
                <div className="mb-2 text-sm font-medium text-foreground">{dayLabel(selectedDate)}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(byDate.get(selectedDate) ?? []).map((s) => (
                    <button
                      key={s.startsAt}
                      onClick={() => setChosen(s)}
                      className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      {formatWallTime(s.localTime)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </PublicCard>
  )
}

function PickerSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 w-16 shrink-0 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  )
}

function DetailsForm({
  type,
  slot,
  tz,
  onBack,
  onBooked,
  onSlotGone,
}: {
  type: PublicType
  slot: Slot
  tz: string
  onBack: () => void
  onBooked: (c: Confirmation) => void
  onSlotGone: () => void
}) {
  const [form, setForm] = React.useState({ name: '', email: '', phone: '', notes: '', company: '' })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    setFormError(null)
    const payload = {
      typeSlug: type.slug,
      startsAt: slot.startsAt,
      bookerTimezone: tz,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      company: form.company, // honeypot
    }
    const parsed = PublicBookingInput.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(fe)) if (v?.[0]) next[k] = v[0]
      setErrors(next)
      return
    }
    setSubmitting(true)
    const res = await postJson<{ ok: boolean; confirmation: Confirmation }>('/api/public/booking', parsed.data)
    setSubmitting(false)
    if (!res.ok) {
      const reason = res.error.reason
      if (reason === 'taken' || reason === 'unavailable') return onSlotGone()
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      setFormError(fe.message)
      return
    }
    onBooked(res.data.confirmation)
  }

  return (
    <PublicCard subtitle="Confirm your details" className="max-w-2xl">
      <div className="rounded-lg border border-border bg-accent/30 px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{type.name}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {fullWhen(slot.startsAt, tz)} · {type.durationMinutes} min
        </div>
        <div className="text-xs text-muted-foreground">Times shown in {tz}</div>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Field id="bk-name" label="Full name" required error={errors.name}>
          <Input name="name" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bk-email" label="Email" required error={errors.email} hint="Your confirmation is sent here">
            <Input name="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="bk-phone" label="Phone" error={errors.phone} hint="Optional">
            <Input name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
        </div>
        <Field id="bk-notes" label="Anything we should know?" error={errors.notes} hint="Optional">
          <Textarea name="notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {/* Honeypot — hidden from humans + assistive tech; bots that fill it are dropped. */}
        <div className="sr-only" aria-hidden>
          <label htmlFor="bk-company">Company</label>
          <input id="bk-company" name="company" tabIndex={-1} autoComplete="off" value={form.company} onChange={(e) => set('company', e.target.value)} />
        </div>

        {formError ? <PublicAlert>{formError}</PublicAlert> : null}

        <p className="text-xs text-muted-foreground">
          By booking, you agree to receive email about this appointment. This is a request to meet; it is not an offer
          of insurance or a securities recommendation.
        </p>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={submitting}>
            {submitting ? 'Booking…' : 'Confirm booking'}
          </Button>
          <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
            Back
          </Button>
        </div>
      </form>
    </PublicCard>
  )
}

function BookingConfirmed({ confirmation, onBookAnother }: { confirmation: Confirmation; onBookAnother: () => void }) {
  function downloadIcs() {
    const ics = buildIcs({
      uid: `${confirmation.reference}@fsos`,
      title: confirmation.typeName,
      description: modeNote(confirmation.meetingMode).replace(/&rsquo;/g, '’'),
      startsAt: confirmation.startsAt,
      endsAt: confirmation.endsAt,
    })
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `appointment-${confirmation.reference}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <PublicCard subtitle="You're booked" className="max-w-2xl">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-won/15 text-status-won" aria-hidden>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.29 6.8-6.8a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">Your meeting is confirmed</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirmation <span className="font-mono font-medium text-foreground">{confirmation.reference}</span>
          </p>
        </div>
      </div>

      <dl className="mt-5 space-y-2 rounded-lg border border-border bg-accent/30 px-4 py-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">What</dt>
          <dd className="text-right font-medium text-foreground">{confirmation.typeName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">When</dt>
          <dd className="text-right font-medium text-foreground">{fullWhen(confirmation.startsAt, confirmation.bookerTimezone)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Timezone</dt>
          <dd className="text-right text-foreground">{confirmation.bookerTimezone}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Format</dt>
          <dd className="text-right text-foreground">{meetingModeLabel(confirmation.meetingMode)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-muted-foreground">
        {modeNote(confirmation.meetingMode, confirmation.meetingStatus).replace(/&rsquo;/g, '’')}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {confirmation.joinUrl ? (
          <Button asChild>
            <a href={confirmation.joinUrl} target="_blank" rel="noopener noreferrer">
              Join video meeting
            </a>
          </Button>
        ) : null}
        <Button variant="outline" onClick={downloadIcs}>
          Add to calendar
        </Button>
        <Button variant="ghost" onClick={onBookAnother}>
          Book another
        </Button>
      </div>
    </PublicCard>
  )
}
