'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { ConfirmDialog, ModalShell } from '@/components/archetypes/overlays'
import type { ResumeBehaviorName, ReplayPolicyName } from '@/lib/cross-sell-life/control-contract'

// Cross-Sell Life — operational controls + monitoring panel (§ Management Interface / § Operational
// Controls). Each control POSTs to the audited /api/cross-sell-life endpoints; the server enforces
// RBAC + the state machine + audit — this client only renders the actions valid from the current
// state and reports the outcome. Destructive controls (Disable / Emergency Stop / Archive) confirm
// through the shared A9 ConfirmDialog — Archive requires typed confirmation because it is permanent
// (DESIGN.md destructive-confirmation pattern). Resume opens a strategy chooser so the operator can
// pick which paused enrollments proceed and whether missed touches are skipped or replayed — the
// resume-behavior/replay-policy overrides the API already accepts (§ Resume Behavior). The health
// panel polls the read-only /health endpoint and degrades gracefully if it is unavailable.

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

// Destructive controls → shared A9 ConfirmDialog (not a native window.confirm). Archive is permanent,
// so it requires typed confirmation; the others halt outbound and are guarded by a destructive confirm.
const CONFIRM: Partial<
  Record<Action, { title: string; consequence: string; confirmLabel: string; typed?: string }>
> = {
  emergency_stop: {
    title: 'Emergency stop this campaign?',
    consequence: 'Halts every outbound touch immediately and pauses all running enrollments. Re-enabling is a deliberate step.',
    confirmLabel: 'Emergency stop',
  },
  disable: {
    title: 'Disable this campaign?',
    consequence: 'Stops all outbound touches and pauses running enrollments until the campaign is re-enabled.',
    confirmLabel: 'Disable',
  },
  archive: {
    title: 'Archive this campaign version?',
    consequence: 'Makes this version permanently read-only. Create a new version to make further changes.',
    confirmLabel: 'Archive',
    typed: 'ARCHIVE',
  },
}

// Resume-strategy vocabulary surfaced to the operator (A3). Only the behaviors that produce a
// DISTINCT engine outcome are offered — 'all_active' is intentionally omitted because applyControl
// treats it identically to 'only_admin_paused', and offering both would imply a difference that does
// not exist. Defaults match the engine's own fallbacks (only_admin_paused + skip: resume in place,
// no catch-up burst).
const RESUME_BEHAVIOR_OPTIONS: { value: ResumeBehaviorName; label: string; help: string }[] = [
  {
    value: 'only_admin_paused',
    label: 'Resume paused enrollments',
    help: 'Continue the enrollments this campaign paused, each from where it left off.',
  },
  {
    value: 'restart_day_1',
    label: 'Restart from Day 1',
    help: 'Reset paused enrollments to the beginning of the touch sequence.',
  },
  {
    value: 'only_new',
    label: 'Only new enrollments',
    help: 'Leave paused enrollments as they are; only newly eligible households proceed.',
  },
]

const REPLAY_OPTIONS: { value: ReplayPolicyName; label: string; help: string }[] = [
  {
    value: 'skip',
    label: 'Skip missed touches',
    help: 'Touches that came due while paused are recorded as skipped — no catch-up burst.',
  },
  {
    value: 'replay',
    label: 'Send the next due touch now',
    help: 'Fire the next pending touch immediately on the next run.',
  },
]

interface ResumeStrategy {
  resumeBehavior: ResumeBehaviorName
  replayPolicy: ReplayPolicyName
}

export function CampaignControls({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which control is awaiting confirmation (destructive dialog) / whether the resume + version
  // dialogs are open. Kept as discrete state so exactly one overlay is live at a time.
  const [confirmAction, setConfirmAction] = useState<Action | null>(null)
  const [resumeOpen, setResumeOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [strategy, setStrategy] = useState<ResumeStrategy>({ resumeBehavior: 'only_admin_paused', replayPolicy: 'skip' })

  const actions = ACTIONS_BY_STATE[status] ?? []

  // POST a control action. `extra` carries the resume-strategy overrides when resuming.
  async function run(action: Action, label: string, extra?: Partial<ResumeStrategy>) {
    setBusy(action)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/cross-sell-life/${campaignId}/control`, {
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
      setMessage('Done.')
      router.refresh()
    } catch {
      setError('Network error — please retry.')
    } finally {
      setBusy(null)
      // Close the overlay once the request resolves (success OR failure) so the page-level
      // status/error is never hidden behind the modal (§16 — failures must be visible).
      setConfirmAction(null)
      setResumeOpen(false)
    }
  }

  // Route each action to its overlay: resume → strategy chooser; destructive → typed/destructive
  // confirm; everything else runs immediately.
  function onClick(action: Action, label: string) {
    if (action === 'resume') { setResumeOpen(true); return }
    if (CONFIRM[action]) { setConfirmAction(action); return }
    void run(action, label)
  }

  async function newVersion() {
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
      setVersionOpen(false) // close on resolve so the page-level status/error is visible (§16)
    }
  }

  const confirmCopy = confirmAction ? CONFIRM[confirmAction] : undefined
  const confirmLabelText = confirmAction ? (actions.find((a) => a.action === confirmAction)?.label ?? confirmAction) : ''
  const replayApplies = strategy.resumeBehavior === 'only_admin_paused'

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
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => setVersionOpen(true)}
          aria-busy={busy === 'new_version'}
        >
          {busy === 'new_version' ? 'Working…' : 'New version'}
        </Button>
      </div>
      {actions.length === 0 && (
        <p className="text-sm text-muted-foreground">This campaign version is archived (read-only). Create a new version to make changes.</p>
      )}
      {message && (
        <p role="status" className="text-sm text-status-won">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

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

      {/* New-version confirm (A9, non-destructive). */}
      <ConfirmDialog
        open={versionOpen}
        onOpenChange={(v) => { if (!v) setVersionOpen(false) }}
        title="Create a new draft version?"
        consequence="Copies this campaign into a fresh draft you can edit. The current version stays exactly as it is."
        confirmLabel="Create version"
        pending={busy === 'new_version'}
        onConfirm={() => void newVersion()}
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
              onChange={(e) => setStrategy((s) => ({ ...s, resumeBehavior: e.target.value as ResumeBehaviorName }))}
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
                onChange={(e) => setStrategy((s) => ({ ...s, replayPolicy: e.target.value as ReplayPolicyName }))}
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

// Monitoring & Health moved to the shared <CampaignHealthPanel> (components/app), which renders the
// actual {counts, cron} shape the /health route returns. The previous panel here read a {ok, checks}
// shape the route never emitted, so it always showed "No health checks reported".
