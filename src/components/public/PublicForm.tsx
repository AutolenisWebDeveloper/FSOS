'use client'

import * as React from 'react'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { postJson, firstFieldError } from '@/lib/client/api'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

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
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-elev-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-won/10">
          <CheckCircle2 className="h-6 w-6 text-status-won" aria-hidden />
        </div>
        <h2 className="mt-3 text-lg font-semibold text-foreground">Thank you</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your response has been received. A licensed specialist will follow up with you.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-6 shadow-elev-xs sm:p-8">
      <h1 className="text-xl font-semibold text-foreground">{template.name}</h1>
      {template.description ? <p className="mt-1 text-sm text-muted-foreground">{template.description}</p> : null}

      <div className="mt-6 space-y-4">
        {template.fields.map((f) => (
          <Field key={f.key} id={`f-${f.key}`} label={f.label} required={f.required} hint={f.help}>
            {f.type === 'textarea' ? (
              <Textarea
                required={f.required}
                rows={3}
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
              />
            ) : (
              <Input
                type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
                required={f.required}
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                autoComplete={EMAIL_KEYS.includes(f.key) ? 'email' : 'off'}
              />
            )}
          </Field>
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
        <fieldset className="mt-6 space-y-2 rounded-md border border-border bg-muted/50 p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Contact permission</legend>
          <label className="flex items-start gap-2 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={consentEmail}
              onChange={(e) => setConsentEmail(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>I agree to be contacted by email about my financial review.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={consentSms}
              onChange={(e) => setConsentSms(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>I agree to be contacted by text message (SMS). Message &amp; data rates may apply.</span>
          </label>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={busy} className="mt-6">
        {busy ? 'Submitting…' : 'Submit'}
      </Button>

      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Your information is used only to prepare your financial review. We never collect securities account details on
        this form.
      </p>
    </form>
  )
}
