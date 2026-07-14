'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { AgencyCreateSchema, AGENCY_STATUS } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function AgencyForm({ districts }: { districts: { id: string; name: string }[] }) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const raw = Object.fromEntries(fd.entries())
    const parsed = AgencyCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ agency: { id: string }; warning?: string }>('/api/agencies', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    if (res.data.warning) toast.warning(res.data.warning)
    toast.success('Partnership created')
    router.push(`/app/agencies/${res.data.agency.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="agency_name" label="Agency name" required error={errors.agency_name}>
          <Input name="agency_name" placeholder="McKinney Farmers Agency" />
        </Field>
        <Field id="owner_name" label="Owner name" required error={errors.owner_name}>
          <Input name="owner_name" placeholder="Jane Owner" />
        </Field>
        <Field id="owner_email" label="Owner email" error={errors.owner_email}>
          <Input name="owner_email" type="email" placeholder="owner@agency.com" />
        </Field>
        <Field id="owner_phone" label="Owner phone" error={errors.owner_phone}>
          <Input name="owner_phone" placeholder="(972) 555-0100" />
        </Field>
        <Field id="district_id" label="District" error={errors.district_id}>
          <Select name="district_id" defaultValue="">
            <option value="">— None —</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="status" label="Status" error={errors.status}>
          <Select name="status" defaultValue="prospective">
            {AGENCY_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="checkin_interval_days" label="Check-in interval (days)" error={errors.checkin_interval_days}>
          <Input name="checkin_interval_days" type="number" min={1} max={365} defaultValue={30} />
        </Field>
        <Field id="pc_book_policies" label="P&C book policies" error={errors.pc_book_policies}>
          <Input name="pc_book_policies" type="number" min={0} defaultValue={0} />
        </Field>
        <Field id="life_policies_in_force" label="Life policies in force" error={errors.life_policies_in_force}>
          <Input name="life_policies_in_force" type="number" min={0} defaultValue={0} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push('/app/agencies')} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Create partnership'}
        </Button>
      </div>
    </form>
  )
}
