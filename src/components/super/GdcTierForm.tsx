'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { GdcTierSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export interface ExistingTier {
  tier_no: number
  label: string
  min_gdc: number
  max_gdc: number | null
  payout_pct: number
}

// Add or update a GDC tier (keyed by tier_no). Every value stays an assumption-
// flagged config default — verify against contract (guardrail 3).
export function GdcTierForm({ tiers }: { tiers: ExistingTier[] }) {
  const router = useRouter()
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)

  function loadExisting(tierNo: string) {
    const t = tiers.find((x) => String(x.tier_no) === tierNo)
    const f = formRef.current
    if (!t || !f) return
    ;(f.elements.namedItem('tier_no') as HTMLInputElement).value = String(t.tier_no)
    ;(f.elements.namedItem('label') as HTMLInputElement).value = t.label
    ;(f.elements.namedItem('min_gdc') as HTMLInputElement).value = String(t.min_gdc)
    ;(f.elements.namedItem('max_gdc') as HTMLInputElement).value = t.max_gdc === null ? '' : String(t.max_gdc)
    ;(f.elements.namedItem('payout_pct') as HTMLInputElement).value = String(t.payout_pct)
    setErrors({})
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = GdcTierSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson('/api/super/config/gdc-tiers', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Tier saved — assumption-flagged config; verify against contract.')
    router.refresh()
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4" noValidate>
      {tiers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Edit existing:</span>
          {tiers.map((t) => (
            <Button key={t.tier_no} type="button" variant="outline" size="sm" onClick={() => loadExisting(String(t.tier_no))}>
              {t.label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="tier_no" label="Tier #" required error={errors.tier_no} hint="1 = lowest band">
          <Input name="tier_no" type="number" min={1} max={20} step="1" defaultValue="" />
        </Field>
        <Field id="label" label="Label" required error={errors.label}>
          <Input name="label" type="text" placeholder="Tier 1" />
        </Field>
        <Field id="min_gdc" label="GDC floor ($)" required error={errors.min_gdc} hint="Inclusive rolling-12mo minimum">
          <Input name="min_gdc" type="number" min={0} step="0.01" defaultValue="" />
        </Field>
        <Field id="max_gdc" label="GDC ceiling ($)" error={errors.max_gdc} hint="Blank = open-ended top tier">
          <Input name="max_gdc" type="number" min={0} step="0.01" defaultValue="" />
        </Field>
        <Field id="payout_pct" label="FSA payout %" required error={errors.payout_pct}>
          <Input name="payout_pct" type="number" min={0} max={100} step="0.01" defaultValue="" />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Saved values remain labeled config defaults — never a Farmers-published figure.
      </p>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save tier'}</Button>
      </div>
    </form>
  )
}
