'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/forms/Field'
import { TEMPLATE_CATEGORY, TemplateCreateSchema } from '@/lib/validation/schemas'
import { postJson, patchJson, firstFieldError } from '@/lib/client/api'
import { FORMAT_LABELS, campaignLabel, type CatalogTemplate } from '@/lib/comms/template-catalog'

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

/**
 * The list row is the derived catalog row: `format` (email / SMS / AI conversation) and
 * `campaigns` come from `@/lib/comms/template-catalog`, so the table shows the same two
 * axes the view filters operate on.
 */
export type TemplateRow = CatalogTemplate

function approvalBadgeVariant(status: string): 'won' | 'pending' | 'draft' {
  return status === 'approved' ? 'won' : status === 'submitted' ? 'pending' : 'draft'
}

// A token-resolved native checkbox (accessible; `accent-primary` themes the check).
function RowCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
  )
}

// OS-12 Templates list with bulk administration (§8 command-bar pattern). Selection
// surfaces a scoped command bar: Approve / Unapprove (approvers only) + Delete
// (confirmed). Server enforces authority + state transitions — this is UX only.
export function TemplateBulkTable({ templates, canApprove }: { templates: TemplateRow[]; canApprove: boolean }) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  // Drop selections that no longer exist after a refresh (e.g. deleted rows).
  React.useEffect(() => {
    setSelected((prev) => {
      const live = new Set(templates.map((t) => t.id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [templates])

  const allSelected = templates.length > 0 && selected.size === templates.length
  const someSelected = selected.size > 0

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === templates.length ? new Set() : new Set(templates.map((t) => t.id))))
  }

  async function runBulk(action: 'approve' | 'unapprove' | 'delete') {
    if (selected.size === 0) return
    setBusy(true)
    const res = await postJson<{ affected: number; requested: number }>('/api/comms/templates/bulk', {
      action,
      ids: [...selected],
    })
    setBusy(false)
    setConfirmDelete(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    const { affected, requested } = res.data
    const verb = action === 'approve' ? 'Approved' : action === 'unapprove' ? 'Unapproved' : 'Deleted'
    if (affected === 0) toast.message(`No templates ${verb.toLowerCase()} — none of the ${requested} selected were eligible.`)
    else if (affected < requested) toast.success(`${verb} ${affected} of ${requested}. ${requested - affected} were not eligible and were skipped.`)
    else toast.success(`${verb} ${affected} template${affected === 1 ? '' : 's'}.`)
    setSelected(new Set())
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {/* Command bar (§8) — appears on selection: count + scoped actions + clear. */}
      {someSelected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2" role="region" aria-label="Bulk actions">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canApprove ? (
              <>
                <Button size="sm" onClick={() => runBulk('approve')} disabled={busy}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => runBulk('unapprove')} disabled={busy}>Unapprove</Button>
              </>
            ) : null}
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>Clear</Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <RowCheckbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} label="Select all templates" />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id} data-state={selected.has(t.id) ? 'selected' : undefined}>
                <TableCell>
                  <RowCheckbox checked={selected.has(t.id)} onChange={() => toggle(t.id)} label={`Select ${t.name}`} />
                </TableCell>
                <TableCell><Link href={`/app/comms/templates/${t.id}`} className="font-medium text-primary hover:underline">{t.name}</Link></TableCell>
                <TableCell><Badge variant="outline">{FORMAT_LABELS[t.format]}</Badge></TableCell>
                <TableCell className="text-muted-foreground">
                  {/* A template reused by several campaigns lists each — the console can send any of them. */}
                  <span className="flex flex-wrap gap-1">
                    {t.campaigns.map((c) => (
                      <Badge key={c} variant="secondary" className="font-normal">{campaignLabel(c)}</Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="capitalize text-muted-foreground">{(t.category ?? '').replace(/_/g, ' ')}</TableCell>
                <TableCell>v{t.version}</TableCell>
                <TableCell><Badge variant={approvalBadgeVariant(t.approval_status)}>{t.approval_status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmDelete} onOpenChange={(o) => !busy && setConfirmDelete(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} template{selected.size === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              Deleted templates are archived and can no longer be used by any campaign or agent. Message and campaign
              history is preserved. This cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => runBulk('delete')} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
