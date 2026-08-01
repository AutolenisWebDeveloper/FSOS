'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { ConfirmDialog, ModalShell } from '@/components/archetypes/overlays'

// Shared operational-controls panel for the native campaign engines (Life Conversion, Pipeline
// Win-Back, and any future engine). Consolidates what were two near-identical copies (D13 "forked
// primitives"): each POSTs to `${endpoint}/${campaignId}/control`, the server enforces RBAC + the
// state machine + audit, and this client only renders the actions valid from the current state and
// reports the outcome. Destructive controls (Disable / Emergency Stop / Archive) confirm through the
// shared A9 ConfirmDialog (Archive requires typed confirmation — it is permanent). Resume opens a
// strategy chooser so the operator picks which paused enrollments proceed and whether missed touches
// are skipped or replayed — the resume-behavior/replay-policy overrides the control API accepts
// (Life §4b / Win-Back §5a). The only per-campaign input is `endpoint`; the success line is composed
// generically from whichever outcome fields the response carries (deadline exposure, enrollment
// counts), so no non-serializable formatter crosses the server→client boundary.

type Action = 'submit' | 'enable' | 'pause' | 'resume' | 'disable' | 'emergency_stop' | 'archive'
type ResumeBehavior = 'only_admin_paused' | 'restart_day_1' | 'only_new'
type ReplayPolicy = 'skip' | 'replay'

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

// Destructive controls → shared A9 ConfirmDialog. Archive is permanent → typed confirmation.
const CONFIRM: Partial<Record<Action, { title: string; consequence: string; confirmLabel: string; typed?: string }>> = {
  emergency_stop: {
    title: 'Emergency stop this campaign?',
    consequence: 'Halts every outbound touch immediately and pauses all active enrollments. Re-enabling is a deliberate step.',
    confirmLabel: 'Emergency stop',
  },
  disable: {
    title: 'Disable this campaign?',
    consequence: 'Stops all outbound touches and new enrollments, and pauses active enrollments until the campaign is re-enabled.',
    confirmLabel: 'Disable',
  },
  archive: {
    title: 'Archive this campaign?',
    consequence: 'Makes this campaign permanently read-only.',
    confirmLabel: 'Archive',
    typed: 'ARCHIVE',
  },
}

// Only the resume behaviors with a DISTINCT engine outcome are offered ('all_active' is omitted —
// the engine treats it identically to only_admin_paused). Defaults match the engine fallbacks
// (only_admin_paused + skip: resume in place, no catch-up).
const RESUME_BEHAVIOR_OPTIONS: { value: ResumeBehavior; label: string; help: string }[] = [
  { value: 'only_admin_paused', label: 'Resume paused enrollments', help: 'Continue the enrollments this campaign paused, each from where it left off.' },
  { value: 'restart_day_1', label: 'Restart from Day 1', help: 'Reset paused enrollments to the beginning of the touch sequence.' },
  { value: 'only_new', label: 'Only new enrollments', help: 'Leave paused enrollments as they are; only newly eligible contacts proceed.' },
]
const REPLAY_OPTIONS: { value: ReplayPolicy; label: string; help: string }[] = [
  { value: 'skip', label: 'Skip missed touches', help: 'Touches that came due while paused are recorded as skipped — no catch-up burst.' },
  { value: 'replay', label: 'Send the next due touch now', help: 'Fire the next pending touch immediately on the next run.' },
]

interface ControlResponse {
  enrollmentsPaused?: number
  enrollmentsResumed?: number
  enrollmentsRestarted?: number
  deadlineExposure?: { atRisk: number; horizonDays: number }
}

/** Compose a plain-language success line from whichever outcome fields the campaign returned. */
function successLine(body: ControlResponse): string {
  const parts: string[] = []
  if (body.enrollmentsPaused) parts.push(`${body.enrollmentsPaused} enrollment(s) paused`)
  if (body.enrollmentsResumed) parts.push(`${body.enrollmentsResumed} resumed`)
  if (body.enrollmentsRestarted) parts.push(`${body.enrollmentsRestarted} restarted from Day 1`)
  const exp = body.deadlineExposure
  if (exp?.atRisk) parts.push(`⚠ ${exp.atRisk} with a conversion deadline within ${exp.horizonDays} days — review before extended downtime`)
  return parts.length ? `Done. ${parts.join(', ')}.` : 'Done.'
}

export function CampaignControls({ campaignId, status, endpoint }: { campaignId: string; status: string; endpoint: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<Action | null>(null)
  const [resumeOpen, setResumeOpen] = useState(false)
  const [strategy, setStrategy] = useState<{ resumeBehavior: ResumeBehavior; replayPolicy: ReplayPolicy }>({
    resumeBehavior: 'only_admin_paused',
    replayPolicy: 'skip',
  })

  const actions = ACTIONS_BY_STATE[status] ?? []

  async function run(action: Action, label: string, extra?: { resumeBehavior?: ResumeBehavior; replayPolicy?: ReplayPolicy }) {
    setBusy(action)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`${endpoint}/${campaignId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        setError(
          body.error === 'invalid_transition'
            ? `Cannot ${label.toLowerCase()} from “${status.replace(/_/g, ' ')}”.`
            : body.error === 'stale_state'
              ? 'This campaign changed since the page loaded. Refresh and try again.'
              : (body.error ?? `Action failed (${res.status}).`),
        )
        return
      }
      setMessage(successLine(body as ControlResponse))
      router.refresh()
    } catch {
      setError('Network error — please retry.')
    } finally {
      setBusy(null)
      // Close overlays on resolve (success OR failure) so the page-level status/error is never
      // hidden behind the modal (§16 — failures must be visible).
      setConfirmAction(null)
      setResumeOpen(false)
    }
  }

  function onClick(action: Action, label: string) {
    if (action === 'resume') { setResumeOpen(true); return }
    if (CONFIRM[action]) { setConfirmAction(action); return }
    void run(action, label)
  }

  const confirmCopy = confirmAction ? CONFIRM[confirmAction] : undefined
  const confirmLabelText = confirmAction ? (actions.find((a) => a.action === confirmAction)?.label ?? confirmAction) : ''
  const replayApplies = strategy.resumeBehavior === 'only_admin_paused'

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
            onClick={() => onClick(a.action, a.label)}
            aria-busy={busy === a.action}
          >
            {busy === a.action ? 'Working…' : a.label}
          </Button>
        ))}
      </div>
      {message && <p role="status" className="text-sm text-status-won">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Destructive confirm (A9) — Disable / Emergency Stop / Archive. */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(v) => { if (!v) setConfirmAction(null) }}
        title={confirmCopy?.title ?? ''}
        consequence={confirmCopy?.consequence ?? ''}
        confirmLabel={confirmCopy?.confirmLabel}
        destructive
        typedConfirmation={confirmCopy?.typed}
        pending={busy === confirmAction}
        onConfirm={() => { if (confirmAction) void run(confirmAction, confirmLabelText) }}
      />

      {/* Resume strategy chooser (A3) — surfaces the resume-behavior / replay-policy overrides. */}
      <ModalShell
        open={resumeOpen}
        onOpenChange={(v) => { if (!v) setResumeOpen(false) }}
        title="Resume campaign"
        description="Choose how paused enrollments pick back up when the campaign resumes."
        footer={
          <>
            <Button variant="outline" onClick={() => setResumeOpen(false)} disabled={busy === 'resume'}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void run('resume', 'Resume', {
                  resumeBehavior: strategy.resumeBehavior,
                  ...(replayApplies ? { replayPolicy: strategy.replayPolicy } : {}),
                })
              }
              loading={busy === 'resume'}
            >
              Resume
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resume-behavior">Resume behavior</Label>
            <Select
              id="resume-behavior"
              value={strategy.resumeBehavior}
              onChange={(e) => setStrategy((s) => ({ ...s, resumeBehavior: e.target.value as ResumeBehavior }))}
            >
              {RESUME_BEHAVIOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {RESUME_BEHAVIOR_OPTIONS.find((o) => o.value === strategy.resumeBehavior)?.help}
            </p>
          </div>

          {replayApplies && (
            <div className="space-y-1.5">
              <Label htmlFor="replay-policy">Missed touches</Label>
              <Select
                id="replay-policy"
                value={strategy.replayPolicy}
                onChange={(e) => setStrategy((s) => ({ ...s, replayPolicy: e.target.value as ReplayPolicy }))}
              >
                {REPLAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {REPLAY_OPTIONS.find((o) => o.value === strategy.replayPolicy)?.help}
              </p>
            </div>
          )}
        </div>
      </ModalShell>
    </div>
  )
}
