'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { MemberCreateSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function MemberForm({ householdId }: { householdId: string }) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = MemberCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson(`/api/households/${householdId}/members`, parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Member added')
    router.push(`/app/households/${householdId}/members`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="full_name" label="Full name" required error={errors.full_name}>
          <Input name="full_name" placeholder="Jane Smith" />
        </Field>
        <Field id="relationship" label="Relationship" error={errors.relationship}>
          <Input name="relationship" placeholder="primary / spouse / child" />
        </Field>
        <Field id="dob" label="Date of birth" hint="Encrypted at rest (pgcrypto)" error={errors.dob}>
          <Input name="dob" type="date" />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <Input name="email" type="email" />
        </Field>
        <Field id="phone" label="Phone" error={errors.phone}>
          <Input name="phone" />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push(`/app/households/${householdId}/members`)} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add member'}</Button>
      </div>
    </form>
  )
}
