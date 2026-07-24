'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { postJson, firstFieldError } from '@/lib/client/api'

interface HouseholdOption {
  id: string
  primary_name: string
}
interface PlanTypeOption {
  id: string
  label: string
  description: string
}

// Start a structured FNA plan (build instruction §8). Pick a plan type + household,
// create the plan, then land in its workspace to enter inputs. Thin client — the
// server route validates and owns the write.
export function NewPlanForm({ households, planTypes }: { households: HouseholdOption[]; planTypes: PlanTypeOption[] }) {
  const router = useRouter()
  const [planType, setPlanType] = React.useState(planTypes[0]?.id ?? 'express')
  const [householdId, setHouseholdId] = React.useState(households[0]?.id ?? '')
  const [busy, setBusy] = React.useState(false)

  const selected = planTypes.find((p) => p.id === planType)

  async function onCreate() {
    if (!householdId || !planType) return
    setBusy(true)
    const res = await postJson<{ plan?: { id: string } }>('/api/fna/plans', { household_id: householdId, plan_type: planType })
    if (!res.ok) {
      setBusy(false)
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (res.data.plan?.id) {
      toast.success('Plan created.')
      router.push(`/app/fna/plans/${res.data.plan.id}/inputs`)
    } else {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="np-type">Plan type</Label>
        <Select id="np-type" value={planType} onChange={(e) => setPlanType(e.target.value)} disabled={busy}>
          {planTypes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        {selected ? <p className="text-xs text-muted-foreground">{selected.description}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="np-household">Household</Label>
        <Select id="np-household" value={householdId} onChange={(e) => setHouseholdId(e.target.value)} disabled={busy}>
          {households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.primary_name}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">Inputs prefill from the household, members, and policies where available.</p>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button onClick={onCreate} disabled={!householdId || busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Creating…
            </>
          ) : (
            'Create plan & enter inputs'
          )}
        </Button>
      </div>
    </div>
  )
}
