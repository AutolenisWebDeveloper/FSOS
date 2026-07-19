'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { WizardShell, CompletionScreen } from '@/components/archetypes'
import { Field } from '@/components/forms/Field'
import { ReferralConvertSchema, REFERRAL_ENGAGEMENT, dobNotFuture } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

const STEPS = ['Household', 'Member & consent', 'Opportunity', 'Review']

interface Props {
  referralId: string
  defaultName: string
  defaultEmail: string | null
  defaultPhone: string | null
  defaultEngagement: string
  households: { id: string; primary_name: string }[]
  products: { id: string; family: string; subtype: string | null; is_security: boolean }[]
}

export function ConvertWizard(props: Props) {
  const idempotencyKey = React.useMemo(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `conv-${props.referralId}-${Date.now()}`), [props.referralId])
  const [step, setStep] = React.useState(0)
  const [done, setDone] = React.useState<{ opportunity_id: string; household_id: string } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const [form, setForm] = React.useState({
    household_id: '',
    primary_name: props.defaultName,
    member_full_name: props.defaultName,
    member_dob: '',
    member_email: props.defaultEmail ?? '',
    member_phone: props.defaultPhone ?? '',
    member_consent_sms: false,
    member_consent_email: false,
    engagement: (REFERRAL_ENGAGEMENT.includes(props.defaultEngagement as never) ? props.defaultEngagement : 'warm_handoff'),
    product_id: '',
    expected_premium: '',
    expected_aum: '',
  })
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const selectedProduct = props.products.find((p) => p.id === form.product_id)

  function validateStep(s: number): boolean {
    const e: Record<string, string> = {}
    if (s === 0 && !form.household_id && form.primary_name.trim().length === 0) e.primary_name = 'Household name is required'
    if (s === 1) {
      if (form.member_full_name.trim().length === 0) e.member_full_name = 'Member name is required'
      if (form.member_dob && !dobNotFuture(form.member_dob)) e.member_dob = 'DOB cannot be in the future'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function next() {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function submit() {
    const payload = {
      household_id: form.household_id || undefined,
      primary_name: form.primary_name,
      member_full_name: form.member_full_name,
      member_dob: form.member_dob || undefined,
      member_email: form.member_email || undefined,
      member_phone: form.member_phone || undefined,
      member_consent_sms: form.member_consent_sms,
      member_consent_email: form.member_consent_email,
      engagement: form.engagement,
      product_id: form.product_id || undefined,
      expected_premium: form.expected_premium ? Number(form.expected_premium) : undefined,
      expected_aum: form.expected_aum ? Number(form.expected_aum) : undefined,
      idempotency_key: idempotencyKey,
    }
    const parsed = ReferralConvertSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      toast.error('Fix the highlighted fields')
      return
    }
    setSaving(true)
    const res = await postJson<{ opportunity_id: string; household_id: string }>(`/api/referrals/${props.referralId}/convert`, parsed.data)
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    setDone(res.data)
  }

  if (done) {
    return (
      <CompletionScreen
        title="Referral converted"
        description="Household and opportunity created with attribution and audit at each step."
        nextActions={[
          { label: 'View opportunity', href: `/app/opportunities/${done.opportunity_id}` },
          { label: 'View household', href: `/app/households/${done.household_id}` },
          { label: 'Back to inbox', href: '/app/referrals' },
        ]}
      />
    )
  }

  return (
    <WizardShell
      title="Convert Referral"
      steps={STEPS}
      current={step}
      footer={
        <>
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={saving}>Next</Button>
          ) : (
            <Button onClick={submit} disabled={saving}>{saving ? 'Converting…' : 'Convert'}</Button>
          )}
        </>
      }
    >
      {step === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Match an existing household or create a new one. Members are also deduped on email/phone at save.</p>
          <Field id="household_id" label="Existing household">
            <Select value={form.household_id} onChange={(e) => set('household_id', e.target.value)}>
              <option value="">— Create a new household —</option>
              {props.households.map((h) => (
                <option key={h.id} value={h.id}>{h.primary_name}</option>
              ))}
            </Select>
          </Field>
          {!form.household_id ? (
            <Field id="primary_name" label="New household name" required error={errors.primary_name}>
              <Input value={form.primary_name} onChange={(e) => set('primary_name', e.target.value)} />
            </Field>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="member_full_name" label="Member name" required error={errors.member_full_name}>
              <Input value={form.member_full_name} onChange={(e) => set('member_full_name', e.target.value)} />
            </Field>
            <Field id="member_dob" label="Date of birth" hint="Encrypted at rest" error={errors.member_dob}>
              <Input type="date" value={form.member_dob} onChange={(e) => set('member_dob', e.target.value)} />
            </Field>
            <Field id="member_email" label="Email" error={errors.member_email}>
              <Input type="email" value={form.member_email} onChange={(e) => set('member_email', e.target.value)} />
            </Field>
            <Field id="member_phone" label="Phone" error={errors.member_phone}>
              <Input value={form.member_phone} onChange={(e) => set('member_phone', e.target.value)} />
            </Field>
          </div>
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Confirm consent</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.member_consent_sms} onChange={(e) => set('member_consent_sms', e.target.checked)} /> SMS
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.member_consent_email} onChange={(e) => set('member_consent_email', e.target.checked)} /> Email
            </label>
          </fieldset>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="engagement" label="Engagement" required>
              <Select value={form.engagement} onChange={(e) => set('engagement', e.target.value)}>
                {REFERRAL_ENGAGEMENT.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field id="product_id" label="Product">
              <Select value={form.product_id} onChange={(e) => set('product_id', e.target.value)}>
                <option value="">— Undetermined —</option>
                {props.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.family}{p.subtype ? ` · ${p.subtype}` : ''}{p.is_security ? ' (securities)' : ''}</option>
                ))}
              </Select>
            </Field>
            <Field id="expected_premium" label="Expected premium">
              <Input type="number" min={0} value={form.expected_premium} onChange={(e) => set('expected_premium', e.target.value)} />
            </Field>
            <Field id="expected_aum" label="Expected assets (AUM)">
              <Input type="number" min={0} value={form.expected_aum} onChange={(e) => set('expected_aum', e.target.value)} />
            </Field>
          </div>
          {selectedProduct?.is_security ? (
            <p className="rounded-md border border-status-security/40 bg-status-security/10 p-2 text-xs text-status-security">
              FFS-managed securities product: FSOS tracks existence + an FFS reference only. A securities opportunity requires FSA securities scope or it is blocked and escalated to FFS handling.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Review</p>
          <Row label="Household" value={form.household_id ? props.households.find((h) => h.id === form.household_id)?.primary_name ?? 'Existing' : `New: ${form.primary_name}`} />
          <Row label="Member" value={form.member_full_name} />
          <Row label="Consent" value={[form.member_consent_sms ? 'SMS' : null, form.member_consent_email ? 'Email' : null].filter(Boolean).join(', ') || 'None'} />
          <Row label="Engagement" value={form.engagement} />
          <Row label="Product" value={selectedProduct ? `${selectedProduct.family}${selectedProduct.subtype ? ` · ${selectedProduct.subtype}` : ''}` : 'Undetermined'} />
          <p className="pt-2 text-xs text-muted-foreground">Conversion is idempotent — retrying will not create duplicates.</p>
        </div>
      ) : null}
    </WizardShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
