'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { REPORT_SOURCES, ReportDefinitionSchema, ScheduledReportSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

// Split a comma-separated input into a trimmed, de-blanked array.
function toList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// A5/A11 — define a saved report. Every report is derived from a DB view (no drift);
// this only pins the source, chosen columns, and filters.
export function ReportBuilder() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const payload = {
      name: String(fd.get('name') ?? '').trim(),
      description: String(fd.get('description') ?? '').trim() || undefined,
      source_key: String(fd.get('source_key') ?? ''),
      columns: toList(fd.get('columns')),
      filters: {},
    }
    const parsed = ReportDefinitionSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ definition: { id: string } }>('/api/reports/definitions', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Report saved.')
    router.push('/app/reports')
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Report name" required error={errors.name}>
          <Input name="name" placeholder="Q3 pipeline by engagement" />
        </Field>
        <Field id="source_key" label="Source view" required error={errors.source_key} hint="Every report is derived from a DB view — no drift.">
          <Select name="source_key" defaultValue={REPORT_SOURCES[0]}>
            {REPORT_SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="columns" label="Columns" hint="Optional. Comma-separated; leave blank for the view's default columns." error={errors.columns}>
        <Input name="columns" placeholder="agency_name, total_commission, fsa_amount" />
      </Field>
      <Field id="description" label="Description" error={errors.description}>
        <Textarea name="description" rows={3} placeholder="What this report shows and who it's for." />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save report'}</Button>
      </div>
    </form>
  )
}

// Create a scheduled delivery. Runs via Vercel Cron; recipients receive the exported file.
export function ScheduledReportForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const payload = {
      report_key: String(fd.get('report_key') ?? ''),
      name: String(fd.get('name') ?? '').trim(),
      cadence: String(fd.get('cadence') ?? 'weekly'),
      format: String(fd.get('format') ?? 'csv'),
      recipients: toList(fd.get('recipients')),
    }
    const parsed = ScheduledReportSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ report: { id: string } }>('/api/reports/scheduled', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Schedule created.')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Schedule name" required error={errors.name}>
          <Input name="name" placeholder="Weekly commission digest" />
        </Field>
        <Field id="report_key" label="Report" required error={errors.report_key}>
          <Select name="report_key" defaultValue={REPORT_SOURCES[0]}>
            {REPORT_SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field id="cadence" label="Cadence" required error={errors.cadence}>
          <Select name="cadence" defaultValue="weekly">
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
          </Select>
        </Field>
        <Field id="format" label="Format" required error={errors.format}>
          <Select name="format" defaultValue="csv">
            <option value="csv">csv</option>
            <option value="pdf">pdf</option>
          </Select>
        </Field>
      </div>
      <Field id="recipients" label="Recipients" hint="Comma-separated email addresses. They receive the exported file each run." error={errors.recipients}>
        <Input name="recipients" placeholder="you@example.com, ops@example.com" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create schedule'}</Button>
      </div>
    </form>
  )
}
