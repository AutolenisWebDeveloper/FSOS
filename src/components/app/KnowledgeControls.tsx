'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { KNOWLEDGE_KIND, KnowledgeCreateSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

// Add a document/FAQ/policy/procedure/template/business-info to the AI Knowledge
// Library. Farmers-specific facts should be flagged "config default — verify" so
// the AI never asserts an unverified figure as fact.
export function KnowledgeCreateForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const raw = {
      title: fd.get('title'),
      kind: fd.get('kind'),
      category: fd.get('category'),
      summary: fd.get('summary'),
      content: fd.get('content'),
      tags: String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
      status: fd.get('status'),
      visibility: fd.get('visibility'),
      is_assumption: fd.get('is_assumption') === 'on',
    }
    const parsed = KnowledgeCreateSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ document: { id: string } }>('/api/knowledge', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Added to the Knowledge Library.')
    router.refresh()
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add document</Button>
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="title" label="Title" required error={errors.title}><Input name="title" /></Field>
        <Field id="kind" label="Kind" error={errors.kind}>
          <Select name="kind" defaultValue="document">{KNOWLEDGE_KIND.map((k) => (<option key={k} value={k}>{k.replace(/_/g, ' ')}</option>))}</Select>
        </Field>
        <Field id="category" label="Category" error={errors.category}><Input name="category" placeholder="compliance, products, operations…" /></Field>
        <Field id="tags" label="Tags (comma-separated)" error={errors.tags}><Input name="tags" placeholder="consent, quiet-hours" /></Field>
      </div>
      <Field id="summary" label="Summary" hint="One or two sentences the AI can cite as background." error={errors.summary}>
        <Textarea name="summary" rows={2} />
      </Field>
      <Field id="content" label="Content" error={errors.content}>
        <Textarea name="content" rows={6} placeholder="Full text the AI retrieves from when responding to a contact." />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="status" label="Status" error={errors.status}>
          <Select name="status" defaultValue="published"><option value="published">published</option><option value="draft">draft</option></Select>
        </Field>
        <Field id="visibility" label="Visibility" error={errors.visibility}>
          <Select name="visibility" defaultValue="internal"><option value="internal">internal</option><option value="client_safe">client-safe</option></Select>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="is_assumption" className="h-4 w-4" />
          <span>Config default — verify (Farmers-specific)</span>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add to library'}</Button>
      </div>
    </form>
  )
}
