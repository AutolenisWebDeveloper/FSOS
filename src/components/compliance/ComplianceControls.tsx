'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { postJson, patchJson, firstFieldError } from '@/lib/client/api'
import { LegalHoldSchema, AttestationSchema, CompliancePolicySchema } from '@/lib/validation/schemas'

function setFieldErrors(
  fe: Record<string, string[] | undefined>,
  set: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  set(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
}

// ─── Legal Holds ──────────────────────────────────────────────────────────────
// A legal hold suspends deletion/retention for its scope — a preservation
// override, never a delete.
export function LegalHoldForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const form = new FormData(e.currentTarget)
    const entityType = String(form.get('entity_type') ?? '')
    const payload = {
      name: String(form.get('name') ?? ''),
      matter_ref: String(form.get('matter_ref') ?? '') || undefined,
      reason: String(form.get('reason') ?? ''),
      scope: entityType ? { entity_type: entityType, entity_ids: [] } : undefined,
    }
    const parsed = LegalHoldSchema.safeParse(payload)
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors, setErrors)
      return
    }
    setSaving(true)
    const res = await postJson<{ row: { id: string } }>('/api/compliance/legal-holds', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const err = firstFieldError(res.error)
      if (err.field) setErrors({ [err.field]: err.message })
      toast.error(err.message)
      return
    }
    toast.success('Legal hold placed — deletion suspended for its scope.')
    e.currentTarget.reset()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" required error={errors.name}><Input name="name" /></Field>
        <Field id="matter_ref" label="Matter ref" error={errors.matter_ref}><Input name="matter_ref" /></Field>
        <Field id="entity_type" label="Scope entity" hint="What kind of records this hold preserves." error={errors.scope}>
          <Select name="entity_type" defaultValue="household">
            <option value="household">household</option>
            <option value="agency">agency</option>
            <option value="case">case</option>
            <option value="document">document</option>
          </Select>
        </Field>
      </div>
      <Field id="reason" label="Reason" required error={errors.reason}>
        <Textarea name="reason" rows={3} placeholder="Matter / basis for preservation." />
      </Field>
      <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Placing…' : 'Place hold'}</Button></div>
    </form>
  )
}

export function LegalHoldControls({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function release() {
    setBusy(true)
    const res = await patchJson(`/api/compliance/legal-holds/${id}`, { action: 'release' })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success('Hold released. This lifts preservation — it does not delete anything.')
    router.refresh()
  }

  return <Button size="sm" variant="outline" onClick={release} disabled={busy}>{busy ? 'Releasing…' : 'Release'}</Button>
}

// ─── Attestations ─────────────────────────────────────────────────────────────
export function AttestationForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const form = new FormData(e.currentTarget)
    const dueRaw = String(form.get('due_at') ?? '')
    const payload = {
      title: String(form.get('title') ?? ''),
      body: String(form.get('body') ?? ''),
      period: String(form.get('period') ?? '') || undefined,
      required_roles: [],
      due_at: dueRaw ? new Date(dueRaw).toISOString() : undefined,
    }
    const parsed = AttestationSchema.safeParse(payload)
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors, setErrors)
      return
    }
    setSaving(true)
    const res = await postJson<{ row: { id: string } }>('/api/compliance/attestations', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const err = firstFieldError(res.error)
      if (err.field) setErrors({ [err.field]: err.message })
      toast.error(err.message)
      return
    }
    toast.success('Attestation opened.')
    e.currentTarget.reset()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="title" label="Title" required error={errors.title}><Input name="title" /></Field>
        <Field id="period" label="Period" hint="e.g. Q3-2026" error={errors.period}><Input name="period" /></Field>
        <Field id="due_at" label="Due" error={errors.due_at}><Input name="due_at" type="datetime-local" /></Field>
      </div>
      <Field id="body" label="Body" required error={errors.body}>
        <Textarea name="body" rows={5} placeholder="What each recipient is attesting to." />
      </Field>
      <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Opening…' : 'Open attestation'}</Button></div>
    </form>
  )
}

export function AttestationAck({ id }: { id: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [response, setResponse] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function acknowledge() {
    setBusy(true)
    const res = await postJson(`/api/compliance/attestations/${id}`, response.trim() ? { response: response.trim() } : {})
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success('Acknowledged.')
    setOpen(false)
    setResponse('')
    router.refresh()
  }

  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Acknowledge</Button>

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Optional note"
        aria-label="Acknowledgement note"
        className="sm:w-56"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={acknowledge} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}

// ─── Policies ─────────────────────────────────────────────────────────────────
export function PolicyForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const form = new FormData(e.currentTarget)
    const payload = {
      title: String(form.get('title') ?? ''),
      category: String(form.get('category') ?? '') || undefined,
      body: String(form.get('body') ?? ''),
    }
    const parsed = CompliancePolicySchema.safeParse(payload)
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors, setErrors)
      return
    }
    setSaving(true)
    const res = await postJson<{ row: { id: string } }>('/api/compliance/policies', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const err = firstFieldError(res.error)
      if (err.field) setErrors({ [err.field]: err.message })
      toast.error(err.message)
      return
    }
    toast.success('Policy saved as draft. Publish it to make it effective.')
    e.currentTarget.reset()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="title" label="Title" required error={errors.title}><Input name="title" /></Field>
        <Field id="category" label="Category" error={errors.category}><Input name="category" /></Field>
      </div>
      <Field id="body" label="Body" error={errors.body}>
        <Textarea name="body" rows={6} placeholder="Policy text." />
      </Field>
      <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create draft'}</Button></div>
    </form>
  )
}

export function PolicyControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function act(action: 'publish' | 'retire') {
    setBusy(true)
    const res = await patchJson(`/api/compliance/policies/${id}`, { action })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success(action === 'publish' ? 'Policy published — effective now.' : 'Policy retired.')
    router.refresh()
  }

  if (status === 'draft') return <Button size="sm" onClick={() => act('publish')} disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</Button>
  if (status === 'published') return <Button size="sm" variant="outline" onClick={() => act('retire')} disabled={busy}>{busy ? 'Retiring…' : 'Retire'}</Button>
  return null
}
