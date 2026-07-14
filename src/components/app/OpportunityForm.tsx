'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { OpportunityCreateSchema, REFERRAL_ENGAGEMENT } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function OpportunityForm({
  households,
  products,
  agencies,
  defaultHousehold,
}: {
  households: { id: string; primary_name: string }[]
  products: { id: string; family: string; subtype: string | null; is_security: boolean }[]
  agencies: { id: string; agency_name: string }[]
  defaultHousehold?: string
}) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [productId, setProductId] = React.useState('')
  const selectedProduct = products.find((p) => p.id === productId)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = OpportunityCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ opportunity: { id: string } }>('/api/opportunities', parsed.data)
    setSaving(false)
    if (!res.ok) {
      if (res.error.reason === 'securities_scope') {
        toast.error('Securities product requires securities scope. Escalated to the FSA.')
        return
      }
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Opportunity created')
    router.push(`/app/opportunities/${res.data.opportunity.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="household_id" label="Household" required error={errors.household_id}>
          <Select name="household_id" defaultValue={defaultHousehold ?? ''}>
            <option value="">— Select household —</option>
            {households.map((h) => (<option key={h.id} value={h.id}>{h.primary_name}</option>))}
          </Select>
        </Field>
        <Field id="engagement" label="Engagement" required error={errors.engagement}>
          <Select name="engagement" defaultValue="warm_handoff">
            {REFERRAL_ENGAGEMENT.map((s) => (<option key={s} value={s}>{s}</option>))}
          </Select>
        </Field>
        <Field id="product_id" label="Product" hint="Sets securities flag & required license" error={errors.product_id}>
          <Select name="product_id" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— Undetermined —</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.family}{p.subtype ? ` · ${p.subtype}` : ''}{p.is_security ? ' (securities)' : ''}</option>))}
          </Select>
        </Field>
        <Field id="referring_agency_id" label="Referring agency (attribution)" error={errors.referring_agency_id}>
          <Select name="referring_agency_id" defaultValue="">
            <option value="">— None —</option>
            {agencies.map((a) => (<option key={a.id} value={a.id}>{a.agency_name}</option>))}
          </Select>
        </Field>
        <Field id="expected_premium" label="Expected premium" error={errors.expected_premium}>
          <Input name="expected_premium" type="number" min={0} step="0.01" />
        </Field>
        <Field id="expected_aum" label="Expected assets (AUM)" error={errors.expected_aum}>
          <Input name="expected_aum" type="number" min={0} step="0.01" />
        </Field>
      </div>
      {selectedProduct?.is_security ? (
        <p className="rounded-md border border-status-blocked/40 bg-status-blocked/10 p-2 text-xs text-status-blocked">
          Securities product: creating this requires FSA securities scope, or it is blocked and escalated to FFS. FSOS never stores securities order/suitability substance.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push('/app/opportunities')} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create opportunity'}</Button>
      </div>
    </form>
  )
}
