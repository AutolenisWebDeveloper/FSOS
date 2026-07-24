'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// Slice 8 (§17) — instantiate a library blueprint into a DRAFT template for approval.
// The approval gate is never bypassed: this only seeds compliance-ready starting content.
export function InstantiateBlueprintButton({ blueprintKey }: { blueprintKey: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function instantiate() {
    setBusy(true)
    const res = await postJson<{ template: { id: string }; recommended: { purpose: string; audienceKind: string } }>(
      '/api/comms/library',
      { blueprintKey },
    )
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Draft template created. Get it approved, then build a campaign from it.')
    router.push('/app/comms/templates')
  }

  return (
    <Button size="sm" onClick={instantiate} disabled={busy}>
      {busy ? 'Adding…' : 'Add to templates (draft)'}
    </Button>
  )
}
