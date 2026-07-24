'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Calculator } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// Plan workspace actions (build instruction §8). Calculate runs the deterministic
// engine server-side and freezes a new immutable version; the page then refreshes
// to show the new results. Enter-inputs / view-results are plain navigation.
export function PlanWorkspaceActions({ planId }: { planId: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function onCalculate() {
    setBusy(true)
    const res = await postJson<{ version_no?: number; completeness?: number }>(`/api/fna/plans/${planId}/calculate`, {})
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    const pct = typeof res.data.completeness === 'number' ? ` · ${Math.round(res.data.completeness * 100)}% complete` : ''
    toast.success(`Calculated version ${res.data.version_no ?? ''}${pct}.`)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline">
        <Link href={`/app/fna/plans/${planId}/inputs`}>Enter inputs</Link>
      </Button>
      <Button onClick={onCalculate} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Calculator className="h-4 w-4" aria-hidden />}
        {busy ? 'Calculating…' : 'Calculate'}
      </Button>
      <Button asChild variant="outline">
        <Link href={`/app/fna/plans/${planId}/results`}>View results</Link>
      </Button>
    </div>
  )
}
