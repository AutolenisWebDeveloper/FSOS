'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { postJson, firstFieldError } from '@/lib/client/api'

interface PlanOption {
  id: string
  household_id: string
  current_version_id: string | null
  name: string
}
interface RecRow {
  id: string
  status: string
  objective: string
  product_category: string | null
  authored_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  planName: string
}

// The §1 Reg-BI governance capture. The FSA AUTHORS the recommendation; the system
// only stores it (never generates one). Fields mirror the governance record.
const TEXT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'facts_relied_on', label: 'Facts relied on' },
  { key: 'assumptions', label: 'Assumptions' },
  { key: 'methodology', label: 'Methodology' },
  { key: 'alternatives', label: 'Alternatives considered' },
  { key: 'advantages', label: 'Advantages' },
  { key: 'disadvantages', label: 'Disadvantages' },
  { key: 'costs', label: 'Costs' },
  { key: 'risks', label: 'Risks' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'limitations', label: 'Limitations' },
  { key: 'missing_information', label: 'Missing information' },
  { key: 'rationale', label: 'Rationale' },
]

export function RecommendationWorkspace({ plans, recommendations }: { plans: PlanOption[]; recommendations: RecRow[] }) {
  const router = useRouter()
  const [planId, setPlanId] = React.useState(plans[0]?.id ?? '')
  const [objective, setObjective] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<false | 'save' | string>(false)

  const plan = plans.find((p) => p.id === planId)

  async function onSave() {
    if (!plan || !objective.trim()) {
      toast.error('Pick a plan and enter the objective.')
      return
    }
    setBusy('save')
    const body: Record<string, unknown> = {
      plan_id: plan.id,
      household_id: plan.household_id,
      version_id: plan.current_version_id,
      objective: objective.trim(),
      product_category: category.trim() || null,
    }
    for (const f of TEXT_FIELDS) body[f.key] = fields[f.key]?.trim() || null
    const res = await postJson<{ recommendation_id?: string }>('/api/fna/recommendations', body)
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Recommendation saved as a draft.')
    setObjective('')
    setCategory('')
    setFields({})
    router.refresh()
  }

  async function onApprove(id: string) {
    setBusy(id)
    const res = await postJson(`/api/fna/recommendations/${id}/approve`, {})
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Recommendation approved.')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Author a recommendation</CardTitle>
          <p className="text-xs text-muted-foreground">
            You author and own this recommendation — FSOS never generates one. Capture the Reg BI governance so it is reproducible and auditable.
            Use a product <em>category</em>, never a specific product.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-plan">Plan</Label>
              <Select id="rec-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={busy !== false}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-cat">Product category (optional)</Label>
              <Input id="rec-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy !== false} placeholder="e.g. Life Insurance" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-obj">Objective</Label>
            <Textarea id="rec-obj" value={objective} onChange={(e) => setObjective(e.target.value)} disabled={busy !== false} rows={2} placeholder="What is this recommendation intended to achieve?" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`rec-${f.key}`}>{f.label}</Label>
                <Textarea id={`rec-${f.key}`} value={fields[f.key] ?? ''} onChange={(e) => setFields((v) => ({ ...v, [f.key]: e.target.value }))} disabled={busy !== false} rows={2} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t pt-4">
            <Button onClick={onSave} disabled={busy !== false || !plan}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save draft
            </Button>
            <p className="text-xs text-muted-foreground">Stored with the plan&apos;s current version for reproducibility.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommendation &amp; approval history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recommendations.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No recommendations yet.</p>
          ) : (
            <ul className="divide-y">
              {recommendations.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.objective}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.planName}
                      {r.product_category ? ` · ${r.product_category}` : ''} · by {r.authored_by ?? 'FSA'}
                      {r.approved_by ? ` · approved by ${r.approved_by} ${r.approved_at ? new Date(r.approved_at).toLocaleDateString('en-US') : ''}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={r.status === 'APPROVED' ? 'active' : 'draft'}>{r.status}</Badge>
                    {r.status === 'DRAFT' ? (
                      <Button size="sm" variant="outline" onClick={() => onApprove(r.id)} disabled={busy !== false}>
                        {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
                        Approve
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
