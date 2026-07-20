'use client'

import * as React from 'react'
import Link from 'next/link'
import { Send, CheckCircle2, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { SMS_CONSENT } from '@/lib/site'

const INTERESTS = [
  'Life Insurance',
  'Retirement Planning',
  'Investment Solutions',
  'College Planning',
  'Annuities',
  'Business Protection',
  'Estate & Legacy Planning',
  'Financial Review',
  'General / not sure yet',
] as const

const CONTACT_METHODS = [
  { value: 'no_preference', label: 'No preference' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone call' },
  { value: 'sms', label: 'Text message' },
] as const

type Errors = Partial<Record<'full_name' | 'email' | 'phone' | 'message' | 'form', string>>

export function ContactForm() {
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [errors, setErrors] = React.useState<Errors>({})
  const [smsConsent, setSmsConsent] = React.useState(false)
  const utmRef = React.useRef<Record<string, string>>({})
  const successRef = React.useRef<HTMLDivElement | null>(null)

  // Capture UTM/attribution from the URL, client-side only (no Suspense needed).
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const utm: Record<string, string> = {}
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']) {
      const v = p.get(k)
      if (v) utm[k] = v.slice(0, 200)
    }
    utmRef.current = utm
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const form = e.currentTarget
    const fd = new FormData(form)

    const full_name = String(fd.get('full_name') || '').trim()
    const email = String(fd.get('email') || '').trim()
    const phone = String(fd.get('phone') || '').trim()
    const message = String(fd.get('message') || '').trim()

    // Lightweight client-side validation (the API validates authoritatively).
    const next: Errors = {}
    if (full_name.length < 2) next.full_name = 'Please enter your name.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = 'Enter a valid email address.'
    if (smsConsent && phone.replace(/\D/g, '').length < 10)
      next.phone = 'A valid phone number is required to receive text messages.'
    if (message.length < 5) next.message = 'Tell us a little about how we can help.'
    if (Object.keys(next).length) {
      setErrors(next)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name,
          email,
          phone: phone || undefined,
          preferred_contact: String(fd.get('preferred_contact') || 'no_preference'),
          interest: String(fd.get('interest') || ''),
          message,
          appointment_pref: String(fd.get('appointment_pref') || '').trim() || undefined,
          consent_sms: smsConsent,
          consent_version: SMS_CONSENT.version,
          source_page: window.location.pathname || '/',
          form_name: 'homepage_contact',
          utm: utmRef.current,
          company: String(fd.get('company') || ''), // honeypot
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setErrors({ form: data?.error || 'Something went wrong. Please try again or call the office.' })
        setSubmitting(false)
        return
      }
      setDone(true)
      // Move focus to the confirmation for screen-reader users.
      window.setTimeout(() => successRef.current?.focus(), 40)
    } catch {
      setErrors({ form: 'We couldn’t reach the server. Please try again or call the office.' })
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="flex flex-col items-center rounded-2xl border border-status-won/30 bg-status-won/5 p-8 text-center shadow-elev-xs focus-visible:outline-none"
      >
        <CheckCircle2 className="h-12 w-12 text-status-won" aria-hidden />
        <h3 className="mt-4 text-xl font-bold text-foreground">Message received — thank you</h3>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Markist will personally review your message and follow up soon. If it’s urgent, please call the office
          directly.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-2xl border border-border bg-card p-6 shadow-elev-sm sm:p-8">
      <h3 className="text-xl font-bold tracking-tight text-foreground">Send us a message</h3>
      <p className="mt-1 text-sm text-muted-foreground">We’ll get back to you personally — usually within one business day.</p>

      {errors.form ? (
        <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {errors.form}
        </div>
      ) : null}

      {/* Honeypot — hidden from humans + assistive tech; bots fill it. */}
      <div className="absolute left-[-9999px]" aria-hidden>
        <label htmlFor="company">Company (leave blank)</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="full_name" error={errors.full_name} required>
          <Input id="full_name" name="full_name" autoComplete="name" required error={!!errors.full_name} aria-describedby={errors.full_name ? 'err-full_name' : undefined} />
        </Field>
        <Field label="Email address" htmlFor="email" error={errors.email} required>
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required error={!!errors.email} aria-describedby={errors.email ? 'err-email' : undefined} />
        </Field>
        <Field
          label="Phone number"
          htmlFor="phone"
          error={errors.phone}
          hint="Only needed if you’d like a call or text."
        >
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" error={!!errors.phone} aria-describedby={errors.phone ? 'err-phone' : 'hint-phone'} />
        </Field>
        <Field label="Preferred contact method" htmlFor="preferred_contact">
          <Select id="preferred_contact" name="preferred_contact" defaultValue="no_preference">
            {CONTACT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What can we help with?" htmlFor="interest" className="sm:col-span-2">
          <Select id="interest" name="interest" defaultValue="General / not sure yet">
            {INTERESTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How can we help you?" htmlFor="message" error={errors.message} required className="sm:col-span-2">
          <Textarea id="message" name="message" rows={4} required error={!!errors.message} aria-describedby={errors.message ? 'err-message' : undefined} placeholder="Share a little about your goals or questions…" />
        </Field>
      </div>

      {/* SMS consent — separate, unchecked, not a condition of service. */}
      <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="consent_sms"
            checked={smsConsent}
            onChange={(e) => setSmsConsent(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 rounded border-input text-primary accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <span className="text-[13px] leading-relaxed text-muted-foreground">
            By checking this box, I agree to receive SMS messages from Markist Athelus / Markist Financial Services
            regarding appointments, requested information, service updates, account servicing, and customer support.
            Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance.
            Consent is not a condition of purchase. See our{' '}
            <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link href="/sms-terms" className="font-medium text-primary underline-offset-2 hover:underline">
              SMS Terms &amp; Conditions
            </Link>
            .
          </span>
        </label>
      </div>

      <Button type="submit" size="lg" variant="destructive" loading={submitting} className="mt-5 w-full">
        {submitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Sending…
          </>
        ) : (
          <>
            <Send className="h-5 w-5" aria-hidden />
            Send message
          </>
        )}
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        By submitting, you agree to our{' '}
        <Link href="/privacy" className="underline-offset-2 hover:underline">Privacy Policy</Link>. Submitting a phone
        number does not opt you into text messages unless you check the box above.
      </p>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1">
        {label}
        {required ? <span className="text-destructive" aria-hidden>*</span> : null}
      </Label>
      {children}
      {hint && !error ? (
        <p id={`hint-${htmlFor}`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`err-${htmlFor}`} className="mt-1 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
