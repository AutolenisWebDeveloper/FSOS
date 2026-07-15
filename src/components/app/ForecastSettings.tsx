'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { AssumptionBadge } from '@/components/archetypes'
import { FORECAST_STAGES, stageLabel, type ForecastStage } from '@/lib/analytics/forecast'
import { ForecastSettingsSchema } from '@/lib/validation/schemas'
import { patchJson, firstFieldError } from '@/lib/client/api'

// Edit the stage close-probability ASSUMPTIONS (guardrail §2.3). These are editable
// config defaults, never Farmers-published figures — the AssumptionBadge makes that
// explicit and every change is written to the audit log (config.changed).
export function ForecastSettings({
  probabilities,
  horizonMonths,
}: {
  probabilities: Record<ForecastStage, number>
  horizonMonths: number
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [probs, setProbs] = React.useState<Record<ForecastStage, string>>(() =>
    Object.fromEntries(FORECAST_STAGES.map((s) => [s, String(Math.round(probabilities[s] * 100))])) as Record<ForecastStage, string>,
  )
  const [horizon, setHorizon] = React.useState(String(horizonMonths))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const probMap = Object.fromEntries(
      FORECAST_STAGES.map((s) => [s, Math.min(1, Math.max(0, (Number(probs[s]) || 0) / 100))]),
    )
    const payload = { probabilities: probMap, horizon_months: Number(horizon) || 3 }
    const parsed = ForecastSettingsSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      toast.error('Please fix the highlighted fields.')
      return
    }
    setSaving(true)
    const res = await patchJson('/api/forecasts/settings', parsed.data)
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Forecast assumptions updated.')
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <AssumptionBadge />
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Edit assumptions</Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4" noValidate>
      <div className="flex items-center gap-2">
        <AssumptionBadge />
        <p className="text-xs text-muted-foreground">Stage close-probabilities are editable config defaults — verify against your own conversion data. Not Farmers-published figures.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FORECAST_STAGES.map((s) => (
          <Field key={s} id={`prob-${s}`} label={`${stageLabel(s)} (%)`} error={errors.probabilities}>
            <Input
              id={`prob-${s}`}
              type="number"
              min={0}
              max={100}
              value={probs[s]}
              onChange={(e) => setProbs((p) => ({ ...p, [s]: e.target.value }))}
            />
          </Field>
        ))}
        <Field id="horizon" label="Horizon (months)" error={errors.horizon_months} hint="1–24">
          <Input id="horizon" type="number" min={1} max={24} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save assumptions'}</Button>
      </div>
    </form>
  )
}
