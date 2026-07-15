'use client'

import * as React from 'react'
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { postJson, firstFieldError } from '@/lib/client/api'

export interface PublicFormField {
  key: string
  label: string
  type?: string
  required?: boolean
  options?: string[]
  help?: string
}

export interface PublicFormTemplate {
  slug: string
  name: string
  description: string | null
  captures_consent: boolean
  fields: PublicFormField[]
}

// Envelope keys pulled out of the template fields into the submit envelope so the
// firewall + comms gate see a clean name/email/phone (docs/legacy-port.md §2.3).
const NAME_KEYS = ['full_name', 'name']
const EMAIL_KEYS = ['email']
const PHONE_KEYS = ['phone', 'tel']

// Public client intake form. Renders the template fields, captures consent, carries
// a honeypot, and posts to the public submit route. No securities data is collected.
export function PublicForm({ template, token }: { template: PublicFormTemplate; token?: string }) {
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [consentEmail, setConsentEmail] = React.useState(false)
  const [consentSms, setConsentSms] = React.useState(false)
  const [company, setCompany] = React.useState('') // honeypot
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  function pick(keys: string[]): string | undefined {
    for (const k of keys) if (values[k]) return values[k]
    return undefined
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const full_name = pick(NAME_KEYS)
    const email = pick(EMAIL_KEYS)
    if (!full_name) return setError('Please enter your name.')
    if (!email) return setError('Please enter your email.')

    // Everything not part of the envelope becomes an answer.
    const answers: Record<string, string> = {}
    for (const [k, v] of Object.entries(values)) {
      if (!NAME_KEYS.includes(k) && !EMAIL_KEYS.includes(k) && !PHONE_KEYS.includes(k)) answers[k] = v
    }

    setBusy(true)
    const res = await postJson('/api/public/forms/submit', {
      template_slug: template.slug,
      token,
      full_name,
      email,
      phone: pick(PHONE_KEYS),
      answers,
      consent_email: consentEmail,
      consent_sms: consentSms,
      company, // honeypot — server silently drops if filled
    })
    setBusy(false)
    if (!res.ok) {
      setError(firstFieldError(res.error).message)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
        <h2 className="mt-3 text-lg font-semibold text-slate-900">Thank you</h2>
        <p className="mt-1 text-sm text-slate-600">
          Your response has been received. A licensed specialist will follow up with you.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-slate-900">{template.name}</h1>
      {template.description ? <p className="mt-1 text-sm text-slate-600">{template.description}</p> : null}

      <div className="mt-6 space-y-4">
        {template.fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <label htmlFor={`f-${f.key}`} className="block text-sm font-medium text-slate-800">
              {f.label}
              {f.required ? <span className="text-red-600"> *</span> : null}
            </label>
            {f.type === 'textarea' ? (
              <textarea
                id={`f-${f.key}`}
                required={f.required}
                rows={3}
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            ) : (
              <input
                id={`f-${f.key}`}
                type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
                required={f.required}
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                autoComplete={EMAIL_KEYS.includes(f.key) ? 'email' : 'off'}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
            {f.help ? <p className="text-xs text-slate-500">{f.help}</p> : null}
          </div>
        ))}
      </div>

      {/* Honeypot — hidden from humans; bots fill it and the server drops the write. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company">Company</label>
        <input
          id="company"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </div>

      {template.captures_consent ? (
        <fieldset className="mt-6 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 text-sm font-medium text-slate-800">Contact permission</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={consentEmail}
              onChange={(e) => setConsentEmail(e.target.checked)}
              className="mt-0.5"
            />
            <span>I agree to be contacted by email about my financial review.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={consentSms}
              onChange={(e) => setConsentSms(e.target.checked)}
              className="mt-0.5"
            />
            <span>I agree to be contacted by text message (SMS). Message &amp; data rates may apply.</span>
          </label>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Submitting…
          </>
        ) : (
          'Submit'
        )}
      </button>

      <p className="mt-4 flex items-start gap-1.5 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Your information is used only to prepare your financial review. We never collect securities account details on
        this form.
      </p>
    </form>
  )
}
