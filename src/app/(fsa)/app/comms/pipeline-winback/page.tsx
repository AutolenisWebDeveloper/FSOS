import Link from 'next/link'
import { DetailShell, Section, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/pipeline-winback/analytics'
import { loadCampaignDetail } from '@/lib/pipeline-winback/detail'
import { PLAYBOOKS, ADVISOR_SCRIPTS, EVENT_DRIVEN_SMS } from '@/lib/pipeline-winback/playbooks'
import { WINBACK_CANDIDATE_STAGES } from '@/lib/pipeline-winback/eligibility'
import { CampaignControls } from '@/components/app/CampaignEngineControls'
import { CampaignHealthPanel } from '@/components/app/CampaignHealthPanel'
import { TimeCell } from '@/components/ui/time'
import {
  CAMPAIGN_ENGINES,
  CAMPAIGN_ENGINE_LIST,
  campaignBreadcrumb,
  winbackCategory,
} from '@/lib/comms/campaign-presentation'
import {
  CampaignStatusBadge,
  EnrollmentStatusBadge,
  TouchKindBadge,
  ApprovalBadge,
  CampaignStat,
  CampaignHeaderActions,
  CampaignCrossLinks,
} from '@/components/comms/campaign/CampaignKit'

export const dynamic = 'force-dynamic'

// Pipeline Win-Back Campaign — full campaign detail (§12). One inspectable surface for the whole
// campaign: operational controls (§5a), configuration & settings, the 24-touch schedule, the
// seeded assets (with approval status), the AI/advisor workflows, live analytics, and the
// enrollment roster. Read-only data; controls POST to the audited /api/pipeline-winback endpoints.
// Distinct from the imported /app/winback origination flow (ADR-031). Status vocabulary, engine
// identity, and badges come from the shared campaign layer (@/lib/comms/campaign-presentation +
// CampaignKit) — never redeclared here.

const ENGINE = CAMPAIGN_ENGINES.pipeline_winback

interface EnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
  winback_category: string | null
  stale_days_at_enroll: number | null
}

export default async function PipelineWinbackPage() {
  const campaigns = await load<{ id: string }[]>(
    (db) => db.from('pipeline_winback_campaigns').select('id').order('created_at', { ascending: true }).limit(1),
    [],
  )

  if (!campaigns.ok) {
    return (
      <DetailShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      </DetailShell>
    )
  }
  const campaignId = campaigns.data[0]?.id
  if (!campaignId) {
    return (
      <DetailShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <EmptyState
          title="No campaign found"
          description={`Run migration ${ENGINE.seedMigration} to seed the ${ENGINE.title} campaign and its ${ENGINE.touches}-touch timeline.`}
        />
      </DetailShell>
    )
  }

  const [detail, analytics, enrollments] = await Promise.all([
    loadCampaignDetail(campaignId),
    campaignAnalytics(campaignId),
    load<EnrollmentRow[]>(
      (db) =>
        db
          .from('pipeline_winback_enrollments')
          .select('id, status, current_touch_no, baseline_date, winback_category, stale_days_at_enroll')
          .eq('campaign_id', campaignId)
          .order('updated_at', { ascending: false })
          .limit(50),
      [],
    ),
  ])

  if (!detail) {
    return (
      <DetailShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <ErrorState description="Could not load the campaign." />
      </DetailShell>
    )
  }

  const { config, touches, assets, unapprovedCount } = detail
  const emailAssets = assets.filter((a) => a.category === 'pipeline_winback' && a.channel === 'email')
  const smsAssets = assets.filter((a) => a.category === 'pipeline_winback' && a.channel === 'sms')
  const aiAssets = assets.filter((a) => a.category === 'pipeline_winback_ai')
  const categoryEntries = Object.entries(analytics?.byCategory ?? {})

  return (
    <DetailShell
      title={config.name}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE)}
      status={<CampaignHeaderActions engine={ENGINE} status={config.status} isAssumption={config.is_assumption} />}
      rail={<Rail unapprovedCount={unapprovedCount} />}
    >
      {/* ── Summary ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Eligible now" value={analytics?.eligibleNow ?? 0} hint="Stalled opportunities in view" />
        <StatTile label="Active enrollments" value={analytics?.active ?? 0} tone="brand" />
        <StatTile label="Completed (Day 120)" value={analytics?.completed ?? 0} />
        <StatTile label="Exited / suppressed" value={analytics?.exited ?? 0} />
        <StatTile label="Touches sent" value={analytics?.touches.sent ?? 0} hint="Through the compliance gate" />
      </div>

      {/* ── Operational controls (§5a) ──────────────────────── */}
      <Section title="Operational controls" description="Enable, pause, resume, disable, emergency-stop, or archive. Only an Active campaign dispatches; every action is RBAC-guarded and audited.">
        <Card className="p-5">
          <CampaignControls campaignId={config.id} status={config.status} endpoint="/api/pipeline-winback" />
          {unapprovedCount > 0 && (
            <p className="mt-3 text-xs text-status-pending">
              {unapprovedCount} of {assets.length} assets are not yet approved — the campaign cannot dispatch them until each is approved in the Templates library (ADR-023).
            </p>
          )}
          {!config.simulated_at && config.status !== 'active' && (
            <p className="mt-2 text-xs text-muted-foreground">A read-only simulation is recommended before activation (ADR-021).</p>
          )}
        </Card>
      </Section>

      {/* ── Monitoring & health (§21) ───────────────────────── */}
      <Section title="Monitoring & health" description="Live retry/dead-letter and enrollment counts + last cron runs. Loaded client-side; if monitoring is unavailable the campaign keeps running on its schedule.">
        <Card className="p-5">
          <CampaignHealthPanel endpoint="/api/pipeline-winback" />
        </Card>
      </Section>

      {/* ── Configuration & settings ────────────────────────── */}
      <Section title="Configuration & settings" description="Editable operational defaults (config-default values — verify against your process).">
        <Card className="p-5">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Message purpose" value={config.purpose ?? '—'} note="Marketing consent + unsubscribe enforced at the gate" />
            <Field label="Daily enrollment limit" value={String(config.daily_enrollment_limit)} note="New enrollments per day" />
            <Field label="Staleness floor" value={`${config.stale_min_days} days`} note="Min inactivity before re-engagement" assumption />
            <Field label="Re-enroll cooldown" value={`${config.reenroll_cooldown_days} days`} assumption />
            <Field label="Resume cooling-off" value={`${config.resume_cooling_off_days} days`} assumption />
            <Field label="Advisor task due" value={`${config.advisor_due_hours} h`} assumption />
            <Field label="Advisor escalate after" value={`${config.advisor_overdue_escalate_hours} h`} assumption />
            <Field label="Advisor reassign after" value={`${config.advisor_reassign_after_hours} h`} assumption />
            <Field label="Conversation timeout" value={`${config.conversation_timeout_hours} h`} assumption />
            <Field label="Advisor hold behavior" value={config.advisor_hold_behavior} note="proceed = a missed advisor task never stalls the timeline" />
            <Field label="Created" node={<TimeCell value={config.created_at} precision="date" />} />
            <Field label="Last simulation" node={config.simulated_at ? <TimeCell value={config.simulated_at} precision="date" /> : <span>Never</span>} />
          </dl>
        </Card>
      </Section>

      {/* ── Eligibility ─────────────────────────────────────── */}
      <Section title="Eligibility & audience" description="The single source of truth is the v_pipeline_winback_due view; the pure gate is re-checked before every touch.">
        <Card className="p-5 text-sm">
          <p className="mb-2"><span className="font-medium">Targets:</span> stalled internal pipeline opportunities in stage {WINBACK_CANDIDATE_STAGES.map((s) => <code key={s} className="mx-0.5 rounded bg-muted px-1 py-0.5 text-xs">{s}</code>)} that have been inactive past the staleness floor.</p>
          <p className="mb-2 text-muted-foreground">Precedence (owner-confirmed, ADR-031): (1) an active advisor-owned opportunity outranks automation → (2) Pipeline Win-Back → (3) the imported win-back list. Population is separate from the imported flow (source <code className="rounded bg-muted px-1 py-0.5 text-xs">win_back</code> / <code className="rounded bg-muted px-1 py-0.5 text-xs">term_conversion</code> are excluded).</p>
          <p className="text-muted-foreground">Shared suppression: securities firewall, opt-out / DNC, an upcoming appointment, an active conversation, and a live duplicate enrollment all exclude a candidate.</p>
        </Card>
      </Section>

      {/* ── Schedule (24-touch timeline) ────────────────────── */}
      <Section title={`Schedule — 24 touches over 120 days`} description="Each enrollment runs this timeline on its own clock. At most one proactive touch per day; the compliance gate enforces recipient-local quiet hours.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead className="w-16">Day</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {touches.map((t) => (
              <TableRow key={t.touch_no}>
                <TableCell className="tabular-nums text-muted-foreground">{t.touch_no}</TableCell>
                <TableCell className="tabular-nums">{t.day_offset}</TableCell>
                <TableCell><TouchKindBadge kind={t.kind} /></TableCell>
                <TableCell className="text-muted-foreground">{t.asset_label ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{t.kind === 'advisor_outreach' ? <span className="italic">advisor task (no template)</span> : (t.template?.name ?? '—')}</TableCell>
                <TableCell>
                  <ApprovalBadge status={t.template?.approval_status} advisorTask={t.kind === 'advisor_outreach'} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {/* ── Assets ──────────────────────────────────────────── */}
      <Section title="Assets" description={`${assets.length} seeded templates (8 emails, 8 SMS, 6 AI conversation openings). Bodies are the final §8 copy; each must be approved before dispatch.`}>
        <div className="space-y-4">
          <AssetGroup title="Emails" items={emailAssets} />
          <AssetGroup title="SMS" items={smsAssets} />
          <AssetGroup title="AI conversation openings" items={aiAssets} />
        </div>
      </Section>

      {/* ── Workflows ───────────────────────────────────────── */}
      <Section title="Workflows" description="The AI conversation playbooks, advisor scripts, and event-driven triggers behind the timeline.">
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">AI conversation playbooks ({PLAYBOOKS.length})</h3>
            <div className="space-y-3">
              {PLAYBOOKS.map((p) => (
                <div key={p.key} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{p.title}</span>
                    <Badge variant="outline">Day-{touchDay(touches, p.touch_no)} · touch {p.touch_no}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{p.opening}</p>
                  <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Escalates on:</span> {p.escalateOn.join(', ')} — routed to a licensed advisor (no AI substantive answer, §4.2).</p>
                  <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Exits:</span> {p.exitConditions.join('; ')}.</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Advisor scripts ({ADVISOR_SCRIPTS.length})</h3>
            <div className="space-y-3">
              {ADVISOR_SCRIPTS.map((s) => (
                <div key={s.key} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{s.title}</span>
                    <Badge variant="outline">Day-{touchDay(touches, s.touch_no)} · touch {s.touch_no}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.script}</p>
                  <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Goals:</span> {s.goals.join(', ')}. A logged outreach attempt fulfils the touch; a missed task never stalls the timeline (§9a).</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Event-driven triggers ({EVENT_DRIVEN_SMS.length})</h3>
            <p className="mb-3 text-xs text-muted-foreground">Fire on events (appointment, reply, follow-up), not on the Day schedule — they do not count toward the 24 proactive touches.</p>
            <div className="space-y-2">
              {EVENT_DRIVEN_SMS.map((e) => (
                <div key={e.key} className="rounded-md border p-3">
                  <span className="text-sm font-medium">{e.title}</span>
                  <p className="mt-1 text-sm text-muted-foreground">{e.body}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      {/* ── Analytics ───────────────────────────────────────── */}
      <Section title="Analytics" description="Phase distribution, win-back reason, touch outcomes, and advisor-task health.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Phase distribution (active)</h3>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Early (Day 1–41)" value={analytics?.byPhase.early ?? 0} />
              <CampaignStat label="Mid (Day 42–89)" value={analytics?.byPhase.mid ?? 0} />
              <CampaignStat label="Accelerated (90–120)" value={analytics?.byPhase.accelerated ?? 0} />
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Advisor outreach health (§9a)</h3>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
              <CampaignStat label="Overdue" value={analytics?.advisor.overdue ?? 0} attentionWhenNonZero />
              <CampaignStat label="Missed" value={analytics?.advisor.missed ?? 0} />
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Touch outcomes</h3>
            <div className="grid grid-cols-4 gap-3">
              <CampaignStat label="Sent" value={analytics?.touches.sent ?? 0} />
              <CampaignStat label="Suppressed" value={analytics?.touches.suppressed ?? 0} attentionWhenNonZero />
              <CampaignStat label="Skipped" value={analytics?.touches.skipped ?? 0} />
              <CampaignStat label="Scheduled" value={analytics?.touches.scheduled ?? 0} />
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Win-back reason (enrolled)</h3>
            {categoryEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No enrollments yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {categoryEntries.map(([key, value]) => (
                  <CampaignStat key={key} label={winbackCategory(key)} value={value} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </Section>

      {/* ── Enrollments ─────────────────────────────────────── */}
      <Section title={`Enrollments (${enrollments.ok ? enrollments.data.length : 0})`} description="The 50 most recently updated enrollments on this campaign.">
        {!enrollments.ok ? (
          <ErrorState description="Could not load enrollments." />
        ) : enrollments.data.length === 0 ? (
          <EmptyState
            title="No enrollments yet"
            description="Stalled internal opportunities are enrolled by the daily job or manually; each must be non-securities, opted-in, past the staleness floor, and free of an active advisor opportunity, appointment, or conversation."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Touch</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Win-back reason</TableHead>
                <TableHead>Stale at enroll</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell><EnrollmentStatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{e.current_touch_no} / {ENGINE.touches}</TableCell>
                  <TableCell className="text-muted-foreground"><TimeCell value={e.baseline_date} precision="date" /></TableCell>
                  <TableCell className="text-muted-foreground">{winbackCategory(e.winback_category)}</TableCell>
                  <TableCell className="text-muted-foreground">{e.stale_days_at_enroll != null ? `${e.stale_days_at_enroll}d` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </DetailShell>
  )
}

function Field({ label, value, node, note, assumption }: { label: string; value?: string; node?: React.ReactNode; note?: string; assumption?: boolean }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {assumption && <AssumptionBadge label="default" />}
      </dt>
      <dd className="mt-1 text-sm font-medium">{node ?? value}</dd>
      {note && <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>}
    </div>
  )
}

function AssetGroup({ title, items }: { title: string; items: { id: string; name: string; approval_status: string; body: string }[] }) {
  if (items.length === 0) return null
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold">{title} ({items.length})</h3>
      <div className="space-y-2">
        {items.map((a) => (
          <details key={a.id} className="rounded-md border p-3">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{a.name}</span>
              <ApprovalBadge status={a.approval_status} />
            </summary>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">{a.body}</pre>
          </details>
        ))}
      </div>
    </Card>
  )
}


function Rail({ unapprovedCount }: { unapprovedCount: number }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Related</p>
        <ul className="space-y-1.5">
          <li><Link className="text-primary underline-offset-4 hover:underline" href="/app/comms/templates">Templates library {unapprovedCount > 0 ? `(${unapprovedCount} to approve)` : ''}</Link></li>
          <li><Link className="text-primary underline-offset-4 hover:underline" href="/app/comms/suppression">Suppression</Link></li>
          <li><Link className="text-primary underline-offset-4 hover:underline" href="/app/comms">Communications overview</Link></li>
        </ul>
      </div>
      <CampaignCrossLinks current={ENGINE.key} engines={CAMPAIGN_ENGINE_LIST} />
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Not the imported list</p>
        <p className="mt-1">This campaign targets stalled internal pipeline opportunities. The imported former-client list lives at <Link className="text-primary hover:underline" href="/app/winback">/app/winback</Link>.</p>
      </div>
    </div>
  )
}

function touchDay(touches: { touch_no: number; day_offset: number }[], touchNo: number): number | string {
  return touches.find((t) => t.touch_no === touchNo)?.day_offset ?? '—'
}

