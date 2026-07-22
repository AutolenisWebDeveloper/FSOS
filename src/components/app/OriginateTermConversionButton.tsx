'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// Client action: turn due term-conversion windows into tracked opportunities
// (deduplicated per policy; securities policies excluded and routed to FFS). Creates
// internal pipeline records only — nothing is sent to a client here. Server-side auth +
// the pure firewall/dedup planner still apply.
export function OriginateTermConversionButton() {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/app/conversions/originate', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not create conversion opportunities')
      } else if (json.created > 0) {
        toast.success(`${json.created} conversion opportunit${json.created === 1 ? 'y' : 'ies'} created`)
        router.refresh()
      } else {
        toast.info(json.note || 'No new opportunities — everything is already tracked')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={run} disabled={busy} size="sm">
      {busy ? 'Creating…' : 'Create opportunities'}
    </Button>
  )
}
