'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

// Shared monitoring & health panel for the native campaign engines (Life Conversion, Pipeline
// Win-Back, Cross-Sell Life). Fetched client-side so a health-endpoint outage never blocks the
// server-rendered management page; if the route is missing or errors we degrade gracefully (§16)
// with an informative note + retry, never a hard failure.
//
// Renders the actual `{counts, cron, checked_at}` shape the /health routes return — replacing the
// earlier Cross-Sell panel that read a `{ok, checks}` shape the route never emitted (so it always
// showed "No health checks reported"). The only per-campaign input is `endpoint`; the counts object
// is rendered generically, so the small key differences between engines (running_ vs
// active_enrollments) need no per-campaign branching.

interface HealthState {
  counts?: Record<string, number | null>
  cron?: Record<string, { status: string; started_at: string; finished_at: string | null } | null>
  checked_at?: string
}

// Friendly labels for the known count keys; unknown keys fall back to a humanized form.
const COUNT_LABELS: Record<string, string> = {
  dead_letter_executions: 'Dead-lettered executions',
  scheduled_stuck_executions: 'Stuck (retry overdue)',
  running_enrollments: 'Active enrollments',
  active_enrollments: 'Active enrollments',
}
// Counts that indicate a problem when > 0 (drive the overall status + attention styling).
const PROBLEM_KEYS = new Set(['dead_letter_executions', 'scheduled_stuck_executions'])

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function CampaignHealthPanel({ endpoint }: { endpoint: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [health, setHealth] = useState<HealthState | null>(null)

  const refresh = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch(`${endpoint}/health`, { cache: 'no-store' })
      if (!res.ok) {
        setState('unavailable')
        return
      }
      setHealth((await res.json()) as HealthState)
      setState('ready')
    } catch {
      setState('unavailable')
    }
  }, [endpoint])

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

  const counts = health?.counts ?? {}
  const countEntries = Object.entries(counts)
  const cronEntries = Object.entries(health?.cron ?? {})

  // Overall status: attention if any assessable problem metric is > 0; healthy if all problem
  // metrics are known and zero; degraded otherwise (a problem metric is null — schema not yet
  // migrated or that count query failed). Precedence: Attention > Degraded > Healthy — a KNOWN
  // problem (> 0) is reported even if another metric is unknown, but we only claim Healthy when
  // EVERY problem metric is known and zero (an unknown metric must not read as healthy).
  const problemValues = [...PROBLEM_KEYS].map((k) => counts[k])
  const anyProblem = problemValues.some((v) => typeof v === 'number' && v > 0)
  const allKnown = problemValues.every((v) => typeof v === 'number')
  const dotClass = anyProblem ? 'bg-status-lost' : allKnown ? 'bg-status-won' : 'bg-status-pending'
  const statusLabel = anyProblem ? 'Attention needed' : allKnown ? 'Healthy' : 'Monitoring degraded'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} aria-hidden />
        <span className="text-sm font-medium">{statusLabel}</span>
        {health?.checked_at && (
          <span className="text-xs text-muted-foreground">· checked {formatTime(health.checked_at)}</span>
        )}
      </div>

      {countEntries.length > 0 && (
        <dl className="grid gap-3 sm:grid-cols-3">
          {countEntries.map(([key, value]) => {
            const attention = PROBLEM_KEYS.has(key) && typeof value === 'number' && value > 0
            return (
              <div key={key} className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{COUNT_LABELS[key] ?? humanize(key)}</dt>
                <dd className={`mt-1 text-lg font-semibold tabular-nums ${attention ? 'text-status-lost' : ''}`}>
                  {value == null ? '—' : value}
                </dd>
              </div>
            )
          })}
        </dl>
      )}

      {cronEntries.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Scheduled jobs — last run</p>
          <ul className="space-y-1.5">
            {cronEntries.map(([job, run]) => (
              <li key={job} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                    !run ? 'bg-muted-foreground/40' : run.status === 'ok' || run.status === 'success' ? 'bg-status-won' : 'bg-status-pending'
                  }`}
                  aria-hidden
                />
                <span>
                  <span className="font-medium">{humanize(job)}</span>
                  <span className="text-muted-foreground">
                    {' — '}
                    {run ? `${run.status}, ${formatTime(run.finished_at ?? run.started_at)}` : 'no run recorded yet'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="outline" size="sm" onClick={() => void refresh()}>
        Refresh
      </Button>
    </div>
  )
}
