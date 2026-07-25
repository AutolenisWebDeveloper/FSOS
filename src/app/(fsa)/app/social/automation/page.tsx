import Link from 'next/link'
import { Bot, Power, PowerOff, FileEdit, MessageSquare, Sparkles, AlertTriangle, ClipboardCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, Section, StatTile, EmptyState, ErrorState } from '@/components/archetypes'
import { getSocialAutomation, type WorkerView } from '@/lib/social/automation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

export default async function SocialAutomationPage() {
  await requireRole('fsa', '/app/social/automation')
  const res = await getSocialAutomation()
  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Automation' },
  ]

  if (!res.ok) {
    return (
      <ListShell title="Automation" description="What the social AI workers are doing." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={Bot} title="Database not configured" description="Set the Supabase environment variables to load automation." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const { gatewayEnabled, workers, recentRuns, content, engagement } = res.data
  const queueFor = (w: WorkerView) =>
    w.agentKey === 'content_drafter'
      ? { label: 'Awaiting human review', value: content.awaitingReview, href: '/app/social/content', icon: ClipboardCheck }
      : { label: 'Unresolved engagement', value: engagement.unresolved, href: '/app/social/engagement', icon: MessageSquare }

  return (
    <ListShell
      title="Automation"
      description="A read-only view of the two social AI workers — what each did, what's awaiting human review, and their kill-switch state. These workers only draft and classify; they never publish or make a recommendation. Orchestration and the kill switch are controlled in AI Operations."
      breadcrumb={breadcrumb}
    >
      <div className={'mb-6 flex items-center justify-between rounded-lg border p-3 ' + (gatewayEnabled ? 'border-status-won/30 bg-status-won/5' : 'border-status-lost/30 bg-status-lost/5')}>
        <div className="flex items-center gap-2">
          {gatewayEnabled ? <Power className="h-4 w-4 text-status-won" aria-hidden /> : <PowerOff className="h-4 w-4 text-status-lost" aria-hidden />}
          <span className={'text-sm font-medium ' + (gatewayEnabled ? 'text-status-won' : 'text-status-lost')}>
            AI gateway {gatewayEnabled ? 'enabled' : 'disabled by kill switch'}
          </span>
        </div>
        <Link href="/super/ai/policies" className="text-xs font-medium text-primary hover:underline">
          Manage kill switch →
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Awaiting review" value={content.awaitingReview} icon={ClipboardCheck} href="/app/social/content" tone={content.awaitingReview > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Unresolved engagement" value={engagement.unresolved} icon={MessageSquare} href="/app/social/engagement" tone={engagement.unresolved > 0 ? 'attention' : 'neutral'} />
        <StatTile label="AI-drafted" value={content.aiDrafted} icon={Sparkles} hint={`${content.humanWritten} human-written`} />
        <StatTile label="Drafts total" value={content.totalDrafts} icon={FileEdit} />
      </div>

      <Section title="AI workers" description="Registered in the existing AI workforce; shown here for social traceability.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {workers.map((w) => {
            const q = queueFor(w)
            const QIcon = q.icon
            return (
              <li key={w.agentKey} className="rounded-lg border border-shell-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-foreground">
                      <Bot className="h-4 w-4 text-primary" aria-hidden />
                      {w.label}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{w.mission}</p>
                  </div>
                  <span
                    className={
                      'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ' +
                      (w.enabled && gatewayEnabled
                        ? 'border-status-won/30 bg-status-won/10 text-status-won'
                        : 'border-status-lost/30 bg-status-lost/10 text-status-lost')
                    }
                  >
                    {w.enabled && gatewayEnabled ? <Power className="h-3 w-3" aria-hidden /> : <PowerOff className="h-3 w-3" aria-hidden />}
                    {w.enabled && gatewayEnabled ? 'On' : 'Off'}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/30 p-2">
                    <dt className="text-[11px] text-muted-foreground">Runs</dt>
                    <dd className="numeric text-sm font-semibold text-foreground">{w.totalRuns}</dd>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2">
                    <dt className="text-[11px] text-muted-foreground">Avg confidence</dt>
                    <dd className="numeric text-sm font-semibold text-foreground">{pct(w.avgConfidence)}</dd>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2">
                    <dt className="text-[11px] text-muted-foreground">Flagged</dt>
                    <dd className="numeric text-sm font-semibold text-foreground">{w.flaggedActions}</dd>
                  </div>
                </dl>

                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Trigger: {w.triggers}</p>
                  {w.lastRunAt ? (
                    <p>
                      Last run {new Date(w.lastRunAt).toLocaleString()} · {w.lastStatus}
                    </p>
                  ) : (
                    <p>No runs yet.</p>
                  )}
                  {w.errorRuns > 0 ? (
                    <p className="text-status-lost">
                      <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
                      {w.errorRuns} run{w.errorRuns === 1 ? '' : 's'} errored
                    </p>
                  ) : null}
                </div>

                <Link href={q.href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <QIcon className="h-3.5 w-3.5" aria-hidden />
                  {q.label}: {q.value}
                </Link>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Recent worker runs" description="Traceability into the existing agent-run log — links to full AI operations." className="mt-6"
        action={<Link href="/app/ai/workforce" className="text-sm font-medium text-primary hover:underline">AI Command Center</Link>}
      >
        {recentRuns.length === 0 ? (
          <EmptyState icon={Bot} title="No worker runs yet" description="When the Content Drafter or Engagement Triager runs, its activity appears here." />
        ) : (
          <ul className="divide-y divide-shell-border rounded-lg border border-shell-border bg-card">
            {recentRuns.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 p-3">
                <p className="text-sm text-foreground">{r.agent_key === 'content_drafter' ? 'Content Drafter' : 'Engagement Triager'}</p>
                <span className="numeric text-xs text-muted-foreground">
                  {r.status} · {r.confidence != null ? pct(r.confidence) : '—'} · {r.started_at ? new Date(r.started_at).toLocaleString() : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </ListShell>
  )
}
