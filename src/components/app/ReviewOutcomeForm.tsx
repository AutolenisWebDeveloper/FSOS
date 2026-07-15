'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { REFERRAL_ENGAGEMENT } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

interface Need {
  product_id: string
  engagement: string
  note: string
  expected_premium: string
}

// The outcome captures NEEDS and originates opportunities. There is deliberately
// no "recommendation" field — the FSA records what was discussed; the system does
// not recommend. Securities/replacement discussion routes to FFS/supervisory.
export function ReviewOutcomeForm({
  reviewId,
  products,
}: {
  reviewId: string
  products: { id: string; family: string; subtype: string | null; is_security: boolean }[]
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [needs, setNeeds] = React.useState<Need[]>([])
  const [securities, setSecurities] = React.useState(false)
  const [replacement, setReplacement] = React.useState(false)

  function addNeed() {
    setNeeds((n) => [...n, { product_id: '', engagement: 'direct', note: '', expected_premium: '' }])
  }
  function updateNeed(i: number, patch: Partial<Need>) {
    setNeeds((n) => n.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  }
  function removeNeed(i: number) {
    setNeeds((n) => n.filter((_, idx) => idx !== i))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const form = new FormData(e.currentTarget)
    const payload = {
      goals: String(form.get('goals') || ''),
      coverage_held: String(form.get('coverage_held') || ''),
      gaps_observed: String(form.get('gaps_observed') || ''),
      life_events: String(form.get('life_events') || ''),
      meeting_notes: String(form.get('meeting_notes') || ''),
      securities_discussed: securities,
      replacement_discussed: replacement,
      originate: needs.map((n) => ({
        product_id: n.product_id || undefined,
        engagement: n.engagement,
        note: n.note || undefined,
        expected_premium: n.expected_premium ? Number(n.expected_premium) : undefined,
      })),
      follow_ups: [],
    }
    setSaving(true)
    const res = await postJson<{ generated_opp_ids: string[] }>(`/api/reviews/${reviewId}/outcome`, payload)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    const n = res.data.generated_opp_ids.length
    toast.success(`Outcome logged${n ? ` — ${n} opportunit${n === 1 ? 'y' : 'ies'} originated` : ''}.`)
    router.push(`/app/reviews/${reviewId}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="goals" label="Goals discussed"><Textarea name="goals" rows={3} /></Field>
        <Field id="coverage_held" label="Coverage held"><Textarea name="coverage_held" rows={3} /></Field>
        <Field id="gaps_observed" label="Gaps observed"><Textarea name="gaps_observed" rows={3} /></Field>
        <Field id="life_events" label="Life events"><Textarea name="life_events" rows={3} /></Field>
      </div>
      <Field id="meeting_notes" label="Meeting notes"><Textarea name="meeting_notes" rows={4} /></Field>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Originate opportunities from identified needs</p>
            <p className="text-xs text-muted-foreground">One per need/product family. You select what to pursue — the system records, it does not recommend.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addNeed}><Plus className="h-4 w-4" /> Add need</Button>
        </div>
        {needs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No opportunities to originate.</p>
        ) : (
          needs.map((n, i) => {
            const p = products.find((x) => x.id === n.product_id)
            return (
              <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_10rem_9rem_auto]">
                <Select value={n.product_id} onChange={(e) => updateNeed(i, { product_id: e.target.value })} aria-label="Product family">
                  <option value="">— Coverage / undetermined —</option>
                  {products.map((x) => (<option key={x.id} value={x.id}>{x.family}{x.subtype ? ` · ${x.subtype}` : ''}{x.is_security ? ' (securities → FFS)' : ''}</option>))}
                </Select>
                <Select value={n.engagement} onChange={(e) => updateNeed(i, { engagement: e.target.value })} aria-label="Engagement">
                  {REFERRAL_ENGAGEMENT.map((s) => (<option key={s} value={s}>{s}</option>))}
                </Select>
                <Input type="number" min={0} step="0.01" placeholder="Premium" value={n.expected_premium} onChange={(e) => updateNeed(i, { expected_premium: e.target.value })} aria-label="Expected premium" />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeNeed(i)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                {p?.is_security ? <p className="sm:col-span-4 text-xs text-status-blocked">Securities need — routes to FFS-supervised follow-up as a pointer; not auto-sequenced by FSOS.</p> : null}
              </div>
            )
          })
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-status-blocked/30 bg-status-blocked/5 p-4 text-sm">
        <p className="font-medium">Compliance flags</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={securities} onChange={(e) => setSecurities(e.target.checked)} /> A securities need was discussed (routes to FFS — never auto-sequenced)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} /> A replacement was discussed (flags replacement-notice requirement + escalates)</label>
      </div>

      {errors.originate ? <p className="text-sm text-destructive">{errors.originate}</p> : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => router.push(`/app/reviews/${reviewId}`)} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Log outcome'}</Button>
      </div>
    </form>
  )
}
