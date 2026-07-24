'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { SequenceCreateSchema, AudienceCreateSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'
import { MESSAGE_PURPOSES } from '@/lib/comms/purpose'

// OS-13 — create a sequence (green-zone education/invitation drip). Minimal step
// model: one initial step at delay_days 0. Every enrolled send still passes the
// full comms gate at dispatch time — a sequence never bypasses it.
export function SequenceCreateForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const purpose = String(fd.get('purpose') ?? '')
    const raw = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? ''),
      channel: String(fd.get('channel') ?? 'email'),
      category: String(fd.get('category') ?? ''),
      // Slice 7 — a drip's default message purpose (§9/§10). Omit when unset.
      ...(purpose ? { purpose } : {}),
      steps: [{ delay_days: 0 }],
    }
    const parsed = SequenceCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ sequence: { id: string } }>('/api/comms/sequences', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Sequence created as draft.')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="seq-name" label="Name" required error={errors.name}><Input id="seq-name" name="name" /></Field>
        <Field id="seq-channel" label="Channel" required error={errors.channel}>
          <Select id="seq-channel" name="channel" defaultValue="email"><option value="email">email</option><option value="sms">sms</option></Select>
        </Field>
        <Field id="seq-category" label="Category" error={errors.category}><Input id="seq-category" name="category" placeholder="e.g. term_conversion" /></Field>
        <Field id="seq-purpose" label="Message purpose" hint="Drives purpose-scoped consent, frequency caps + collision at dispatch." error={errors.purpose}>
          <Select id="seq-purpose" name="purpose" defaultValue="">
            <option value="">— None (channel-wide consent) —</option>
            {MESSAGE_PURPOSES.map((p) => (<option key={p} value={p}>{p.replace(/_/g, ' ').toLowerCase()}</option>))}
          </Select>
        </Field>
      </div>
      <Field id="seq-description" label="Description" hint="Education/invitation only. Enrolled sends are still gated per recipient." error={errors.description}>
        <Textarea id="seq-description" name="description" rows={3} placeholder="What this drip educates on / invites to. Opt-out honored." />
      </Field>
      <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create draft'}</Button></div>
    </form>
  )
}

// OS-13 — audience builder. Produces a segment DEFINITION only; the dispatcher
// re-checks the full gate (consent, quiet-hours, DNC, template, no recommendation,
// not securities-flagged) for every recipient at send time.
export function AudienceBuilderForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const raw = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? ''),
      definition: {
        base: String(fd.get('base') ?? 'households') as 'households' | 'agencies' | 'policies',
        has_life: String(fd.get('has_life') ?? 'any') as 'any' | 'yes' | 'no',
        consented_only: fd.get('consented_only') === 'on',
      },
    }
    const parsed = AudienceCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ audience: { id: string } }>('/api/comms/audiences', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Audience saved.')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="aud-name" label="Name" required error={errors.name}><Input id="aud-name" name="name" /></Field>
        <Field id="aud-base" label="Base" required error={errors.base}>
          <Select id="aud-base" name="base" defaultValue="households">
            <option value="households">households</option>
            <option value="agencies">agencies</option>
            <option value="policies">policies</option>
          </Select>
        </Field>
        <Field id="aud-has-life" label="Has life coverage" error={errors.has_life}>
          <Select id="aud-has-life" name="has_life" defaultValue="any">
            <option value="any">any</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </Select>
        </Field>
      </div>
      <Field id="aud-description" label="Description" error={errors.description}>
        <Textarea id="aud-description" name="description" rows={3} placeholder="Who this segment targets." />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="consented_only" defaultChecked className="h-4 w-4 rounded border-input" />
        <span>Consented contacts only (recommended)</span>
      </label>
      <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save audience'}</Button></div>
    </form>
  )
}
