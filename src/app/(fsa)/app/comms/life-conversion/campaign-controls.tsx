'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// Operational controls (§4b). Each button POSTs to /api/life-campaign/[id]/control; the server
// enforces RBAC + the state machine + audit. Only the actions valid from the current state are
// shown. Emergency Stop confirms first (it halts every channel) and surfaces deadline exposure.
type Action = 'submit' | 'enable' | 'pause' | 'resume' | 'disable' | 'emergency_stop' | 'archive'

const ACTIONS_BY_STATE: Record<string, { action: Action; label: string; variant?: 'default' | 'destructive' | 'outline' }[]> = {
  draft: [{ action: 'submit', label: 'Submit for approval' }],
  approval_pending: [{ action: 'enable', label: 'Approve & activate' }],
  active: [
    { action: 'pause', label: 'Pause', variant: 'outline' },
    { action: 'disable', label: 'Disable', variant: 'outline' },
    { action: 'emergency_stop', label: 'Emergency Stop', variant: 'destructive' },
  ],
  paused: [
    { action: 'resume', label: 'Resume', variant: 'default' },
    { action: 'disable', label: 'Disable', variant: 'outline' },
  ],
  disabled: [
    { action: 'enable', label: 'Re-enable', variant: 'default' },
    { action: 'archive', label: 'Archive', variant: 'outline' },
  ],
  emergency_stopped: [
    { action: 'enable', label: 'Re-enable', variant: 'default' },
    { action: 'archive', label: 'Archive', variant: 'outline' },
  ],
  archived: [],
}

export function CampaignControls({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<Action | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actions = ACTIONS_BY_STATE[status] ?? []

  async function run(action: Action, label: string) {
    if (action === 'emergency_stop' || action === 'disable') {
      if (!window.confirm(`${label} halts all outbound touches for this campaign. Continue?`)) return
    }
    setBusy(action)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/life-campaign/${campaignId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (!res.ok || body.ok === false) {
        setError(body.error === 'invalid_transition' ? `Cannot ${label.toLowerCase()} from “${status}”.` : (body.error ?? 'Action failed'))
        return
      }
      const exposure = body.deadlineExposure
      setMessage(
        exposure?.atRisk
          ? `Done. ⚠ ${exposure.atRisk} enrolled contact(s) have a conversion deadline within ${exposure.horizonDays} days — review before extended downtime.`
          : 'Done.',
      )
      router.refresh()
    } catch {
      setError('Network error — please retry.')
    } finally {
      setBusy(null)
    }
  }

  if (actions.length === 0) {
    return <p className="text-sm text-muted-foreground">This campaign is archived (read-only).</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.action}
            variant={a.variant ?? 'default'}
            disabled={busy !== null}
            onClick={() => run(a.action, a.label)}
            aria-busy={busy === a.action}
          >
            {busy === a.action ? 'Working…' : a.label}
          </Button>
        ))}
      </div>
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
