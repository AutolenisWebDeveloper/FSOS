'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { ReviewCreateSchema, REVIEW_TYPE } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function ReviewForm({
  households,
  defaultHousehold,
  defaultType,
}: {
  households: { id: string; primary_name: string }[]
  defaultHousehold?: string
  defaultType?: string
}) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = ReviewCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ review: { id: string } }>('/api/reviews', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Review scheduled — prep task created. Confirmations send only if consent + quiet-hours pass.')
    router.push(`/app/reviews/${res.data.review.id}`)
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
        <Field id="type" label="Review type" required error={errors.type}>
          <Select name="type" defaultValue={defaultType ?? 'annual'}>
            {REVIEW_TYPE.map((t) => (<option key={t} value={t}>{t.replace(/_/g, ' ')}</option>))}
          </Select>
        </Field>
        <Field id="scheduled_at" label="Scheduled at" hint="Leave blank to keep as requested" error={errors.scheduled_at}>
          <Input name="scheduled_at" type="datetime-local" />
        </Field>
      </div>
      <p className="rounded-md border border-status-pending/30 bg-status-pending/10 p-2 text-xs text-status-pending">
        A review discovers needs and originates opportunities. It never generates a product recommendation — that is the licensed FSA&apos;s, made in the meeting.
      </p>
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push('/app/reviews')} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Schedule review'}</Button>
      </div>
    </form>
  )
}
