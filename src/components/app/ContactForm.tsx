'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { postJson, patchJson, firstFieldError, type ApiError } from '@/lib/client/api'
import { CONTACT_TYPE_LABEL } from '@/components/app/contactMeta'

const TYPES = ['agency_owner', 'client', 'prospect', 'term_conversion', 'cross_sell', 'business', 'unknown']

export interface ContactInitial {
  id?: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
  title?: string | null
  contact_type?: string
  tags?: string[]
  source?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  notes?: string | null
}

export function ContactForm({ mode, initial }: { mode: 'create' | 'edit'; initial?: ContactInitial }) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [dupe, setDupe] = React.useState<{ id: string; full_name: string } | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  async function doSubmit(force = false) {
    const form = formRef.current
    if (!form) return
    setErrors({})
    const fd = new FormData(form)
    const payload = {
      first_name: String(fd.get('first_name') || ''),
      last_name: String(fd.get('last_name') || ''),
      email: String(fd.get('email') || ''),
      phone: String(fd.get('phone') || ''),
      company: String(fd.get('company') || ''),
      title: String(fd.get('title') || ''),
      contact_type: String(fd.get('contact_type') || 'unknown'),
      tags: String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
      source: String(fd.get('source') || ''),
      city: String(fd.get('city') || ''),
      state: String(fd.get('state') || ''),
      zip: String(fd.get('zip') || ''),
      notes: String(fd.get('notes') || ''),
      ...(force ? { force: true } : {}),
    }
    setBusy(true)
    const res = mode === 'create' ? await postJson<{ id: string }>('/api/app/contacts', payload) : await patchJson<{ ok: boolean }>(`/api/app/contacts/${initial?.id}`, payload)
    setBusy(false)
    if (!res.ok) {
      const err = res.error as ApiError
      if (err.reason === 'duplicate' && (err as unknown as { duplicate?: { id: string; full_name: string } }).duplicate) {
        setDupe((err as unknown as { duplicate: { id: string; full_name: string } }).duplicate)
        return
      }
      if (err.details?.fieldErrors) {
        const fe: Record<string, string> = {}
        for (const [k, v] of Object.entries(err.details.fieldErrors)) if (v?.[0]) fe[k] = v[0]
        setErrors(fe)
      }
      toast.error(firstFieldError(err).message)
      return
    }
    toast.success(mode === 'create' ? 'Contact added.' : 'Contact updated.')
    if (mode === 'create') router.push(`/app/contacts/${(res.data as { id: string }).id}`)
    else router.refresh()
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); doSubmit(false) }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="first_name" label="First name" defaultValue={initial?.first_name} error={errors.first_name} />
            <Field id="last_name" label="Last name" defaultValue={initial?.last_name} error={errors.last_name} />
            <Field id="email" label="Email" type="email" defaultValue={initial?.email} error={errors.email} />
            <Field id="phone" label="Phone" defaultValue={initial?.phone} error={errors.phone} />
            <Field id="company" label="Company" defaultValue={initial?.company} error={errors.company} />
            <Field id="title" label="Title" defaultValue={initial?.title} error={errors.title} />
            <div className="space-y-1.5">
              <Label htmlFor="contact_type">Type</Label>
              <Select id="contact_type" name="contact_type" defaultValue={initial?.contact_type || 'unknown'}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{CONTACT_TYPE_LABEL[t] ?? t}</option>
                ))}
              </Select>
            </div>
            <Field id="source" label="Source" defaultValue={initial?.source} placeholder="manual" />
            <Field id="tags" label="Tags (comma-separated)" defaultValue={(initial?.tags || []).join(', ')} placeholder="warm-lead, event-2026" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="city" label="City" defaultValue={initial?.city} />
            <Field id="state" label="State" defaultValue={initial?.state} />
            <Field id="zip" label="ZIP" defaultValue={initial?.zip} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" defaultValue={initial?.notes ?? ''} rows={3} />
          </div>

          {dupe ? (
            <div className="rounded-md border border-status-pending/40 bg-status-pending/5 p-3 text-sm">
              A contact with this email or phone already exists:{' '}
              <a href={`/app/contacts/${dupe.id}`} className="font-medium text-primary hover:underline">{dupe.full_name}</a>.
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => doSubmit(true)}>Add anyway</Button>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : mode === 'create' ? 'Add contact' : 'Save changes'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({ id, label, defaultValue, error, type, placeholder }: { id: string; label: string; defaultValue?: string | null; error?: string; type?: string; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type={type} defaultValue={defaultValue ?? ''} placeholder={placeholder} aria-invalid={!!error} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
