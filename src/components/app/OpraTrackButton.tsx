'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// Start tracking a one-policy household in the OPRA Transfer Center.
export function OpraTrackButton({ householdId, policyId }: { householdId: string; policyId?: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function track() {
    setBusy(true)
    const res = await postJson<{ already?: boolean }>('/api/opra-transfers', {
      household_id: householdId,
      ...(policyId ? { policy_id: policyId } : {}),
    })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(res.data.already ? 'Already tracked in OPRA.' : 'Added to the OPRA Transfer Center.')
    router.refresh()
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={track}>
      <Plus className="h-4 w-4" /> {busy ? 'Adding…' : 'Track'}
    </Button>
  )
}
