'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, StatusBadge } from '@/components/archetypes'
import { postJson, patchJson, deleteJson, firstFieldError, type ApiError } from '@/lib/client/api'
import { AvailabilityRuleCreate } from '@/lib/booking/config-schemas'
import { WEEKDAYS, COMMON_TIMEZONES, weekdayLabel, formatWallTime } from '@/lib/booking/display'

export interface AvailabilityRuleRow {
  id: string
  weekday: number
  start_time: string
  end_time: string
  timezone: string
  effective_start: string | null
  effective_end: string | null
  active: boolean
}

const EMPTY = { weekday: '1', start_time: '09:00', end_time: '17:00', timezone: 'America/Chicago' }

// The stored time may come back as "09:00:00"; trim to HH:MM for display + edit parity.
const hhmm = (t: string) => t.slice(0, 5)

function formFromRule(r: AvailabilityRuleRow) {
  return { weekday: String(r.weekday), start_time: hhmm(r.start_time), end_time: hhmm(r.end_time), timezone: r.timezone }
}

/** A 409 the config service returns when a narrowing change would strand existing appointments. */
function isConflict(err: ApiError): boolean {
  return err.reason === 'availability_conflict'
}

export function AvailabilityRulesManager({ initialRules }: { initialRules: AvailabilityRuleRow[] }) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  // The id of the window being edited; null when the form is in "add" mode.
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({ ...EMPTY })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  function resetForm() {
    setForm({ ...EMPTY })
    setErrors({})
    setEditingId(null)
    setAdding(false)
  }

  function startEdit(r: AvailabilityRuleRow) {
    setForm(formFromRule(r))
    setErrors({})
    setEditingId(r.id)
    setAdding(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return // guard against a re-entrant submit while a save is already in flight
    setErrors({})
    const payload = {
      weekday: Number(form.weekday),
      start_time: form.start_time,
      end_time: form.end_time,
      timezone: form.timezone.trim(),
    }
    const parsed = AvailabilityRuleCreate.safeParse(payload)
    if (!parsed.success) {
      const flat = parsed.error.flatten()
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(flat.fieldErrors)) if (v?.[0]) next[k] = v[0]
      if (flat.formErrors[0] && !next.end_time) next.end_time = flat.formErrors[0]
      setErrors(next)
      return
    }

    // Editing a window can NARROW availability; the PATCH route returns a 409 listing the future
    // appointments that would fall outside the new hours (kept unchanged, never auto-moved). We
    // surface them and retry with `acknowledge` only on explicit confirmation.
    async function saveEdit(id: string, acknowledge: boolean) {
      return patchJson(`/api/app/booking/rules/${id}`, { ...parsed.data, ...(acknowledge ? { acknowledge: true } : {}) })
    }

    setSaving(true)
    let res = editingId ? await saveEdit(editingId, false) : await postJson('/api/app/booking/rules', parsed.data)
    if (editingId && !res.ok && res.status === 409 && isConflict(res.error)) {
      setSaving(false)
      if (!window.confirm(`${res.error.error}\n\nThose appointments are kept unchanged. Save these hours anyway?`)) return
      setSaving(true)
      res = await saveEdit(editingId, true)
    }
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success(editingId ? `Updated ${weekdayLabel(payload.weekday)} hours.` : `Added ${weekdayLabel(payload.weekday)} hours.`)
    resetForm()
    router.refresh()
  }

  // Mark a day/window unavailable (active:false) or restore it (active:true) WITHOUT deleting it, so
  // the schedule can be paused and brought back. Making a window unavailable narrows availability, so
  // it goes through the same 409 acknowledge guard; restoring only widens, so it never conflicts.
  async function toggleActive(r: AvailabilityRuleRow, acknowledge = false) {
    setBusyId(r.id)
    const res = await patchJson(`/api/app/booking/rules/${r.id}`, { active: !r.active, ...(acknowledge ? { acknowledge: true } : {}) })
    setBusyId(null)
    if (!res.ok) {
      if (res.status === 409 && isConflict(res.error)) {
        if (window.confirm(`${res.error.error}\n\nThose appointments are kept unchanged. Mark this window unavailable anyway?`)) {
          await toggleActive(r, true)
        }
        return
      }
      return toast.error(firstFieldError(res.error).message)
    }
    toast.success(r.active ? `${weekdayLabel(r.weekday)} window marked unavailable.` : `${weekdayLabel(r.weekday)} window restored.`)
    router.refresh()
  }

  async function remove(r: AvailabilityRuleRow, acknowledge = false) {
    if (!acknowledge && !window.confirm(`Remove the ${weekdayLabel(r.weekday)} ${formatWallTime(hhmm(r.start_time))}–${formatWallTime(hhmm(r.end_time))} window?`)) return
    setBusyId(r.id)
    const res = await deleteJson(`/api/app/booking/rules/${r.id}${acknowledge ? '?acknowledge=true' : ''}`)
    setBusyId(null)
    if (!res.ok) {
      // Narrowing this window would leave existing appointments outside your hours. Surface them and
      // require an explicit acknowledge — never silently orphan, never auto-cancel/move them.
      if (res.status === 409 && isConflict(res.error)) {
        if (window.confirm(`${res.error.error}\n\nThe appointments are kept unchanged. Remove this window anyway?`)) {
          await remove(r, true)
        }
        return
      }
      return toast.error(firstFieldError(res.error).message)
    }
    toast.success('Removed availability window.')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {initialRules.length === 0 ? (
        <EmptyState
          title="No hours set"
          description="Add the weekly windows you're available — for example Monday–Friday, 9:00 AM to 5:00 PM."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialRules.map((r) => (
                <TableRow key={r.id} className={r.active ? undefined : 'opacity-60'}>
                  <TableCell className="font-medium">{weekdayLabel(r.weekday)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatWallTime(hhmm(r.start_time))} – {formatWallTime(hhmm(r.end_time))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{r.timezone}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.active ? 'active' : 'draft'} label={r.active ? 'Available' : 'Unavailable'} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busyId !== null || saving} onClick={() => startEdit(r)}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" loading={busyId === r.id} onClick={() => toggleActive(r)}>
                        {r.active ? 'Mark unavailable' : 'Restore'}
                      </Button>
                      <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => remove(r)}>
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {adding ? (
        <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {editingId ? `Edit ${weekdayLabel(Number(form.weekday))} hours` : 'Add weekly hours'}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="ar-weekday" label="Day" required error={errors.weekday}>
              <Select name="weekday" value={form.weekday} onChange={(e) => set('weekday', e.target.value)}>
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.long}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="ar-start" label="Start" required error={errors.start_time}>
              <Input name="start_time" type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
            </Field>
            <Field id="ar-end" label="End" required error={errors.end_time}>
              <Input name="end_time" type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
            </Field>
            <Field id="ar-tz" label="Timezone" required error={errors.timezone}>
              <Select name="timezone" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add hours'}
            </Button>
            <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => { resetForm(); setAdding(true) }}>
          Add hours
        </Button>
      )}
    </div>
  )
}
