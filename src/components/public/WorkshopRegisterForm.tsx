'use client'

import * as React from 'react'
import { CheckCircle2, Loader2, CalendarDays, MapPin } from 'lucide-react'
import { postJson, firstFieldError } from '@/lib/client/api'

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
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium capitalize text-blue-700">
        {workshop.topic}
      </span>
      <h1 className="mt-3 text-xl font-semibold text-slate-900">{workshop.title}</h1>
      {workshop.description ? <p className="mt-1 text-sm text-slate-600">{workshop.description}</p> : null}
      <div className="mt-4 space-y-1.5 text-sm text-slate-700">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden /> {when}
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-slate-400" aria-hidden /> {workshop.location ?? 'Details to follow'}
        </div>
      </div>

      {done ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" aria-hidden />
          <p className="mt-2 font-medium text-slate-900">You&apos;re registered!</p>
          <p className="mt-1 text-sm text-slate-600">We&apos;ll be in touch with details before the event.</p>
        </div>
      ) : workshop.is_full ? (
        <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This workshop is currently full. Please check back for future sessions.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field id="name" label="Full name" required value={name} onChange={setName} />
          <Field id="email" label="Email" type="email" required value={email} onChange={setEmail} />
          <Field id="phone" label="Phone (optional)" type="tel" value={phone} onChange={setPhone} />

          <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="company">Company</label>
            <input id="company" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>

          <fieldset className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
            <legend className="px-1 text-sm font-medium text-slate-800">Contact permission</legend>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} className="mt-0.5" />
              <span>Email me about this and future educational workshops.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={consentSms} onChange={(e) => setConsentSms(e.target.checked)} className="mt-0.5" />
              <span>Text me event reminders (SMS). Message &amp; data rates may apply.</span>
            </label>
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Registering…
              </>
            ) : (
              'Register'
            )}
          </button>
          {workshop.seats_remaining != null ? (
            <p className="text-xs text-slate-500">{workshop.seats_remaining} seats remaining.</p>
          ) : null}
        </form>
      )}
    </div>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === 'email' ? 'email' : 'off'}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  )
}
