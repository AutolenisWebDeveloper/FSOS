'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { postJson, firstFieldError } from '@/lib/client/api'

const CHANNELS = ['sms', 'email', 'call', 'all'] as const

// Public opt-out / do-not-contact form. Posts to the unauthenticated consent
// endpoint and adds the contact to the internal do-not-contact list.
export function ConsentForm() {
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [done, setDone] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const contact = String(fd.get('contact') ?? '').trim()
    const channel = String(fd.get('channel') ?? 'all')
    if (contact.length < 3) {
      setErrors({ contact: 'Enter a valid email or phone' })
      return
    }
    setSaving(true)
    const res = await postJson<{ ok: true }>('/api/public/consent', { contact, channel, action: 'opt_out' })
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('You have been added to our do-not-contact list.')
    setDone(true)
  }

  if (done) {
    return (
      <div role="status" className="rounded-md border border-status-won/40 bg-status-won/10 p-4 text-sm">
        <p className="font-medium">You&apos;re opted out.</p>
        <p className="mt-1 text-muted-foreground">
          We&apos;ve added you to our internal do-not-contact list for the channel you selected. It may take a short time
          for any already-scheduled messages to stop.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field id="contact" label="Email or phone" required error={errors.contact}>
        <Input name="contact" placeholder="name@example.com or (972) 555-0100" autoComplete="off" />
      </Field>
      <Field id="channel" label="Channel to stop" error={errors.channel}>
        <Select name="channel" defaultValue="all">
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All channels' : c.toUpperCase()}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-muted-foreground">
        Submitting this adds you to our do-not-contact list so we stop reaching out on the selected channel.
      </p>
      <Button type="submit" variant="destructive" className="w-full" disabled={saving}>
        {saving ? 'Submitting…' : 'Opt out / Do not contact'}
      </Button>
    </form>
  )
}
