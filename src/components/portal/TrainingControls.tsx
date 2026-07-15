'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { postJson, firstFieldError } from '@/lib/client/api'
import { Button } from '@/components/ui/button'
import { TrainingCompleteSchema } from '@/lib/validation/schemas'

export function MarkCompleteButton({ trainingId }: { trainingId: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function onClick() {
    const parsed = TrainingCompleteSchema.safeParse({ training_id: trainingId })
    if (!parsed.success) {
      toast.error('Invalid training module.')
      return
    }
    setBusy(true)
    const res = await postJson<{ ok: true }>('/api/partner/training', parsed.data)
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Marked complete.')
    router.refresh()
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={busy}>
      {busy ? 'Saving…' : 'Mark complete'}
    </Button>
  )
}
