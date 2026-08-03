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
import { postJson } from '@/lib/client/api'
import type { ApiError } from '@/lib/client/api'
import { PublicBookingInput, isValidIanaZone } from '@/lib/booking/config-schemas'
import type { PublicBookingInputType } from '@/lib/booking/config-schemas'
import { COMMON_TIMEZONES, meetingModeLabel } from '@/lib/booking/display'
import { SlotTimeList } from './SlotTimeList'
import { groupSlotsByDay } from './month-grid'
import {
  type MonthCursor,
  monthPrefixOf,
  addMonths,
  fetchFromKey,
  firstOpenDayInMonth,
  initialMonth,
} from './calendar-model'
import { deriveStep, BOOKING_STEPS } from './step-model'
import { BookingStepper } from './BookingStepper'
import { CalendarMonth } from './CalendarMonth'
import { ReviewSummary } from './ReviewSummary'
import { buildIcs } from '@/lib/booking/ics'
import { BUSINESS, CONTACT, SMS_CONSENT } from '@/lib/site'

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
type FormState = { name: string; email: string; phone: string; notes: string; company: string }

// The visible month grid is 6 weeks. Fetching 42 days from the first of the month covers the
// in-month + trailing-week cells (leading filler belongs to the previous month) and stays within
// the availability API's 45-day clamp. The engine remains authoritative for what is actually open.
const FETCH_DAYS = 42

// Fields the intake form renders inline; anything else that fails validation is surfaced generically.
const KNOWN_FIELDS = new Set(['name', 'email', 'phone', 'notes'])

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
/** Full date + time in the booker's chosen zone. */
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
/** "Monday, August 3" — the selected-day heading over the time list. */
function selectedDayLabel(dateKey: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(`${dateKey}T12:00:00Z`),
  )
}
function modeNote(mode: string, status?: 'none' | 'provisioned' | 'pending'): string {
  if (mode === 'video') {
    return status === 'provisioned'
      ? 'Use the video link below to join. It’s also in your confirmation email.'
      : 'A video meeting link will be included in your confirmation email.'
  }
  if (mode === 'phone') return 'We’ll call you at the number you provided at the scheduled time.'
  return 'Meeting location details will be included in your confirmation email.'
}
/** Map a failed submit to safe, plain-language copy — never surfaces internal detail (§16). */
function bookingErrorMessage(status: number): string {
  if (status === 429) return 'Too many requests right now. Please wait a moment, then try again.'
  if (status === 0) return 'We couldn’t reach the server. Check your connection and try again.'
  return 'We couldn’t complete your booking. Please try again in a moment.'
}

export function BookingFlow({ type, backHref }: { type: PublicType; backHref?: string }) {
  const [tz, setTz] = React.useState<string>('America/Chicago')
  const [today, setToday] = React.useState<string>('') // YYYY-MM-DD, booker-local
  const [monthCursor, setMonthCursor] = React.useState<MonthCursor | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [slots, setSlots] = React.useState<Slot[]>([])
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null)
  const [chosen, setChosen] = React.useState<Slot | null>(null)

  // Details form state is lifted here so it survives details → review → edit round-trips.
  const [form, setForm] = React.useState<FormState>({ name: '', email: '', phone: '', notes: '', company: '' })
  // Separate, affirmative, default-UNCHECKED SMS opt-in (P5.3). Never inferred; independent of
  // the email opt-in; kept in its own state (a boolean, not a FormState string field).
  const [smsOptIn, setSmsOptIn] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [reviewing, setReviewing] = React.useState(false)
  const [payload, setPayload] = React.useState<PublicBookingInputType | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null)
  const confirmInFlight = React.useRef(false)

  // Detect the booker's timezone once, client-side, and seed the cursor at the current month.
  React.useEffect(() => {
    const detected = detectTimezone()
    const t = localTodayISO(detected)
    setTz(detected)
    setToday(t)
    setMonthCursor(initialMonth(t))
  }, [])

  // Monotonic request id: month paging / timezone switches fire overlapping fetches, so we ignore
  // any response that isn't the latest (last-resolved-wins would otherwise show the wrong month).
  const reqSeq = React.useRef(0)
  const loadAvailability = React.useCallback(
    async (zone: string, cursor: MonthCursor, todayKey: string) => {
      const seq = ++reqSeq.current
      setLoading(true)
      setLoadError(null)
      // Fetch from the later of today or the first of the visible month (never request the past).
      const from = fetchFromKey(cursor, todayKey)
      const monthPrefix = monthPrefixOf(cursor)
      try {
        const params = new URLSearchParams({ type: type.slug, tz: zone, from, days: String(FETCH_DAYS) })
        const res = await fetch(`/api/public/booking/availability?${params.toString()}`)
        const json = await res.json().catch(() => ({}))
        if (seq !== reqSeq.current) return // superseded by a newer request — drop stale data
        if (!res.ok) {
          setLoadError('We couldn’t load available times. Please try again.')
          setSlots([])
          setSelectedDay(null)
          return
        }
        const next = (json.slots ?? []) as Slot[]
        setSlots(next)
        // Auto-select the first open day IN THE VISIBLE MONTH so the calendar and the time list
        // always agree. The 42-day fetch can spill into the next month; those days render as
        // trailing, non-selectable cells and must never become the selection.
        setSelectedDay(firstOpenDayInMonth(groupSlotsByDay(next).keys(), monthPrefix))
      } catch {
        if (seq !== reqSeq.current) return
        setLoadError('We couldn’t reach the server. Please check your connection and try again.')
        setSlots([])
        setSelectedDay(null)
      } finally {
        if (seq === reqSeq.current) setLoading(false)
      }
    },
    [type.slug],
  )

  React.useEffect(() => {
    if (tz && today && monthCursor) loadAvailability(tz, monthCursor, today)
  }, [tz, today, monthCursor, loadAvailability])

  const byDay = React.useMemo(() => groupSlotsByDay(slots), [slots])
  const availableDayKeys = React.useMemo(() => new Set(byDay.keys()), [byDay])

  const current = deriveStep({ hasType: true, hasSlot: !!chosen, reviewing, confirmed: !!confirmation })
  // A single-type booking (no chooser → no backHref) never performs a "Meeting type" step, so it's
  // omitted from the stepper; a multi-type booking chose a type on the landing, so it's shown done.
  const stepperSteps = backHref ? BOOKING_STEPS : BOOKING_STEPS.filter((s) => s !== 'type')

  function refetch() {
    if (tz && today && monthCursor) loadAvailability(tz, monthCursor, today)
  }

  function handleSlotGone() {
    setChosen(null)
    setReviewing(false)
    setPayload(null)
    setFormError(null)
    toast.error('That time was just taken. Please pick another.')
    refetch()
  }

  function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!chosen) return
    setErrors({})
    setFormError(null)
    const candidate = {
      typeSlug: type.slug,
      startsAt: chosen.startsAt,
      bookerTimezone: tz,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      sms_opt_in: smsOptIn, // separate affirmative SMS consent (default false)
      company: form.company, // honeypot — passed through unmodified
    }
    const parsed = PublicBookingInput.safeParse(candidate)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      const next: Record<string, string> = {}
      let hasUnknown = false
      for (const [k, v] of Object.entries(fe)) {
        if (v?.[0]) {
          next[k] = v[0]
          if (!KNOWN_FIELDS.has(k)) hasUnknown = true
        }
      }
      setErrors(next)
      if (hasUnknown) setFormError('Please check your details and try again.')
      return
    }
    setPayload(parsed.data)
    setReviewing(true)
  }

  async function handleConfirm() {
    // Ref latch closes the micro-window before `submitting` re-renders the button disabled —
    // two synchronous clicks can't both POST (server double-booking guard is the backstop).
    if (!payload || confirmInFlight.current) return
    confirmInFlight.current = true
    setSubmitting(true)
    setFormError(null)
    let res
    try {
      res = await postJson<{ ok: boolean; confirmation: Confirmation }>('/api/public/booking', payload)
    } finally {
      setSubmitting(false)
      confirmInFlight.current = false
    }
    if (!res.ok) {
      const reason = res.error.reason
      if (reason === 'taken' || reason === 'unavailable') return handleSlotGone()
      if (res.status === 400) {
        // Fell out of validation on the server — send the booker back to fix their details.
        const fe = (res.error as ApiError).details?.fieldErrors
        const next: Record<string, string> = {}
        if (fe) for (const [k, v] of Object.entries(fe)) if (v?.[0] && KNOWN_FIELDS.has(k)) next[k] = v[0]
        setErrors(next)
        setReviewing(false)
        setFormError(Object.keys(next).length ? null : 'Please check your details and try again.')
        return
      }
      setFormError(bookingErrorMessage(res.status))
      return
    }
    setConfirmation(res.data.confirmation)
  }

  function handleEdit(step: 'slot' | 'details') {
    setReviewing(false)
    setFormError(null)
    if (step === 'slot') {
      setChosen(null)
      setPayload(null)
      refetch()
    }
  }

  function handleBookAnother() {
    setConfirmation(null)
    setChosen(null)
    setReviewing(false)
    setPayload(null)
    setForm({ name: '', email: '', phone: '', notes: '', company: '' })
    setSmsOptIn(false)
    setErrors({})
    setFormError(null)
    setSelectedDay(null)
    setMonthCursor(initialMonth(today)) // returns to the current month + triggers a refetch
  }

  const setField = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // ── Success step ─────────────────────────────────────────────────────────────
  if (confirmation) {
    return (
      <div className="w-full">
        <BookingStepper current={current} steps={stepperSteps} />
        <BookingConfirmed confirmation={confirmation} bookerEmail={form.email || null} onBookAnother={handleBookAnother} />
      </div>
    )
  }

  // ── Review step ──────────────────────────────────────────────────────────────
  if (reviewing && chosen) {
    return (
      <div className="w-full">
        <BookingStepper current={current} steps={stepperSteps} />
        <ReviewSummary
          typeName={type.name}
          startsAt={chosen.startsAt}
          timezone={tz}
          durationMinutes={type.durationMinutes}
          meetingMode={type.meetingMode}
          name={form.name.trim()}
          email={form.email.trim()}
          phone={form.phone.trim() || null}
          onEdit={handleEdit}
          onConfirm={handleConfirm}
          submitting={submitting}
          error={formError}
        />
      </div>
    )
  }

  // ── Details step ─────────────────────────────────────────────────────────────
  if (chosen) {
    return (
      <div className="w-full">
        <BookingStepper current={current} steps={stepperSteps} />
        <DetailsForm
          type={type}
          slot={chosen}
          tz={tz}
          values={form}
          smsOptIn={smsOptIn}
          errors={errors}
          formError={formError}
          onChange={setField}
          onSmsOptInChange={setSmsOptIn}
          onSubmit={handleDetailsSubmit}
          onBack={() => handleEdit('slot')}
        />
      </div>
    )
  }

  // ── Slot-picker step ─────────────────────────────────────────────────────────
  // Openings are counted for the VISIBLE month only — a next-month day inside the 42-day fetch
  // window must not suppress this month's empty state (and selectedDay is always in-month).
  const monthPrefix = monthCursor ? monthPrefixOf(monthCursor) : ''
  const dayCount = [...byDay.keys()].filter((k) => k.startsWith(monthPrefix)).length
  const daySlots = selectedDay ? byDay.get(selectedDay) ?? [] : []

  return (
    <div className="w-full">
      <BookingStepper current={current} steps={stepperSteps} />
      <PublicCard
        subtitle={`${type.durationMinutes}-minute ${meetingModeLabel(type.meetingMode).toLowerCase()} meeting`}
        className="max-w-2xl"
      >
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
            onChange={(e) => {
              const z = e.target.value || tz
              setTz(z)
              // Keep "today" in the CHOSEN zone so day past/available classification stays correct.
              setToday(localTodayISO(z))
            }}
            className="h-8 w-auto min-w-[12rem] text-sm"
          >
            {!COMMON_TIMEZONES.includes(tz as (typeof COMMON_TIMEZONES)[number]) ? (
              <option value="">{tz} (detected)</option>
            ) : null}
            {COMMON_TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4">
          {loadError ? (
            <div className="space-y-3">
              <PublicAlert>{loadError}</PublicAlert>
              <Button variant="outline" size="sm" onClick={refetch}>
                Try again
              </Button>
            </div>
          ) : loading || !monthCursor ? (
            <PickerSkeleton />
          ) : (
            <div className="grid gap-5 md:grid-cols-[minmax(0,20rem)_1fr]">
              <CalendarMonth
                availableDayKeys={availableDayKeys}
                todayKey={today}
                monthCursor={monthCursor}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                onMonthChange={(delta) => setMonthCursor((c) => (c ? addMonths(c, delta) : c))}
              />

              <div className="min-w-0">
                {dayCount === 0 ? (
                  <div className="flex h-full flex-col justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-sm font-medium text-foreground">No openings this month</p>
                    <p className="mt-1 text-sm text-muted-foreground">Use the arrows to check another month.</p>
                    <div className="mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMonthCursor((c) => (c ? addMonths(c, 1) : c))}
                      >
                        Next month →
                      </Button>
                    </div>
                  </div>
                ) : selectedDay ? (
                  <SlotTimeList dayLabel={selectedDayLabel(selectedDay)} slots={daySlots} onPick={setChosen} />
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
    </div>
  )
}

function PickerSkeleton() {
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

function ErrorSummary({ errors }: { errors: Record<string, string> }) {
  const entries = Object.entries(errors).filter(([k]) => KNOWN_FIELDS.has(k))
  if (entries.length === 0) return null
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3">
      <p className="text-sm font-semibold text-destructive">Please fix the following before continuing:</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-destructive">
        {entries.map(([field, message]) => (
          <li key={field}>
            <a href={`#bk-${field}`} className="underline underline-offset-2">
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DetailsForm({
  type,
  slot,
  tz,
  values,
  smsOptIn,
  errors,
  formError,
  onChange,
  onSmsOptInChange,
  onSubmit,
  onBack,
}: {
  type: PublicType
  slot: Slot
  tz: string
  values: FormState
  smsOptIn: boolean
  errors: Record<string, string>
  formError: string | null
  onChange: (k: keyof FormState, v: string) => void
  onSmsOptInChange: (v: boolean) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
}) {
  return (
    <PublicCard subtitle="Your details" className="max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground">Confirm your details</h1>

      <div className="mt-3 rounded-lg border border-border bg-accent/30 px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{type.name}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {fullWhen(slot.startsAt, tz)} · {type.durationMinutes} min
        </div>
        <div className="text-xs text-muted-foreground">Times shown in {tz}</div>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
        {Object.keys(errors).some((k) => KNOWN_FIELDS.has(k)) ? <ErrorSummary errors={errors} /> : null}

        <Field id="bk-name" label="Full name" required error={errors.name}>
          <Input
            name="name"
            autoComplete="name"
            value={values.name}
            onChange={(e) => onChange('name', e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bk-email" label="Email" required error={errors.email} hint="Your confirmation is sent here">
            <Input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={values.email}
              onChange={(e) => onChange('email', e.target.value)}
            />
          </Field>
          <Field
            id="bk-phone"
            label="Phone"
            required={smsOptIn}
            error={errors.phone}
            hint={smsOptIn ? 'Required to receive text messages' : 'Optional — helpful for phone meetings'}
          >
            <Input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required={smsOptIn}
              aria-required={smsOptIn}
              value={values.phone}
              onChange={(e) => onChange('phone', e.target.value)}
            />
          </Field>
        </div>
        <Field id="bk-notes" label="Anything we should know?" error={errors.notes} hint="Optional">
          <Textarea name="notes" rows={3} value={values.notes} onChange={(e) => onChange('notes', e.target.value)} />
        </Field>

        {/* Honeypot — hidden from humans + assistive tech; bots that fill it are dropped. */}
        <div className="sr-only" aria-hidden>
          <label htmlFor="bk-company">Company</label>
          <input
            id="bk-company"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={values.company}
            onChange={(e) => onChange('company', e.target.value)}
          />
        </div>

        {formError ? <PublicAlert>{formError}</PublicAlert> : null}

        {/* Separate, affirmative, default-UNCHECKED SMS opt-in (P5.3 / TCPA prior express written
            consent). Independent of the email opt-in below — never pre-checked, never inferred.
            The label is SMS_CONSENT.disclosure verbatim (the exact wording persisted as the TCPA
            evidence-of-record), so the text shown and the text stored can never drift. */}
        <div className="rounded-lg border border-border bg-accent/20 px-4 py-3">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="bk-sms-consent"
              name="sms_consent"
              checked={smsOptIn}
              onChange={(e) => onSmsOptInChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            <label htmlFor="bk-sms-consent" className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Text me about this appointment (optional).</span>{' '}
              {SMS_CONSENT.disclosure}
            </label>
          </div>
          <p className="mt-2 pl-7 text-xs text-muted-foreground">
            Consent is not a condition of booking. No mobile information is shared with third parties for marketing.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          By booking, you agree to receive email about this appointment. This is a request to meet; it is not an offer
          of insurance or a securities recommendation.
        </p>

        <div className="flex items-center gap-2">
          <Button type="submit">Continue to review</Button>
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      </form>
    </PublicCard>
  )
}

function BookingConfirmed({
  confirmation,
  bookerEmail,
  onBookAnother,
}: {
  confirmation: Confirmation
  bookerEmail: string | null
  onBookAnother: () => void
}) {
  function downloadIcs() {
    const ics = buildIcs({
      uid: `${confirmation.reference}@fsos`,
      title: confirmation.typeName,
      description: modeNote(confirmation.meetingMode),
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
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-won/15 text-status-won"
          aria-hidden
        >
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

      <dl className="mt-5 divide-y divide-border rounded-lg border border-border bg-accent/30 px-4 py-1 text-sm">
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-muted-foreground">What</dt>
          <dd className="text-right font-medium text-foreground">{confirmation.typeName}</dd>
        </div>
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-muted-foreground">When</dt>
          <dd className="text-right font-medium text-foreground">
            {fullWhen(confirmation.startsAt, confirmation.bookerTimezone)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Timezone</dt>
          <dd className="text-right text-foreground">{confirmation.bookerTimezone}</dd>
        </div>
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="text-right text-foreground">{confirmation.durationMinutes} min</dd>
        </div>
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-muted-foreground">Format</dt>
          <dd className="text-right text-foreground">{meetingModeLabel(confirmation.meetingMode)}</dd>
        </div>
      </dl>

      {/* Next steps — neutral email copy (we don't claim delivery, only that it's on its way). */}
      <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
        <div className="mono-label text-muted-foreground">What happens next</div>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>
            A confirmation email is on its way{bookerEmail ? <> to <span className="text-foreground">{bookerEmail}</span></> : null}.
          </li>
          <li>{modeNote(confirmation.meetingMode, confirmation.meetingStatus)}</li>
          <li>Need to change it? Use the reschedule or cancel link in that email.</li>
        </ul>
      </div>

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

      <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
        Questions? Contact {BUSINESS.agent} at{' '}
        <a href={`tel:${CONTACT.phoneE164}`} className="font-medium text-foreground underline underline-offset-2">
          {CONTACT.phoneDisplay}
        </a>{' '}
        or{' '}
        <a href={`mailto:${CONTACT.email}`} className="font-medium text-foreground underline underline-offset-2">
          {CONTACT.email}
        </a>
        .
      </p>
    </PublicCard>
  )
}
