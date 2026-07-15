'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'
import type { GreenZoneVerb } from '@/lib/validation/schemas'

// The ONLY actions surfaced for Term Conversion + Cross-Sell. There is no
// "recommend product" control anywhere — by construction. Securities-flagged
// records are blocked server-side and reported here.
const LABELS: Record<GreenZoneVerb, string> = {
  identify: 'Log identified',
  educate: 'Send education',
  invite: 'Invite to review',
  schedule: 'Schedule review',
  remind: 'Remind',
  follow_up: 'Follow up',
  escalate: 'Escalate to FSA',
}

const VERBS: GreenZoneVerb[] = ['educate', 'invite', 'schedule', 'remind', 'follow_up', 'escalate']

export function OutreachActions({ endpoint, isSecurity }: { endpoint: string; isSecurity?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)

  async function run(action: GreenZoneVerb) {
    setBusy(action)
    const res = await postJson<{ review_id?: string }>(endpoint, { action })
    setBusy(null)
    if (!res.ok) {
      if (res.error.reason === 'is_security') {
        toast.error('Securities-flagged record — excluded from automated outreach; handled by FFS.')
        return
      }
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (action === 'schedule' && res.data.review_id) {
      toast.success('Review invitation created.')
      router.push(`/app/reviews/${res.data.review_id}`)
      return
    }
    if (action === 'escalate') toast.success('Escalated to the FSA.')
    else toast.success('Green-zone action logged. Any client send passes the 7-step gate.')
    router.refresh()
  }

  return (
    <div className="space-y-2">
      {isSecurity ? (
        <p className="rounded-md border border-status-blocked/40 bg-status-blocked/10 p-2 text-xs text-status-blocked">
          Securities-flagged — automated educational outreach is disabled. Handled by the human FSA / FFS.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {VERBS.map((verb) => (
          <Button key={verb} size="sm" variant={verb === 'escalate' ? 'outline' : 'default'} disabled={busy !== null || (isSecurity && verb !== 'escalate')} onClick={() => run(verb)}>
            {busy === verb ? '…' : LABELS[verb]}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Actions are education/invitation only. There is no &quot;recommend product&quot; action.</p>
    </div>
  )
}
