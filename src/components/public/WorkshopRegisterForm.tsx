'use client'

import * as React from 'react'
import { CheckCircle2, CalendarDays, MapPin } from 'lucide-react'
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
}

// Public workshop registration form (docs/legacy-port.md §2.5). Captures consent +
// honeypot; posts to the public register route. Educational events only.
export function WorkshopRegisterForm({ workshop }: { workshop: PublicWorkshop }) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [consentEmail, setConsentEmail] = React.useState(false)
  const [consentSms, setConsentSms] = React.useState(false)
  const [company, setCompany] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const when = workshop.scheduled_at
    ? new Date(workshop.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await postJson('/api/public/workshops/register', {
      workshop_id: workshop.workshop_id,
      name,
      email,
      phone: phone || undefined,
      consent_email: consentEmail,
      consent_sms: consentSms,
      company,
    })
    setBusy(false)
    if (!res.ok) {
      setError(firstFieldError(res.error).message)
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
          <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden /> {workshop.location ?? 'Details to follow'}
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
          <Field id="name" label="Full name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field id="email" label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field id="phone" label="Phone" hint="Optional.">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          </Field>

          <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="company">Company</label>
            <input id="company" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>

          <fieldset className="space-y-2 rounded-md border border-border bg-muted/50 p-4">
            <legend className="px-1 text-sm font-medium text-foreground">Contact permission</legend>
            <label className="flex items-start gap-2 text-sm text-foreground/80">
              <input type="checkbox" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>Email me about this and future educational workshops.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-foreground/80">
              <input type="checkbox" checked={consentSms} onChange={(e) => setConsentSms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>Text me event reminders (SMS). Message &amp; data rates may apply.</span>
            </label>
          </fieldset>

          {error ? (
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
