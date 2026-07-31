'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// Cross-Sell Life — operational controls + monitoring panel (§ Management Interface / § Operational
// Controls). Each control POSTs to the audited /api/cross-sell-life endpoints; the server enforces
// RBAC + the state machine + audit — this client only renders the actions valid from the current
// state and reports the outcome. Emergency Stop and Archive confirm first (they are destructive /
// halt every channel), matching the destructive-confirmation pattern in DESIGN.md. The health panel
// polls the read-only /api/cross-sell-life/health endpoint and degrades gracefully if it is
// unavailable (shows a note rather than breaking the page).

type Action = 'submit' | 'enable' | 'pause' | 'resume' | 'disable' | 'emergency_stop' | 'archive'

const ACTIONS_BY_STATE: Record<string, { action: Action; label: string; variant?: 'default' | 'destructive' | 'outline' }[]> = {
  draft: [{ action: 'submit', label: 'Submit for approval' }],
  approval_pending: [{ action: 'enable', label: 'Approve & enable' }],
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

// Actions that require an explicit confirmation before they run (destructive / halt all channels).
const CONFIRM: Partial<Record<Action, string>> = {
  emergency_stop: 'Emergency Stop halts every outbound touch for this campaign immediately. Continue?',
  disable: 'Disable stops all outbound touches for this campaign. Continue?',
  archive: 'Archive makes this campaign version permanently read-only. Continue?',
}

export function CampaignControls({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actions = ACTIONS_BY_STATE[status] ?? []

  async function run(action: Action, label: string) {
    const confirmCopy = CONFIRM[action]
    if (confirmCopy && !window.confirm(confirmCopy)) return
    setBusy(action)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/cross-sell-life/${campaignId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        setError(
          body.error === 'invalid_transition'
            ? `Cannot ${label.toLowerCase()} from “${status.replace(/_/g, ' ')}”.`
            : (body.error ?? `Action failed (${res.status}).`),
        )
        return
      }
      setMessage('Done.')
      router.refresh()
    } catch {
      setError('Network error — please retry.')
    } finally {
      setBusy(null)
    }
  }

  async function newVersion() {
    if (!window.confirm('Create a new draft version from this campaign? The current version stays as-is.')) return
    setBusy('new_version')
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/cross-sell-life/${campaignId}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        setError(body.error ?? `Could not create a new version (${res.status}).`)
        return
      }
      setMessage('New draft version created.')
      router.refresh()
    } catch {
      setError('Network error — please retry.')
    } finally {
      setBusy(null)
    }
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
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={newVersion}
          aria-busy={busy === 'new_version'}
        >
          {busy === 'new_version' ? 'Working…' : 'New version'}
        </Button>
      </div>
      {actions.length === 0 && (
        <p className="text-sm text-muted-foreground">This campaign version is archived (read-only). Create a new version to make changes.</p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

interface HealthState {
  ok: boolean
  status?: string
  checks?: { label: string; ok: boolean; detail?: string }[]
  [k: string]: unknown
}

// Monitoring & Health — fetched client-side so a health-endpoint outage never blocks the (server-
// rendered) management page. If the route is missing or errors, we show an informative note (§16
// graceful degradation) instead of failing.
export function HealthPanel() {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [health, setHealth] = useState<HealthState | null>(null)

  const refresh = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch('/api/cross-sell-life/health', { cache: 'no-store' })
      if (!res.ok) {
        setState('unavailable')
        return
      }
      const body = (await res.json()) as HealthState
      setHealth(body)
      setState('ready')
    } catch {
      setState('unavailable')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (state === 'loading') {
    return <p className="text-sm text-muted-foreground" aria-live="polite">Checking campaign health…</p>
  }

  if (state === 'unavailable') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Live health monitoring is temporarily unavailable. The campaign continues to run on its schedule; retry to check again.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    )
  }

  const checks = health?.checks ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${health?.ok ? 'bg-emerald-500' : 'bg-destructive'}`}
          aria-hidden
        />
        <span className="text-sm font-medium">{health?.ok ? 'Healthy' : 'Attention needed'}</span>
        {health?.status && <span className="text-xs text-muted-foreground">({String(health.status).replace(/_/g, ' ')})</span>}
      </div>
      {checks.length > 0 ? (
        <ul className="space-y-1.5">
          {checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${c.ok ? 'bg-emerald-500' : 'bg-amber-400'}`} aria-hidden />
              <span>
                <span className="font-medium">{c.label}</span>
                {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No health checks reported.</p>
      )}
      <Button variant="outline" size="sm" onClick={() => void refresh()}>
        Refresh
      </Button>
    </div>
  )
}
