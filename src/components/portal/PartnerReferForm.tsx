'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { ReferralCreateSchema, REFERRAL_ENGAGEMENT } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

// P-4 Submit Referral form. Consent capture is required before any FSA outreach.
export function PartnerReferForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [consentSms, setConsentSms] = React.useState(false)
  const [consentEmail, setConsentEmail] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = ReferralCreateSchema.safeParse({ ...raw, consent_sms: consentSms, consent_email: consentEmail })
    if (!parsed.success) { const fe = parsed.error.flatten().fieldErrors; setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid']))); return }
    setSaving(true)
    const res = await postJson<{ referral: { id: string } }>('/api/partner/refer', parsed.data)
    setSaving(false)
    if (!res.ok) { const fe = firstFieldError(res.error); if (fe.field) setErrors({ [fe.field]: fe.message }); toast.error(fe.message); return }
    toast.success('Referral submitted — it appears in the FSA inbox with your agency attribution.')
    router.push('/partner/referrals')
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="referred_name" label="Referred person" required error={errors.referred_name}><Input name="referred_name" /></Field>
        <Field id="engagement" label="Engagement preference" error={errors.engagement}><Select name="engagement" defaultValue="warm_handoff">{REFERRAL_ENGAGEMENT.map((e) => (<option key={e} value={e}>{e.replace(/_/g, ' ')}</option>))}</Select></Field>
        <Field id="referred_email" label="Contact email" error={errors.referred_email}><Input name="referred_email" type="email" /></Field>
        <Field id="referred_phone" label="Contact phone" error={errors.referred_phone}><Input name="referred_phone" /></Field>
      </div>
      <Field id="note" label="Product interest / note" error={errors.note}><Textarea name="note" rows={3} /></Field>
      <div className="space-y-2 rounded-md border border-status-pending/30 bg-status-pending/10 p-3 text-sm">
        <p className="font-medium">Consent (required before any outreach)</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={consentSms} onChange={(e) => setConsentSms(e.target.checked)} /> The client consents to SMS contact</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} /> The client consents to email contact</label>
      </div>
      <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit referral'}</Button></div>
    </form>
  )
}
