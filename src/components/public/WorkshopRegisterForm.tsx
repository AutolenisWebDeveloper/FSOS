'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, CalendarDays, MapPin, Video } from 'lucide-react'
import { postJson, firstFieldError } from '@/lib/client/api'
import { SMS_REMINDER_DISCLOSURE, MARKETING_OPT_IN_LABEL } from '@/lib/workshops/consent-copy'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export interface PublicWorkshop {
  workshop_id: string
  title: string
  topic: string
  description: string | null
  scheduled_at: string | null
  location: string | null
  seats_remaining: number | null
  is_full: boolean
  // Seminar-engine additions (all optional so the legacy /events/[id] page still works).
  slug?: string | null
  delivery_mode?: 'in_person' | 'virtual' | 'hybrid' | null
  session_id?: string | null
  /** Approved disclosure text to render by the SMS consent box (never placeholder). */
  sms_disclosure?: string | null
  /** Where to send the registrant after success (the /confirmed page). */
  confirm_url?: string | null
}

// Public workshop registration form (spec §D). Consent is captured with separate,
// unchecked, optional email + SMS boxes; a phone is only required if SMS is ticked;
// registration itself is never conditioned on consent. Honeypot preserved. Educational
// events only — no securities data, no product recommendation.
export function WorkshopRegisterForm({ workshop }: { workshop: PublicWorkshop }) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [marketingOptIn, setMarketingOptIn] = React.useState(false)
  const [delivery, setDelivery] = React.useState<'in_person' | 'virtual'>(
    workshop.delivery_mode === 'virtual' ? 'virtual' : 'in_person',
  )
  const [company, setCompany] = React.useState('')
  const [guests, setGuests] = React.useState(0)
  const [alreadyRegistered, setAlreadyRegistered] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErr, setFieldErr] = React.useState<string | undefined>()

  const isHybrid = workshop.delivery_mode === 'hybrid'
  // D-7: guests consume IN-PERSON seats only — the field renders only when the registrant
  // is attending in person.
  const attendingInPerson = isHybrid ? delivery === 'in_person' : workshop.delivery_mode !== 'virtual'
  const when = workshop.scheduled_at
    ? new Date(workshop.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErr(undefined)
    setBusy(true)
    const res = await postJson<{ join_token?: string; already_registered?: boolean }>('/api/public/workshops/register', {
      workshop_id: workshop.workshop_id,
      session_id: workshop.session_id ?? undefined,
      name,
      email,
      phone: phone || undefined,
      chosen_delivery: isHybrid ? delivery : workshop.delivery_mode === 'virtual' ? 'virtual' : 'in_person',
      marketing_opt_in: marketingOptIn,
      guest_count: attendingInPerson ? guests : 0,
      lead_source: 'workshop',
      company,
    })
    setBusy(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      setFieldErr(fe.field)
      setError(fe.message)
      return
    }
    if (res.data && res.data.already_registered) {
      // WS-024: a duplicate submit is a STATE, not an error — and never a second seat.
      setAlreadyRegistered(true)
      return
    }
    if (workshop.confirm_url) {
      window.location.assign(workshop.confirm_url)
      return
    }
    setDone(true)
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-elev-xs sm:p-8">
      <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium capitalize text-primary">
        {workshop.topic}
      </span>
      <h1 className="mt-3 text-xl font-semibold text-foreground">{workshop.title}</h1>
      {workshop.description ? <p className="mt-1 text-sm text-muted-foreground">{workshop.description}</p> : null}
      <div className="mt-4 space-y-1.5 text-sm text-foreground/80">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden /> {when}
        </div>
        <div className="flex items-center gap-2">
          {workshop.delivery_mode === 'virtual' ? (
            <Video className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          {workshop.location ?? (workshop.delivery_mode === 'virtual' ? 'Online' : 'Details to follow')}
        </div>
      </div>

      {alreadyRegistered ? (
        <div className="mt-6 rounded-lg border border-border bg-muted p-6 text-center" role="status" aria-live="polite">
          <CheckCircle2 className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium text-foreground">You&apos;re already registered</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This email already holds a seat for this workshop — no second seat was taken. Your
            original confirmation and reminders still apply.
          </p>
        </div>
      ) : done ? (
        <div className="mt-6 rounded-lg border border-status-won/20 bg-status-won/10 p-6 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-status-won" aria-hidden />
          <p className="mt-2 font-medium text-foreground">You&apos;re registered!</p>
          <p className="mt-1 text-sm text-muted-foreground">We&apos;ll be in touch with details before the event.</p>
        </div>
      ) : workshop.is_full ? (
        <p className="mt-6 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground/80">
          This workshop is currently full. Please check back for future sessions.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field id="name" label="Full name" required error={fieldErr === 'name' ? error ?? undefined : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={fieldErr === 'name'} />
          </Field>
          <Field id="email" label="Email" required error={fieldErr === 'email' ? error ?? undefined : undefined}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={fieldErr === 'email'} />
          </Field>
          <Field id="phone" label="Phone (optional)" hint={SMS_REMINDER_DISCLOSURE} error={fieldErr === 'phone' ? error ?? undefined : undefined}>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={fieldErr === 'phone'} />
          </Field>

          {attendingInPerson ? (
            <Field id="guests" label="Guests you're bringing">
              <select
                id="guests"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
              >
                <option value={0}>Just me</option>
                <option value={1}>+1 guest</option>
                <option value={2}>+2 guests</option>
                <option value={3}>+3 guests</option>
                <option value={4}>+4 guests</option>
              </select>
            </Field>
          ) : null}


          {isHybrid ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">How will you attend?</legend>
              <div className="flex gap-2">
                {(['in_person', 'virtual'] as const).map((opt) => (
                  <label
                    key={opt}
                    className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm ${
                      delivery === opt ? 'border-primary bg-primary-soft text-primary' : 'border-border text-foreground/80'
                    }`}
                  >
                    <input type="radio" name="delivery" value={opt} checked={delivery === opt} onChange={() => setDelivery(opt)} className="sr-only" />
                    {opt === 'in_person' ? 'In person' : 'Online'}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="company">Company</label>
            <input id="company" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>

          {/* SETTLED model (D-3): ONE unchecked box, POST-EVENT MARKETING only — the
              reminder basis is the registration itself (disclosure at the phone field). */}
          <fieldset className="space-y-2 rounded-md border border-border bg-muted/50 p-4">
            <legend className="px-1 text-sm font-medium text-foreground">Optional</legend>
            <label className="flex items-start gap-2 text-sm text-foreground/80">
              <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>{MARKETING_OPT_IN_LABEL}</span>
            </label>
            {workshop.sms_disclosure ? (
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">{workshop.sms_disclosure}</p>
            ) : null}
            <p className="px-1 text-xs text-muted-foreground">
              See our{' '}
              <Link href="/sms-terms" className="underline hover:text-foreground">SMS Terms</Link> and{' '}
              <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>. Registering does not require this.
            </p>
          </fieldset>

          {error && fieldErr === undefined ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={busy}>
            {busy ? 'Registering…' : 'Register'}
          </Button>
          {workshop.seats_remaining != null ? (
            <p className="text-xs text-muted-foreground">{workshop.seats_remaining} seats remaining.</p>
          ) : null}
        </form>
      )}
    </div>
  )
}
