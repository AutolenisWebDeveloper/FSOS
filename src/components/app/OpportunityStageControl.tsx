'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { OPPORTUNITY_STAGE } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function OpportunityStageControl({ id, stage }: { id: string; stage: string }) {
  const router = useRouter()
  const [target, setTarget] = React.useState(stage)
  const [saving, setSaving] = React.useState(false)

  async function advance() {
    if (target === stage) return
    setSaving(true)
    const res = await postJson<{ commission_id: string | null }>(`/api/opportunities/${id}/stage`, { stage: target })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      setTarget(stage)
      return
    }
    if (target === 'placed_issued' && res.data.commission_id) toast.success('Placed — commission record created from split defaults.')
    else toast.success('Stage updated')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`stage-${id}`}>Advance stage</label>
      {/* The row wraps, so on a phone the Advance button drops below the select instead
          of being pushed off-screen; the select keeps its full width at every size that
          fits it. min-w-0 is the backstop under that, letting the select itself shrink on
          a viewport narrower than it is (a flex item otherwise refuses to go below its
          content). Sized on this wrapper because Select renders its own relative div. */}
      <div className="w-56 min-w-0">
        <Select id={`stage-${id}`} className="h-8 text-xs" value={target} onChange={(e) => setTarget(e.target.value)} disabled={saving}>
          {OPPORTUNITY_STAGE.map((s) => (<option key={s} value={s}>{s.replace(/_/g, ' ')}</option>))}
        </Select>
      </div>
      <Button size="sm" variant="outline" onClick={advance} disabled={saving || target === stage}>{saving ? '…' : 'Advance'}</Button>
    </div>
  )
}
