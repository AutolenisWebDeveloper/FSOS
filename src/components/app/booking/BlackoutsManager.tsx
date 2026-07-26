'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/archetypes'
import { postJson, deleteJson, firstFieldError } from '@/lib/client/api'
import { BlackoutCreate } from '@/lib/booking/config-schemas'

export interface BlackoutRow {
  id: string
  starts_at: string
  ends_at: string
  reason: string | null
}

const EMPTY = { starts_at: '', ends_at: '', reason: '' }

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Convert a datetime-local value (browser-local wall time) to a UTC ISO string. */
function localToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function BlackoutsManager({ initialBlackouts }: { initialBlackouts: BlackoutRow[] }) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [form, setForm] = React.useState({ ...EMPTY })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const startsIso = localToIso(form.starts_at)
    const endsIso = localToIso(form.ends_at)
    if (!startsIso) return setErrors({ starts_at: 'Enter a valid start date and time' })
    if (!endsIso) return setErrors({ ends_at: 'Enter a valid end date and time' })
    const payload = { starts_at: startsIso, ends_at: endsIso, reason: form.reason.trim() || undefined }
    const parsed = BlackoutCreate.safeParse(payload)
    if (!parsed.success) {
      const flat = parsed.error.flatten()
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(flat.fieldErrors)) if (v?.[0]) next[k] = v[0]
      if (flat.formErrors[0] && !next.ends_at) next.ends_at = flat.formErrors[0]
      setErrors(next)
      return
    }
    setSaving(true)
    const res = await postJson('/api/app/booking/blackouts', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Added blackout.')
    setForm({ ...EMPTY })
    setAdding(false)
    router.refresh()
  }

  async function remove(b: BlackoutRow) {
    setBusyId(b.id)
    const res = await deleteJson(`/api/app/booking/blackouts/${b.id}`)
    setBusyId(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Removed blackout.')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {initialBlackouts.length === 0 ? (
        <EmptyState title="No blackouts" description="Add ranges you're unavailable — vacations, holidays, or personal holds." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialBlackouts.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-nowrap">{fmt(b.starts_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmt(b.ends_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{b.reason || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" loading={busyId === b.id} onClick={() => remove(b)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {adding ? (
        <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bo-start" label="From" required error={errors.starts_at}>
              <Input name="starts_at" type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
            </Field>
            <Field id="bo-end" label="To" required error={errors.ends_at}>
              <Input name="ends_at" type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
            </Field>
          </div>
          <Field id="bo-reason" label="Reason" error={errors.reason} hint="Optional — for your reference only">
            <Input name="reason" value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Vacation" />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={saving}>
              {saving ? 'Adding…' : 'Add blackout'}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setAdding(false); setErrors({}) }} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add blackout
        </Button>
      )}
    </div>
  )
}
