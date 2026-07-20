'use client'

import * as React from 'react'
import { BUSINESS, SMS_CONSENT } from '@/lib/site'

const TOPICS = [
  'Life insurance',
  'Retirement planning',
  'College planning',
  'Investments',
  'Annuities',
  'Business protection',
  'Policy service',
  'Schedule a consultation',
  'Other',
]

export function SiteContactForm() {
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState('')
  const [sms, setSms] = React.useState(false)
  const okRef = React.useRef<HTMLDivElement | null>(null)
  const utmRef = React.useRef<Record<string, string>>({})

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
    setError('')
    const form = e.currentTarget
    const fd = new FormData(form)
    const first = String(fd.get('first_name') || '').trim()
    const last = String(fd.get('last_name') || '').trim()
    const email = String(fd.get('email') || '').trim()
    const phone = String(fd.get('mobile') || '').trim()

    if (!first || !last) {
      setError('Please enter your first and last name.')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    if (sms && phone.replace(/\D/g, '').length < 10) {
      setError('Enter a 10-digit mobile number to receive texts, or uncheck the text-message box.')
      const el = form.querySelector<HTMLInputElement>('#mobile')
      el?.focus()
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: `${first} ${last}`,
          email,
          phone: phone || undefined,
          preferred_contact: 'no_preference',
          interest: String(fd.get('topic') || ''),
          message: String(fd.get('message') || '').trim() || 'Consultation request',
          consent_sms: sms,
          consent_version: SMS_CONSENT.version,
          source_page: window.location.pathname || '/',
          form_name: 'site_contact',
          utm: utmRef.current,
          company: String(fd.get('company') || ''),
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error || 'Something went wrong. Please try again or call the office.')
        setSubmitting(false)
        return
      }
      setDone(true)
      window.setTimeout(() => okRef.current?.focus(), 40)
    } catch {
      setError('We couldn’t reach the server. Please try again or call the office.')
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="form">
        <h3>Request a consultation</h3>
        <div ref={okRef} tabIndex={-1} className="formstatus" role="status" aria-live="polite">
          Thanks — your request has been recorded. Markist will personally follow up soon. If it’s urgent, please call
          the office.
        </div>
      </div>
    )
  }

  return (
    <form className="form" id="optin-form" onSubmit={onSubmit} noValidate>
      <h3>Request a consultation</h3>
      <p className="form__sub">The SMS box is optional, unchecked, and separate from your request.</p>

      {/* Honeypot */}
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="frow">
        <div className="field">
          <label htmlFor="first">
            First name <span className="req">*</span>
          </label>
          <input id="first" name="first_name" autoComplete="given-name" required />
        </div>
        <div className="field">
          <label htmlFor="last">
            Last name <span className="req">*</span>
          </label>
          <input id="last" name="last_name" autoComplete="family-name" required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="email">
          Email <span className="req">*</span>
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="frow">
        <div className="field">
          <label htmlFor="mobile">Mobile phone</label>
          <input id="mobile" name="mobile" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(972) 555-0134" />
          <p className="hintline">Only needed for a call or text back.</p>
        </div>
        <div className="field">
          <label htmlFor="topic">Topic</label>
          <select id="topic" name="topic" defaultValue="Schedule a consultation">
            {TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="message">Message</label>
        <textarea id="message" name="message" />
      </div>

      <div className="consent">
        <span className="consent__chip">Optional</span>
        <div className="consent__row">
          <input type="checkbox" id="sms-consent" name="sms_consent" value="yes" checked={sms} onChange={(e) => setSms(e.target.checked)} />
          <label htmlFor="sms-consent">
            By checking this box, I agree to receive recurring text messages from {BUSINESS.brand} at the mobile number
            provided, including appointment and policy updates, account and customer-service messages, and marketing or
            promotional offers. Messages originate from {SMS_CONSENT.from}. Msg frequency varies. Msg &amp; data rates
            may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase. See our{' '}
            <a href="/privacy">Privacy Policy</a>, <a href="/terms">Terms of Use</a>, and{' '}
            <a href="/sms-terms">SMS Terms &amp; Conditions</a>.
          </label>
        </div>
        <p className="consent__note">
          No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.
        </p>
      </div>

      <p className="microcopy">
        Please don’t include Social Security numbers, account numbers, or other sensitive data in this form.
      </p>
      <button className="btn btn--red btn--full" type="submit" disabled={submitting} aria-busy={submitting}>
        {submitting ? 'Submitting…' : 'Submit Request'}
      </button>
    </form>
  )
}
