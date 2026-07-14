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

export function ReferralForm({
  agencies,
  defaultAgency,
}: {
  agencies: { id: string; agency_name: string }[]
  defaultAgency?: string
}) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const raw = {
      ...Object.fromEntries(fd.entries()),
      consent_sms: fd.get('consent_sms') === 'on',
      consent_email: fd.get('consent_email') === 'on',
    }
    const parsed = ReferralCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ referral: { id: string } }>('/api/referrals', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Referral recorded')
    router.push(`/app/referrals/${res.data.referral.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="referred_name" label="Referred person" required error={errors.referred_name}>
          <Input name="referred_name" placeholder="Client name" />
        </Field>
        <Field id="referring_agency_id" label="Referring agency" error={errors.referring_agency_id}>
          <Select name="referring_agency_id" defaultValue={defaultAgency ?? ''}>
            <option value="">— Direct / none —</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>{a.agency_name}</option>
            ))}
          </Select>
        </Field>
        <Field id="engagement" label="Engagement" required error={errors.engagement}>
          <Select name="engagement" defaultValue="warm_handoff">
            {REFERRAL_ENGAGEMENT.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field id="referred_email" label="Email" error={errors.referred_email}>
          <Input name="referred_email" type="email" placeholder="client@email.com" />
        </Field>
        <Field id="referred_phone" label="Phone" error={errors.referred_phone}>
          <Input name="referred_phone" placeholder="(972) 555-0000" />
        </Field>
      </div>
      <Field id="note" label="Note" error={errors.note}>
        <Textarea name="note" placeholder="Context from the referring agent…" />
      </Field>
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Consent captured</legend>
        <p className="text-xs text-muted-foreground">Recorded now; materialized to the household member on conversion. No automated contact occurs without valid consent.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="consent_sms" /> SMS consent
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="consent_email" /> Email consent
        </label>
      </fieldset>
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push('/app/referrals')} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record referral'}</Button>
      </div>
    </form>
  )
}
