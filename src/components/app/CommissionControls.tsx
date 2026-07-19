'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Numeric } from '@/components/ui/typography'
import { Field } from '@/components/forms/Field'
import { PRODUCT_FAMILY, CommissionSplitSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

// Split configuration editor. Percentages must sum to 100 (validated client + server).
export function SplitConfigForm({ agencies }: { agencies: { id: string; agency_name: string }[] }) {
  const router = useRouter()
  const [fsa, setFsa] = React.useState('60')
  const [agency, setAgency] = React.useState('40')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const sum = Number(fsa || 0) + Number(agency || 0)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = CommissionSplitSchema.safeParse(raw)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])))
      return
    }
    setSaving(true)
    const res = await postJson('/api/commissions/splits', parsed.data)
    setSaving(false)
    if (!res.ok) { const fe = firstFieldError(res.error); if (fe.field) setErrors({ [fe.field]: fe.message }); toast.error(fe.message); return }
    toast.success('Split saved — labeled config default, verify against contract.')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="product_family" label="Product family" required error={errors.product_family}>
          <Select name="product_family" defaultValue="life">{PRODUCT_FAMILY.map((f) => (<option key={f} value={f}>{f}</option>))}</Select>
        </Field>
        <Field id="agency_id" label="Agency override" hint="Blank = default for all agencies" error={errors.agency_id}>
          <Select name="agency_id" defaultValue="">
            <option value="">— Default (all agencies) —</option>
            {agencies.map((a) => (<option key={a.id} value={a.id}>{a.agency_name}</option>))}
          </Select>
        </Field>
        <Field id="fsa_split_pct" label="FSA %" required error={errors.fsa_split_pct}>
          <Input name="fsa_split_pct" type="number" min={0} max={100} step="0.01" value={fsa} onChange={(e) => setFsa(e.target.value)} />
        </Field>
        <Field id="agency_split_pct" label="Agency %" required error={errors.agency_split_pct}>
          <Input name="agency_split_pct" type="number" min={0} max={100} step="0.01" value={agency} onChange={(e) => setAgency(e.target.value)} />
        </Field>
      </div>
      <p className={`flex items-center gap-1 text-sm ${Math.abs(sum - 100) < 0.001 ? 'text-status-won' : 'text-destructive'}`}>
        Sum: <Numeric>{sum}%</Numeric>{' '}
        {Math.abs(sum - 100) < 0.001 ? <Check className="h-4 w-4" strokeWidth={1.75} aria-label="valid" /> : <span>(must equal 100)</span>}
      </p>
      <div className="flex justify-end"><Button type="submit" disabled={saving || Math.abs(sum - 100) >= 0.001}>{saving ? 'Saving…' : 'Save split'}</Button></div>
    </form>
  )
}

// Record received commission + manual adjustments (reason required; chargeback = negative).
export function CommissionReconcileControls({ id }: { id: string }) {
  const router = useRouter()
  const [amount, setAmount] = React.useState('')
  const [adjAmount, setAdjAmount] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function record() {
    if (!amount) return
    setBusy(true)
    const res = await postJson(`/api/commissions/${id}`, { op: 'receipt', amount: Number(amount) })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    setAmount(''); toast.success('Receipt recorded'); router.refresh()
  }
  async function adjust(kind: 'adjustment' | 'chargeback') {
    if (!adjAmount || !reason.trim()) { toast.error('Amount and reason are required for every adjustment.'); return }
    setBusy(true)
    const amt = kind === 'chargeback' ? -Math.abs(Number(adjAmount)) : Number(adjAmount)
    const res = await postJson(`/api/commissions/${id}`, { op: 'adjustment', amount: amt, kind, reason: reason.trim() })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    setAdjAmount(''); setReason(''); toast.success(`${kind} applied`); router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Record received</p>
        <div className="flex gap-2">
          <Input type="number" step="0.01" placeholder="Amount received" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Received amount" />
          <Button onClick={record} disabled={busy || !amount}>Record</Button>
        </div>
        <p className="text-xs text-muted-foreground">Manual/CSV entry — there is no Farmers payout API. Idempotent by amount/period.</p>
      </div>
      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">Adjustment / chargeback</p>
        <Input type="number" step="0.01" placeholder="Amount" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} aria-label="Adjustment amount" />
        <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Adjustment reason" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => adjust('adjustment')} disabled={busy}>Apply adjustment</Button>
          <Button variant="outline" onClick={() => adjust('chargeback')} disabled={busy}>Chargeback</Button>
        </div>
      </div>
    </div>
  )
}
