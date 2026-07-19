'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// Client action: run the AI workforce on demand (in addition to the daily cron).
// Kill switches still apply server-side; a disabled agent/gateway sends nothing.
export function RunWorkforceButton() {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/app/ai/workforce/run', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not run the workforce')
      } else {
        toast.success(`Workforce ran — ${json.totalSent ?? 0} sent through the compliance gate`)
        router.refresh()
      }
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={run} disabled={busy} size="sm">
      {busy ? 'Running…' : 'Run workforce now'}
    </Button>
  )
}
