'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { HouseholdCreateSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function HouseholdForm({ agencies }: { agencies: { id: string; agency_name: string }[] }) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = HouseholdCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ household: { id: string } }>('/api/households', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Household created')
    router.push(`/app/households/${res.data.household.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="primary_name" label="Household name" required error={errors.primary_name}>
          <Input name="primary_name" placeholder="The Smith Household" />
        </Field>
        <Field id="referring_agency_id" label="Referring agency" error={errors.referring_agency_id}>
          <Select name="referring_agency_id" defaultValue="">
            <option value="">— None —</option>
            {agencies.map((a) => (<option key={a.id} value={a.id}>{a.agency_name}</option>))}
          </Select>
        </Field>
        <Field id="address" label="Address" error={errors.address}>
          <Input name="address" placeholder="123 Main St" />
        </Field>
        <Field id="city" label="City" error={errors.city}>
          <Input name="city" placeholder="McKinney" />
        </Field>
        <Field id="state" label="State" error={errors.state}>
          <Input name="state" defaultValue="TX" maxLength={2} />
        </Field>
        <Field id="zip" label="ZIP" error={errors.zip}>
          <Input name="zip" placeholder="75070" />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push('/app/households')} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create household'}</Button>
      </div>
    </form>
  )
}
