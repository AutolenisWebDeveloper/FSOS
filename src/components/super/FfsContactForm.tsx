'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { FfsContactSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export interface ExistingContact {
  id: string
  role: string
  name: string | null
  phone: string
  hours: string | null
  note: string | null
  sort: number
  active: boolean
}

// Add or edit an FFS key contact (config-driven directory, §2.4). Editing loads a
// row into the form; saving with no id creates a new contact.
export function FfsContactForm({ contacts }: { contacts: ExistingContact[] }) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string>('')
  const formRef = React.useRef<HTMLFormElement>(null)

  function setField(name: string, value: string) {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null
    if (el) el.value = value
  }
  function fillForm(c: ExistingContact | null) {
    setEditingId(c?.id ?? '')
    setField('role', c?.role ?? '')
    setField('name', c?.name ?? '')
    setField('phone', c?.phone ?? '')
    setField('hours', c?.hours ?? '')
    setField('note', c?.note ?? '')
    setField('sort', String(c?.sort ?? contacts.length + 1))
    const activeEl = formRef.current?.elements.namedItem('active') as HTMLInputElement | null
    if (activeEl) activeEl.checked = c ? c.active : true
    setErrors({})
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const raw: Record<string, unknown> = Object.fromEntries(fd.entries())
    raw.active = fd.get('active') === 'on'
    if (editingId) raw.id = editingId
    const parsed = FfsContactSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson('/api/super/config/ffs-contacts', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success(editingId ? 'Contact updated' : 'Contact added')
    fillForm(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {contacts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Edit:</span>
          {contacts.map((c) => (
            <Button key={c.id} type="button" variant="outline" size="sm" onClick={() => fillForm(c)}>
              {c.role}
            </Button>
          ))}
          {editingId ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => fillForm(null)}>
              + New instead
            </Button>
          ) : null}
        </div>
      ) : null}
      <form ref={formRef} onSubmit={onSubmit} className="space-y-4" noValidate>
        <p className="text-sm font-medium">{editingId ? 'Editing contact' : 'Add contact'}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="role" label="Role" required error={errors.role} hint="e.g. FSD — Central (TX)">
            <Input name="role" type="text" />
          </Field>
          <Field id="name" label="Name" error={errors.name} hint="Blank for a desk line">
            <Input name="name" type="text" />
          </Field>
          <Field id="phone" label="Phone" required error={errors.phone}>
            <Input name="phone" type="tel" placeholder="(818) 584-0264" />
          </Field>
          <Field id="hours" label="Hours" error={errors.hours}>
            <Input name="hours" type="text" placeholder="Mon–Fri 7AM–5PM PT" />
          </Field>
          <Field id="note" label="Note" error={errors.note}>
            <Input name="note" type="text" placeholder="Opt 3 → 3" />
          </Field>
          <Field id="sort" label="Sort order" error={errors.sort}>
            <Input name="sort" type="number" min={0} step="1" defaultValue={String(contacts.length + 1)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input name="active" type="checkbox" defaultChecked className="h-4 w-4" />
          Active (shown in the sidebar)
        </label>
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update contact' : 'Add contact'}</Button>
        </div>
      </form>
    </div>
  )
}
