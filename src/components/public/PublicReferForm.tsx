'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { ReferralCreateSchema, REFERRAL_ENGAGEMENT } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

// Public referral intake form. Validates with the same Zod schema as the server,
// carries a hidden honeypot for bot protection, and never collects securities data.
export function PublicReferForm() {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const raw = Object.fromEntries(fd.entries())
    // Native checkboxes only appear in FormData when checked; coerce to booleans.
    const payload = {
      ...raw,
      consent_sms: fd.get('consent_sms') === 'on',
      consent_email: fd.get('consent_email') === 'on',
    }
    const parsed = ReferralCreateSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    // Preserve the honeypot value so a bot's fill reaches the server-side trap.
    const res = await postJson<{ ok: true }>('/api/public/refer', {
      ...parsed.data,
      company: typeof raw.company === 'string' ? raw.company : '',
    })
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    router.push('/refer/success')
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* Honeypot: hidden from humans, tempting to bots. */}
      <div className="sr-only" aria-hidden>
        <label htmlFor="company">Company (leave blank)</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Field id="referred_name" label="Who would you like to refer?" required error={errors.referred_name}>
        <Input name="referred_name" placeholder="Full name" autoComplete="name" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="referred_email" label="Their email" error={errors.referred_email}>
          <Input name="referred_email" type="email" placeholder="name@example.com" autoComplete="off" />
        </Field>
        <Field id="referred_phone" label="Their phone" error={errors.referred_phone}>
          <Input name="referred_phone" placeholder="(972) 555-0100" autoComplete="off" />
        </Field>
      </div>

      <Field id="engagement" label="How should we engage?" error={errors.engagement}>
        <Select name="engagement" defaultValue="warm_handoff">
          {REFERRAL_ENGAGEMENT.map((e) => (
            <option key={e} value={e}>
              {e.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </Field>

      <Field id="note" label="Anything we should know?" error={errors.note}>
        <Textarea name="note" placeholder="Context that will help us reach out well." rows={3} />
      </Field>

      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Contact consent</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent_sms" className="mt-0.5 h-4 w-4" />
          <span>
            Text (SMS). By checking, you consent to be contacted on this channel. Msg/data rates may apply. Reply STOP to
            opt out.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent_email" className="mt-0.5 h-4 w-4" />
          <span>Email. By checking, you consent to be contacted by email. You can unsubscribe at any time.</span>
        </label>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        We use this information only to follow up on this referral. See our{' '}
        <Link href="/privacy" className="underline hover:text-foreground">
          privacy notice
        </Link>{' '}
        and{' '}
        <Link href="/disclosures" className="underline hover:text-foreground">
          disclosures
        </Link>
        .
      </p>

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? 'Submitting…' : 'Submit referral'}
      </Button>
    </form>
  )
}
