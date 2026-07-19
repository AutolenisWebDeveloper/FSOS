'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CASE_STATUS } from '@/lib/validation/schemas'
import { postJson, patchJson, firstFieldError } from '@/lib/client/api'

export function CaseStatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [target, setTarget] = React.useState(status)
  const [saving, setSaving] = React.useState(false)

  async function save() {
    if (target === status) return
    setSaving(true)
    const res = await patchJson<{ commission_id: string | null }>(`/api/cases/${id}`, { status: target })
    setSaving(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); setTarget(status); return }
    if (target === 'issued' && res.data.commission_id) toast.success('Issued — commission record created from split defaults.')
    else toast.success('Status updated')
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`cs-${id}`}>Case status</label>
      <Select id={`cs-${id}`} className="h-8 w-56 text-xs" value={target} onChange={(e) => setTarget(e.target.value)} disabled={saving}>
        {CASE_STATUS.map((s) => (<option key={s} value={s}>{s.replace(/_/g, ' ')}</option>))}
      </Select>
      <Button size="sm" variant="outline" onClick={save} disabled={saving || target === status}>{saving ? '…' : 'Update'}</Button>
    </div>
  )
}

export interface Requirement { id: string; requirement: string; status: string; source: string | null }

export function CaseRequirements({ caseId, requirements }: { caseId: string; requirements: Requirement[] }) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [text, setText] = React.useState('')

  async function add() {
    if (!text.trim()) return
    setAdding(true)
    const res = await postJson(`/api/cases/${caseId}/requirements`, { requirement: text.trim(), source: 'manual' })
    setAdding(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    setText('')
    toast.success('Requirement added')
    router.refresh()
  }

  async function resolve(id: string, status: string) {
    const res = await patchJson(`/api/cases/${caseId}/requirements`, { requirement_id: id, status })
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success('Requirement updated')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Add a requirement…" value={text} onChange={(e) => setText(e.target.value)} aria-label="New requirement" />
        <Button onClick={add} disabled={adding || !text.trim()}>{adding ? '…' : 'Add'}</Button>
      </div>
      {requirements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requirements. Add carrier or checklist items above.</p>
      ) : (
        <ul className="space-y-1.5">
          {requirements.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span className={r.status !== 'outstanding' ? 'text-muted-foreground line-through' : ''}>{r.requirement} <span className="text-xs text-muted-foreground">· {r.source}</span></span>
              <span className="flex gap-1">
                {r.status === 'outstanding' ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => resolve(r.id, 'received')}>Received</Button>
                    <Button size="sm" variant="ghost" onClick={() => resolve(r.id, 'waived')}>Waive</Button>
                  </>
                ) : <span className="text-xs capitalize text-status-won">{r.status}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CaseCreateButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  async function open() {
    setSaving(true)
    const res = await postJson<{ case: { id: string } }>('/api/cases', { opportunity_id: opportunityId })
    setSaving(false)
    if (!res.ok) {
      if (res.error.reason === 'securities_scope') { toast.error('Securities case requires securities scope. Escalated.'); return }
      toast.error(firstFieldError(res.error).message); return
    }
    toast.success('Case opened')
    router.push(`/app/cases/${res.data.case.id}`)
  }
  return <Button onClick={open} disabled={saving}>{saving ? 'Opening…' : 'Open a case'}</Button>
}
