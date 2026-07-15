'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { PolicyCreateSchema, POLICY_STATUS } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function PolicyForm({
  households,
  carriers,
  products,
  defaultHousehold,
}: {
  households: { id: string; primary_name: string }[]
  carriers: { id: string; name: string }[]
  products: { id: string; family: string; subtype: string | null; is_security: boolean }[]
  defaultHousehold?: string
}) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [isWithUs, setIsWithUs] = React.useState(true)
  const [productId, setProductId] = React.useState('')

  const selectedProduct = products.find((p) => p.id === productId)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const raw = { ...Object.fromEntries(fd.entries()), is_with_us: fd.get('is_with_us') === 'on' }
    const parsed = PolicyCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ policy: { id: string } }>('/api/policies', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Policy recorded')
    router.push(`/app/policies/${res.data.policy.id}`)
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
        <Field id="policy_number" label="Policy number" error={errors.policy_number}>
          <Input name="policy_number" placeholder="Optional" />
        </Field>
        <Field id="carrier_id" label="Carrier" error={errors.carrier_id}>
          <Select name="carrier_id" defaultValue="">
            <option value="">— None —</option>
            {carriers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </Select>
        </Field>
        <Field id="product_id" label="Product" error={errors.product_id}>
          <Select name="product_id" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— None —</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.family}{p.subtype ? ` · ${p.subtype}` : ''}{p.is_security ? ' (securities)' : ''}</option>))}
          </Select>
        </Field>
        <Field id="status" label="Status" error={errors.status}>
          <Select name="status" defaultValue="active">
            {POLICY_STATUS.map((s) => (<option key={s} value={s}>{s}</option>))}
          </Select>
        </Field>
        <Field id="premium" label="Premium" error={errors.premium}>
          <Input name="premium" type="number" min={0} step="0.01" />
        </Field>
        <Field id="effective_date" label="Effective date" error={errors.effective_date}>
          <Input name="effective_date" type="date" />
        </Field>
        {isWithUs ? (
          <>
            <Field id="renewal_date" label="Renewal date" error={errors.renewal_date}>
              <Input name="renewal_date" type="date" />
            </Field>
            <Field id="conversion_deadline" label="Conversion deadline" hint="Drives the Term Conversion OS" error={errors.conversion_deadline}>
              <Input name="conversion_deadline" type="date" />
            </Field>
          </>
        ) : (
          <Field id="x_date" label="Competitor X-date" hint="Competitor renewal cadence" error={errors.x_date}>
            <Input name="x_date" type="date" />
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_with_us" defaultChecked onChange={(e) => setIsWithUs(e.target.checked)} /> Own book (uncheck for a competitor X-date policy)
      </label>
      {selectedProduct?.is_security ? (
        <p className="rounded-md border border-status-security/40 bg-status-security/10 p-2 text-xs text-status-security">
          FFS-managed securities product: FSOS stores a reference pointer only and never automates outreach on this record.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push('/app/policies')} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record policy'}</Button>
      </div>
    </form>
  )
}
