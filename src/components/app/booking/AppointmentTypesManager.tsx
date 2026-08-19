'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/archetypes'
import { Field } from '@/components/forms/Field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/archetypes'
import { postJson, patchJson, deleteJson, firstFieldError } from '@/lib/client/api'
import { AppointmentTypeCreate, MEETING_MODES } from '@/lib/booking/config-schemas'
import { meetingModeLabel } from '@/lib/booking/display'

export interface AppointmentTypeRow {
  id: string
  name: string
  slug: string
  description: string | null
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  min_notice_minutes: number
  max_lead_days: number
  max_per_day: number | null
  slot_interval_minutes: number
  meeting_mode: string
  active: boolean
}

const EMPTY = {
  name: '',
  slug: '',
  description: '',
  duration_minutes: '30',
  buffer_before_minutes: '0',
  buffer_after_minutes: '0',
  min_notice_minutes: '240',
  max_lead_days: '60',
  max_per_day: '',
  slot_interval_minutes: '30',
  meeting_mode: 'video',
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Row → the form's string-valued shape, for prefilling the edit form. */
function formFromRow(t: AppointmentTypeRow) {
  return {
    name: t.name,
    slug: t.slug,
    description: t.description ?? '',
    duration_minutes: String(t.duration_minutes),
    buffer_before_minutes: String(t.buffer_before_minutes),
    buffer_after_minutes: String(t.buffer_after_minutes),
    min_notice_minutes: String(t.min_notice_minutes),
    max_lead_days: String(t.max_lead_days),
    max_per_day: t.max_per_day == null ? '' : String(t.max_per_day),
    slot_interval_minutes: String(t.slot_interval_minutes),
    meeting_mode: t.meeting_mode,
  }
}

export function AppointmentTypesManager({ initialTypes }: { initialTypes: AppointmentTypeRow[] }) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  // The id of the type currently being edited; null when the form is in "create" mode.
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({ ...EMPTY })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [slugTouched, setSlugTouched] = React.useState(false)

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  function resetForm() {
    setForm({ ...EMPTY })
    setSlugTouched(false)
    setErrors({})
    setEditingId(null)
    setAdding(false)
  }

  function startEdit(t: AppointmentTypeRow) {
    setForm(formFromRow(t))
    setSlugTouched(true) // an existing slug must not be silently rewritten from the name
    setErrors({})
    setEditingId(t.id)
    setAdding(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    // Empty optionals are sent as null (not undefined) so an edit can CLEAR them; both are nullish
    // in the schema, so this is also correct for create.
    const payload = {
      name: form.name.trim(),
      slug: (slugTouched ? form.slug : slugify(form.name)).trim(),
      description: form.description.trim() || null,
      duration_minutes: Number(form.duration_minutes),
      buffer_before_minutes: Number(form.buffer_before_minutes),
      buffer_after_minutes: Number(form.buffer_after_minutes),
      min_notice_minutes: Number(form.min_notice_minutes),
      max_lead_days: Number(form.max_lead_days),
      max_per_day: form.max_per_day.trim() ? Number(form.max_per_day) : null,
      slot_interval_minutes: Number(form.slot_interval_minutes),
      meeting_mode: form.meeting_mode,
    }
    // AppointmentTypeCreate validates the full shape; the PATCH route re-validates with the partial
    // AppointmentTypeUpdate. Editing duration/mode is safe for HISTORY: book.ts snapshots
    // duration_minutes + meeting_mode onto each appointment at booking time, so past appointments
    // keep their own values; only FUTURE bookings use the new config.
    const parsed = AppointmentTypeCreate.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(fe)) if (v?.[0]) next[k] = v[0]
      setErrors(next)
      return
    }
    setSaving(true)
    const res = editingId
      ? await patchJson(`/api/app/booking/types/${editingId}`, parsed.data)
      : await postJson('/api/app/booking/types', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success(editingId ? `Saved “${payload.name}”.` : `Added “${payload.name}”.`)
    resetForm()
    router.refresh()
  }

  async function toggleActive(t: AppointmentTypeRow) {
    setBusyId(t.id)
    const res = await patchJson(`/api/app/booking/types/${t.id}`, { active: !t.active })
    setBusyId(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(t.active ? `“${t.name}” hidden from booking.` : `“${t.name}” is now bookable.`)
    router.refresh()
  }

  async function remove(t: AppointmentTypeRow) {
    if (!window.confirm(`Delete the “${t.name}” appointment type? Existing appointments keep their history.`)) return
    setBusyId(t.id)
    const res = await deleteJson(`/api/app/booking/types/${t.id}`)
    setBusyId(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(`Deleted “${t.name}”.`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {initialTypes.length === 0 ? (
        <EmptyState
          title="No appointment types yet"
          description="Add your first bookable appointment type — for example a 30-minute intro call."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Buffers</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialTypes.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">/{t.slug}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{t.duration_minutes} min</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {t.buffer_before_minutes}/{t.buffer_after_minutes} min
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{meetingModeLabel(t.meeting_mode)}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.active ? 'active' : 'draft'} label={t.active ? 'Active' : 'Hidden'} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busyId !== null || saving} onClick={() => startEdit(t)}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" loading={busyId === t.id} onClick={() => toggleActive(t)}>
                        {t.active ? 'Hide' : 'Activate'}
                      </Button>
                      <Button variant="ghost" size="sm" loading={busyId === t.id} onClick={() => remove(t)}>
                        Delete
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
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {editingId ? `Edit “${form.name || 'appointment type'}”` : 'New appointment type'}
            </h3>
            {editingId ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Changes apply to future bookings only. Existing appointments keep the duration and
                format they were booked with.
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="at-name" label="Name" required error={errors.name} hint="e.g. Intro call, Policy review">
              <Input
                name="name"
                value={form.name}
                onChange={(e) => {
                  set('name', e.target.value)
                  if (!slugTouched) set('slug', slugify(e.target.value))
                }}
                placeholder="Intro call"
              />
            </Field>
            <Field id="at-slug" label="URL slug" required error={errors.slug} hint="Used in the booking link">
              <Input
                name="slug"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  set('slug', e.target.value)
                }}
                placeholder="intro-call"
              />
            </Field>
          </div>
          <Field id="at-description" label="Description" error={errors.description} hint="Shown to the client on the booking page">
            <Textarea
              name="description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="A quick introduction to see how I can help."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="at-duration" label="Duration (min)" required error={errors.duration_minutes}>
              <Input name="duration_minutes" inputMode="numeric" value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} />
            </Field>
            <Field id="at-interval" label="Slot interval (min)" error={errors.slot_interval_minutes} hint="How far apart start times are">
              <Input name="slot_interval_minutes" inputMode="numeric" value={form.slot_interval_minutes} onChange={(e) => set('slot_interval_minutes', e.target.value)} />
            </Field>
            <Field id="at-mode" label="Meeting mode" error={errors.meeting_mode}>
              <Select name="meeting_mode" value={form.meeting_mode} onChange={(e) => set('meeting_mode', e.target.value)}>
                {MEETING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {meetingModeLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="at-buf-before" label="Buffer before (min)" error={errors.buffer_before_minutes}>
              <Input name="buffer_before_minutes" inputMode="numeric" value={form.buffer_before_minutes} onChange={(e) => set('buffer_before_minutes', e.target.value)} />
            </Field>
            <Field id="at-buf-after" label="Buffer after (min)" error={errors.buffer_after_minutes}>
              <Input name="buffer_after_minutes" inputMode="numeric" value={form.buffer_after_minutes} onChange={(e) => set('buffer_after_minutes', e.target.value)} />
            </Field>
            <Field id="at-notice" label="Min notice (min)" error={errors.min_notice_minutes} hint="Can't book sooner than this">
              <Input name="min_notice_minutes" inputMode="numeric" value={form.min_notice_minutes} onChange={(e) => set('min_notice_minutes', e.target.value)} />
            </Field>
            <Field id="at-lead" label="Max lead (days)" error={errors.max_lead_days} hint="Can't book further out">
              <Input name="max_lead_days" inputMode="numeric" value={form.max_lead_days} onChange={(e) => set('max_lead_days', e.target.value)} />
            </Field>
          </div>
          <Field id="at-perday" label="Max per day" error={errors.max_per_day} hint="Optional — leave blank for unlimited">
            <Input name="max_per_day" inputMode="numeric" value={form.max_per_day} onChange={(e) => set('max_per_day', e.target.value)} placeholder="Unlimited" />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add appointment type'}
            </Button>
            <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => { resetForm(); setAdding(true) }}>
          Add appointment type
        </Button>
      )}
    </div>
  )
}
