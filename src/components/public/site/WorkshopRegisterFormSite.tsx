'use client'

import * as React from 'react'
import Link from 'next/link'
import { postJson, firstFieldError } from '@/lib/client/api'
import type { PublicWorkshop } from '@/components/public/WorkshopRegisterForm'
import { SMS_REMINDER_DISCLOSURE, MARKETING_OPT_IN_LABEL } from '@/lib/workshops/consent-copy'

// Marketing-register (.msite) styling of the public workshop registration form.
//
// IMPORTANT — this is a PRESENTATION-ONLY restyle. It posts the BYTE-IDENTICAL payload to
// the SAME existing route (/api/public/workshops/register) with the SAME consent semantics
// as WorkshopRegisterForm: separate, unchecked, optional email + SMS boxes; phone required
// only when SMS is ticked; the APPROVED sms_disclosure (never a placeholder) rendered by the
// SMS box; honeypot (`company`); immutable lead_source; redirect to the confirmation page on
// success. The backend consent-evidence path (workshop_consent_events + join_token +
// lead_source) is unchanged — this component never re-implements it, only re-skins the inputs.
/** Fields that own an inline error slot below their input. A rejection naming anything
 *  else (workshop_id, session_id, chosen_delivery, guest_count…) falls through to the
 *  form-level summary — WS-052: it must never render nothing. */
const INLINE_ERROR_FIELDS = new Set(['name', 'email', 'phone'])

export function WorkshopRegisterFormSite({ workshop }: { workshop: PublicWorkshop }) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [delivery, setDelivery] = React.useState<'in_person' | 'virtual'>(
    workshop.delivery_mode === 'virtual' ? 'virtual' : 'in_person',
  )
  const [marketingOptIn, setMarketingOptIn] = React.useState(false)
  const [guests, setGuests] = React.useState(0)
  const [alreadyRegistered, setAlreadyRegistered] = React.useState(false)
  const [company, setCompany] = React.useState('') // honeypot
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const summaryRef = React.useRef<HTMLParagraphElement | null>(null)
  const [fieldErr, setFieldErr] = React.useState<string | undefined>()

  const isHybrid = workshop.delivery_mode === 'hybrid'
  // D-7: guests consume IN-PERSON seats only — the field renders only when the registrant
  // is attending in person.
  const attendingInPerson = isHybrid ? delivery === 'in_person' : workshop.delivery_mode !== 'virtual'

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
      // WS-052: move focus to the summary when the failure has no field slot, so a
      // keyboard/screen-reader user is never left with a silently un-busied button.
      if (!INLINE_ERROR_FIELDS.has(fe.field ?? '')) {
        requestAnimationFrame(() => summaryRef.current?.focus())
      }
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

  if (alreadyRegistered) {
    return (
      <div className="form">
        <h3>You&apos;re already registered</h3>
        <div className="formstatus" role="status" aria-live="polite">
          This email already holds a seat for this workshop — you&apos;re all set, and no second
          seat was taken. Your original confirmation and reminders still apply.
        </div>
      </div>
    )
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

      {/* WS-052: the general error renders whenever the field it names has no slot of
          its own — a rejection on workshop_id / session_id / chosen_delivery used to
          display NOTHING and the button simply un-busied. */}
      {error && !INLINE_ERROR_FIELDS.has(fieldErr ?? '') ? (
        <p className="err" role="alert" tabIndex={-1} ref={summaryRef}>
          {error}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="w-name">
          Full name <span className="req">*</span>
        </label>
        <input id="w-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={fieldErr === 'name'} aria-describedby={fieldErr === 'name' ? 'w-name-err' : undefined} required />
        {fieldErr === 'name' && error ? <p id="w-name-err" className="err" role="alert" style={{ margin: '6px 0 0' }}>{error}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="w-email">
          Email <span className="req">*</span>
        </label>
        <input id="w-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={fieldErr === 'email'} aria-describedby={fieldErr === 'email' ? 'w-email-err' : undefined} required />
        {fieldErr === 'email' && error ? <p id="w-email-err" className="err" role="alert" style={{ margin: '6px 0 0' }}>{error}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="w-phone">Mobile phone <span className="hintline" style={{ display: 'inline' }}>(optional)</span></label>
        <input id="w-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={fieldErr === 'phone'} aria-describedby={fieldErr === 'phone' ? 'w-phone-disclosure w-phone-err' : 'w-phone-disclosure'} placeholder="(972) 555-0134" />
        {/* SETTLED model (D-3): providing a number IS the reminder opt-in — the approved
            disclosure lives AT the field, captured with the form version. */}
        <p id="w-phone-disclosure" className="hintline">{SMS_REMINDER_DISCLOSURE}</p>
        {workshop.sms_disclosure ? <p className="hintline">{workshop.sms_disclosure}</p> : null}
        {fieldErr === 'phone' && error ? <p id="w-phone-err" className="err" role="alert" style={{ margin: '6px 0 0' }}>{error}</p> : null}
      </div>

      {attendingInPerson ? (
        <div className="field">
          <label htmlFor="w-guests">Guests you&apos;re bringing</label>
          <select id="w-guests" className="wselect" style={{ width: '100%' }} value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
            <option value={0}>Just me</option>
            <option value={1}>+1 guest</option>
            <option value={2}>+2 guests</option>
            <option value={3}>+3 guests</option>
            <option value={4}>+4 guests</option>
          </select>
          <p className="hintline">Guests share your reservation and count toward the room&apos;s seats.</p>
        </div>
      ) : null}

      {isHybrid ? (
        <div className="field">
          <label htmlFor="w-delivery">How will you attend?</label>
          <select id="w-delivery" className="wselect" style={{ width: '100%' }} value={delivery} onChange={(e) => setDelivery(e.target.value as 'in_person' | 'virtual')}>
            <option value="in_person">In person</option>
            <option value="virtual">Online</option>
          </select>
        </div>
      ) : null}

      {/* SETTLED model (D-3): ONE unchecked box, governing POST-EVENT MARKETING only —
          reminders ride the registration itself and need no checkbox. */}
      <div className="consent">
        <span className="consent__chip">Optional</span>
        <div className="consent__row">
          <input type="checkbox" id="w-marketing" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
          <label htmlFor="w-marketing">{MARKETING_OPT_IN_LABEL}</label>
        </div>
        <p className="consent__note">
          See our <Link href="/sms-terms">SMS Terms</Link> and <Link href="/privacy">Privacy Policy</Link>. Registering does not
          require this, and it is not a condition of attending.
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
