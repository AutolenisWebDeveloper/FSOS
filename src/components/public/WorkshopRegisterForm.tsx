'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, CalendarDays, MapPin, Video } from 'lucide-react'
import { postJson, firstFieldError } from '@/lib/client/api'
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
  const [consentEmail, setConsentEmail] = React.useState(false)
  const [consentSms, setConsentSms] = React.useState(false)
  const [delivery, setDelivery] = React.useState<'in_person' | 'virtual'>(
    workshop.delivery_mode === 'virtual' ? 'virtual' : 'in_person',
  )
  const [company, setCompany] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErr, setFieldErr] = React.useState<string | undefined>()

  const isHybrid = workshop.delivery_mode === 'hybrid'
  const when = workshop.scheduled_at
    ? new Date(workshop.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErr(undefined)
    if (consentSms && !phone.trim()) {
      setFieldErr('phone')
      setError('A phone number is required to receive SMS reminders.')
      return
    }
    setBusy(true)
    const res = await postJson<{ join_token?: string }>('/api/public/workshops/register', {
      workshop_id: workshop.workshop_id,
      session_id: workshop.session_id ?? undefined,
      name,
      email,
      phone: phone || undefined,
      chosen_delivery: isHybrid ? delivery : workshop.delivery_mode === 'virtual' ? 'virtual' : 'in_person',
      consent_email: consentEmail,
      consent_sms: consentSms,
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

      {done ? (
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
          <Field id="phone" label="Phone" hint={consentSms ? 'Required for SMS reminders.' : 'Optional.'} error={fieldErr === 'phone' ? error ?? undefined : undefined}>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={fieldErr === 'phone'} />
          </Field>

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

          <fieldset className="space-y-2 rounded-md border border-border bg-muted/50 p-4">
            <legend className="px-1 text-sm font-medium text-foreground">Contact permission (optional)</legend>
            <label className="flex items-start gap-2 text-sm text-foreground/80">
              <input type="checkbox" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>Email me about this and future educational workshops.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-foreground/80">
              <input type="checkbox" checked={consentSms} onChange={(e) => setConsentSms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>Text me event reminders (SMS).</span>
            </label>
            {workshop.sms_disclosure ? (
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">{workshop.sms_disclosure}</p>
            ) : null}
            <p className="px-1 text-xs text-muted-foreground">
              See our{' '}
              <Link href="/sms-terms" className="underline hover:text-foreground">SMS Terms</Link> and{' '}
              <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>. Registering does not require consent.
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
