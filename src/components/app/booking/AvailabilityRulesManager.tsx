'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/archetypes'
import { postJson, deleteJson, firstFieldError } from '@/lib/client/api'
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

export function AvailabilityRulesManager({ initialRules }: { initialRules: AvailabilityRuleRow[] }) {
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
    setSaving(true)
    const res = await postJson('/api/app/booking/rules', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success(`Added ${weekdayLabel(payload.weekday)} hours.`)
    setForm({ ...EMPTY })
    setAdding(false)
    router.refresh()
  }

  async function remove(r: AvailabilityRuleRow) {
    setBusyId(r.id)
    const res = await deleteJson(`/api/app/booking/rules/${r.id}`)
    setBusyId(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialRules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{weekdayLabel(r.weekday)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatWallTime(hhmm(r.start_time))} – {formatWallTime(hhmm(r.end_time))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{r.timezone}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" loading={busyId === r.id} onClick={() => remove(r)}>
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
              {saving ? 'Adding…' : 'Add hours'}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setAdding(false); setErrors({}) }} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add hours
        </Button>
      )}
    </div>
  )
}
