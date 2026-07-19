'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { REVIEW_STAGE } from '@/lib/validation/schemas'
import { patchJson, firstFieldError } from '@/lib/client/api'

// Advancing to completed/outcome_logged routes the user to the outcome screen —
// a review is never "done" without an outcome record (spec acceptance).
export function ReviewStageControl({ id, stage }: { id: string; stage: string }) {
  const router = useRouter()
  const [target, setTarget] = React.useState(stage)
  const [saving, setSaving] = React.useState(false)

  async function advance() {
    if (target === stage) return
    if (target === 'outcome_logged') {
      router.push(`/app/reviews/${id}/outcome`)
      return
    }
    setSaving(true)
    const res = await patchJson(`/api/reviews/${id}`, { stage: target })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      setTarget(stage)
      return
    }
    if (target === 'completed') {
      toast.success('Completed — record the outcome next.')
      router.push(`/app/reviews/${id}/outcome`)
      return
    }
    toast.success('Stage updated')
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`rstage-${id}`}>Advance stage</label>
      <Select id={`rstage-${id}`} className="h-8 w-48 text-xs" value={target} onChange={(e) => setTarget(e.target.value)} disabled={saving}>
        {REVIEW_STAGE.map((s) => (<option key={s} value={s}>{s.replace(/_/g, ' ')}</option>))}
      </Select>
      <Button size="sm" variant="outline" onClick={advance} disabled={saving || target === stage}>{saving ? '…' : 'Advance'}</Button>
    </div>
  )
}
