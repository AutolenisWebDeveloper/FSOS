'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { TEMPLATE_CATEGORY, TemplateCreateSchema } from '@/lib/validation/schemas'
import { postJson, patchJson, firstFieldError } from '@/lib/client/api'

export function TemplateCreateForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = TemplateCreateSchema.safeParse(raw)
    if (!parsed.success) { const fe = parsed.error.flatten().fieldErrors; setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid']))); return }
    setSaving(true)
    const res = await postJson<{ template: { id: string } }>('/api/comms/templates', parsed.data)
    setSaving(false)
    if (!res.ok) {
      if (res.error.reason === 'recommendation') { toast.error('Blocked: recommendation language. Education/invitation only.'); return }
      const fe = firstFieldError(res.error); if (fe.field) setErrors({ [fe.field]: fe.message }); toast.error(fe.message); return
    }
    toast.success('Template created as draft. Submit it for approval.')
    router.push(`/app/comms/templates/${res.data.template.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" required error={errors.name}><Input name="name" /></Field>
        <Field id="channel" label="Channel" required error={errors.channel}><Select name="channel" defaultValue="email"><option value="email">email</option><option value="sms">sms</option></Select></Field>
        <Field id="category" label="Category" required error={errors.category}><Select name="category" defaultValue="educational">{TEMPLATE_CATEGORY.map((c) => (<option key={c} value={c}>{c.replace(/_/g, ' ')}</option>))}</Select></Field>
      </div>
      <Field id="body" label="Body" required hint="Education/invitation only. Include an opt-out/consent footer. Recommendation language is blocked." error={errors.body}>
        <Textarea name="body" rows={6} placeholder="Neutral educational content + review invitation. Reply STOP to opt out." />
      </Field>
      <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create draft'}</Button></div>
    </form>
  )
}

// Approval controls. `canApprove` is passed from the server (compliance/supervisor/super only).
export function TemplateApprovalControls({ id, status, canApprove }: { id: string; status: string; canApprove: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function act(action: 'submit' | 'approve' | 'reject') {
    setBusy(true)
    const res = await postJson(`/api/comms/templates/${id}`, { action })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success(`Template ${action === 'submit' ? 'submitted' : action + 'd'}`)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'draft' ? <Button size="sm" onClick={() => act('submit')} disabled={busy}>Submit for approval</Button> : null}
      {status === 'submitted' && canApprove ? (
        <>
          <Button size="sm" onClick={() => act('approve')} disabled={busy}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => act('reject')} disabled={busy}>Reject</Button>
        </>
      ) : null}
      {status === 'submitted' && !canApprove ? <p className="text-xs text-muted-foreground">Awaiting compliance/supervisor approval — you cannot approve your own template.</p> : null}
      {status === 'approved' ? <p className="text-xs text-status-won">Approved — usable by campaigns and agents.</p> : null}
    </div>
  )
}

export function TemplateBodyEditor({ id, body }: { id: string; body: string }) {
  const router = useRouter()
  const [value, setValue] = React.useState(body)
  const [saving, setSaving] = React.useState(false)

  async function save() {
    setSaving(true)
    const res = await patchJson(`/api/comms/templates/${id}`, { body: value })
    setSaving(false)
    if (!res.ok) {
      if (res.error.reason === 'recommendation') { toast.error('Blocked: recommendation language.'); return }
      toast.error(firstFieldError(res.error).message); return
    }
    toast.success('Saved — a new version; approval reset to draft.')
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={6} aria-label="Template body" />
      <div className="flex justify-end"><Button size="sm" onClick={save} disabled={saving || value === body}>{saving ? 'Saving…' : 'Save (new version)'}</Button></div>
      <p className="text-xs text-muted-foreground">Editing an approved template creates a new version and resets approval to draft — it cannot send until re-approved.</p>
    </div>
  )
}
