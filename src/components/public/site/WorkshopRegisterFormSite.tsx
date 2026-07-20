'use client'

import * as React from 'react'
import { postJson, firstFieldError } from '@/lib/client/api'
import type { PublicWorkshop } from '@/components/public/WorkshopRegisterForm'

// Marketing-register (.msite) styling of the public workshop registration form.
//
// IMPORTANT — this is a PRESENTATION-ONLY restyle. It posts the BYTE-IDENTICAL payload to
// the SAME existing route (/api/public/workshops/register) with the SAME consent semantics
// as WorkshopRegisterForm: separate, unchecked, optional email + SMS boxes; phone required
// only when SMS is ticked; the APPROVED sms_disclosure (never a placeholder) rendered by the
// SMS box; honeypot (`company`); immutable lead_source; redirect to the confirmation page on
// success. The backend consent-evidence path (workshop_consent_events + join_token +
// lead_source) is unchanged — this component never re-implements it, only re-skins the inputs.
export function WorkshopRegisterFormSite({ workshop }: { workshop: PublicWorkshop }) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [delivery, setDelivery] = React.useState<'in_person' | 'virtual'>(
    workshop.delivery_mode === 'virtual' ? 'virtual' : 'in_person',
  )
  const [consentEmail, setConsentEmail] = React.useState(false)
  const [consentSms, setConsentSms] = React.useState(false)
  const [company, setCompany] = React.useState('') // honeypot
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErr, setFieldErr] = React.useState<string | undefined>()

  const isHybrid = workshop.delivery_mode === 'hybrid'

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

  if (done) {
    return (
      <div className="form">
        <h3>You&apos;re registered</h3>
        <div className="formstatus" role="status" aria-live="polite">
          Thanks — your seat is reserved. Check your email for the details and reminders.
        </div>
      </div>
    )
  }

  if (workshop.is_full) {
    return (
      <div className="form">
        <h3>Reserve your seat</h3>
        <p className="form__sub">This session is currently full. Please check back for the next session, or contact the office to join the waitlist.</p>
      </div>
    )
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <h3>Reserve your seat</h3>
      <p className="form__sub">Free educational event. It takes about 30 seconds — no payment, no obligation.</p>

      {/* Honeypot */}
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>

      {error && fieldErr === undefined ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="w-name">
          Full name <span className="req">*</span>
        </label>
        <input id="w-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={fieldErr === 'name'} required />
        {fieldErr === 'name' && error ? <p className="err" role="alert" style={{ margin: '6px 0 0' }}>{error}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="w-email">
          Email <span className="req">*</span>
        </label>
        <input id="w-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={fieldErr === 'email'} required />
        {fieldErr === 'email' && error ? <p className="err" role="alert" style={{ margin: '6px 0 0' }}>{error}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="w-phone">Mobile phone{consentSms ? <span className="req"> *</span> : null}</label>
        <input id="w-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={fieldErr === 'phone'} placeholder="(972) 555-0134" />
        <p className="hintline">{consentSms ? 'Required to receive text reminders.' : 'Optional — only needed for text reminders.'}</p>
        {fieldErr === 'phone' && error ? <p className="err" role="alert" style={{ margin: '6px 0 0' }}>{error}</p> : null}
      </div>

      {isHybrid ? (
        <div className="field">
          <label htmlFor="w-delivery">How will you attend?</label>
          <select id="w-delivery" className="wselect" style={{ width: '100%' }} value={delivery} onChange={(e) => setDelivery(e.target.value as 'in_person' | 'virtual')}>
            <option value="in_person">In person</option>
            <option value="virtual">Online</option>
          </select>
        </div>
      ) : null}

      {/* Consent — compliance-critical: separate, unchecked, optional; approved copy only. */}
      <div className="consent">
        <span className="consent__chip">Optional</span>
        <div className="consent__row">
          <input type="checkbox" id="w-consent-email" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} />
          <label htmlFor="w-consent-email">Email me about this and future educational workshops.</label>
        </div>
        <div className="consent__row" style={{ marginTop: 10 }}>
          <input type="checkbox" id="w-consent-sms" checked={consentSms} onChange={(e) => setConsentSms(e.target.checked)} />
          <label htmlFor="w-consent-sms">
            Text me event reminders (SMS).
            {workshop.sms_disclosure ? <span style={{ display: 'block', marginTop: 6, color: 'var(--slate)', fontSize: '11.5px', lineHeight: 1.5 }}>{workshop.sms_disclosure}</span> : null}
          </label>
        </div>
        <p className="consent__note">
          See our <a href="/sms-terms">SMS Terms</a> and <a href="/privacy">Privacy Policy</a>. Registering does not
          require consent, and consent is not a condition of attending.
        </p>
      </div>

      <button className="btn btn--red btn--full" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? 'Reserving…' : 'Reserve my seat'}
      </button>
      {workshop.seats_remaining != null ? (
        <p className="microcopy" style={{ textAlign: 'center' }}>
          {workshop.seats_remaining} seats remaining · free to attend
        </p>
      ) : null}
    </form>
  )
}
