'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { WebhookCreateSchema, WEBHOOK_EVENTS } from '@/lib/validation/schemas'
import { postJson, patchJson, firstFieldError } from '@/lib/client/api'

export function WebhookForm() {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [targetUrl, setTargetUrl] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [events, setEvents] = React.useState<string[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  function toggleEvent(ev: string, checked: boolean) {
    setEvents((prev) => (checked ? [...prev, ev] : prev.filter((e) => e !== ev)))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const payload = {
      name,
      target_url: targetUrl,
      events,
      secret: secret.trim() ? secret.trim() : undefined,
    }
    const parsed = WebhookCreateSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson<{ webhook: { id: string } }>('/api/super/webhooks', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Webhook created.')
    setName('')
    setTargetUrl('')
    setSecret('')
    setEvents([])
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" required error={errors.name}>
          <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops event stream" />
        </Field>
        <Field id="target_url" label="Target URL" required error={errors.target_url}>
          <Input id="target_url" name="target_url" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com/hooks/fsos" />
        </Field>
      </div>
      <Field id="events" label="Events" required error={errors.events} hint="At least one event subscription.">
        <div className="flex flex-wrap gap-3">
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={events.includes(ev)}
                onChange={(e) => toggleEvent(ev, e.target.checked)}
              />
              {ev}
            </label>
          ))}
        </div>
      </Field>
      <Field id="secret" label="Signing secret (optional)" error={errors.secret} hint="Write-only. Used to sign outbound payloads; never displayed again.">
        <Input id="secret" name="secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="whsec_…" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create webhook'}</Button>
      </div>
    </form>
  )
}

export function WebhookControls({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function toggle() {
    setBusy(true)
    const res = await patchJson<{ webhook: { id: string } }>(`/api/super/webhooks/${id}`, { enabled: !enabled })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(enabled ? 'Webhook disabled.' : 'Webhook enabled.')
    router.refresh()
  }

  return (
    <Button size="sm" variant={enabled ? 'outline' : 'default'} onClick={toggle} disabled={busy}>
      {busy ? '…' : enabled ? 'Disable' : 'Enable'}
    </Button>
  )
}
