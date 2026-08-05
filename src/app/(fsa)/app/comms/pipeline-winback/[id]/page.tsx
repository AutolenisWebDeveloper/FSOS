import { notFound } from 'next/navigation'
import Link from 'next/link'
import { DetailShell, Section, AssumptionBadge } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TimeCell } from '@/components/ui/time'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/pipeline-winback/analytics'
import { loadCampaignDetail } from '@/lib/pipeline-winback/detail'
import { PLAYBOOKS, ADVISOR_SCRIPTS, EVENT_DRIVEN_SMS } from '@/lib/pipeline-winback/playbooks'
import { WINBACK_CANDIDATE_STAGES } from '@/lib/pipeline-winback/eligibility'
import { CampaignControls } from '@/components/app/CampaignEngineControls'
import { CampaignHealthPanel } from '@/components/app/CampaignHealthPanel'
import { CAMPAIGN_ENGINES, CAMPAIGN_ENGINE_LIST, campaignBreadcrumb, winbackCategory } from '@/lib/comms/campaign-presentation'
import { CampaignStatusBadge, CampaignCrossLinks } from '@/components/comms/campaign/CampaignKit'
import { CampaignStateLine } from '@/components/comms/campaign/CampaignStateLine'
import { CampaignControlsSection } from '@/components/comms/campaign/CampaignControlsSection'
import { CampaignAnalyticsPanel } from '@/components/comms/campaign/CampaignAnalyticsPanel'
import { CampaignScheduleTable } from '@/components/comms/campaign/CampaignScheduleTable'
import { CampaignAssetsTable } from '@/components/comms/campaign/CampaignAssetsTable'
import { CampaignEnrollmentTable } from '@/components/comms/campaign/CampaignEnrollmentTable'

export const dynamic = 'force-dynamic'

// Pipeline Win-Back Campaign — full detail (drill-down), matching the list → [id] shape the other
// two engines already had. Everything below the header is composed from the shared campaign
// components so the section order and vocabulary match Life Conversion and Cross-Sell Life.
// Read-only data; controls POST to the audited /api/pipeline-winback endpoints.
// Distinct from the imported /app/winback origination flow (ADR-031).

const ENGINE = CAMPAIGN_ENGINES.pipeline_winback

interface EnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
  winback_category: string | null
  stale_days_at_enroll: number | null
}

export default async function PipelineWinbackDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const [detail, analytics, enrollments] = await Promise.all([
    loadCampaignDetail(id),
    campaignAnalytics(id),
    load<EnrollmentRow[]>(
      (db) =>
        db
          .from('pipeline_winback_enrollments')
          .select('id, status, current_touch_no, baseline_date, winback_category, stale_days_at_enroll')
          .eq('campaign_id', id)
          .order('updated_at', { ascending: false })
          .limit(50),
      [],
    ),
  ])

  if (!detail) notFound()
  const { config, touches, assets, unapprovedCount } = detail

  return (
    <DetailShell
      title={config.name}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE, config.name)}
      status={
        <div className="flex items-center gap-2">
          <CampaignStatusBadge status={config.status} />
          {config.is_assumption && <AssumptionBadge />}
        </div>
      }
      rail={<Rail unapprovedCount={unapprovedCount} />}
    >
      <div className="space-y-6">
        {/* 0 — Is this campaign OK right now? */}
        <CampaignStateLine
          status={config.status}
          simulatedAt={config.simulated_at}
          unapprovedTemplates={unapprovedCount}
          totalTemplates={assets.length}
          activeEnrollments={analytics?.totals.active ?? 0}
          pausedEnrollments={analytics?.totals.paused ?? 0}
          suppressedTouches={analytics?.touches.suppressed ?? 0}
          deadLetterTouches={analytics?.touches.dead_letter ?? 0}
          overdueAdvisorTasks={analytics?.advisor.overdue ?? 0}
        />

        {/* 1 — Operational controls */}
        <CampaignControlsSection
          engine={ENGINE}
          status={config.status}
          simulatedAt={config.simulated_at}
          unapprovedCount={unapprovedCount}
          assetCount={assets.length}
        >
          <CampaignControls campaignId={config.id} status={config.status} endpoint={ENGINE.apiRoot} />
        </CampaignControlsSection>

        {/* 2 — Monitoring & health */}
        <Section
          title="Monitoring & health"
          description="Live retry/dead-letter and enrollment counts plus the last cron runs. Loaded after the page; if monitoring is unavailable the campaign keeps running on its schedule."
        >
          <Card className="p-5">
            <CampaignHealthPanel endpoint={ENGINE.apiRoot} />
          </Card>
        </Section>

        {/* 3 — Analytics */}
        <CampaignAnalyticsPanel
          engine={ENGINE}
          analytics={analytics}
          phaseLabels={{ early: 'Early (Day 1–41)', mid: 'Mid (Day 42–89)', accelerated: 'Accelerated (Day 90–120)' }}
        />

        {/* 4 — Eligibility & audience */}
        <Section
          title="Eligibility & audience"
          description="The single source of truth is the v_pipeline_winback_due view; the pure gate is re-checked before every touch."
        >
          <Card className="space-y-2 p-5 text-sm">
            <p>
              <span className="font-medium">Targets:</span> stalled internal pipeline opportunities in stage{' '}
              {WINBACK_CANDIDATE_STAGES.map((s) => (
                <code key={s} className="mx-0.5 rounded bg-muted px-1 py-0.5 text-xs">
                  {s}
                </code>
              ))}{' '}
              that have been inactive past the staleness floor.
            </p>
            <p className="text-muted-foreground">
              Precedence (owner-confirmed, ADR-031): an active advisor-owned opportunity outranks automation, then Pipeline
              Win-Back, then the imported win-back list. Population is separate from the imported flow — source{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">win_back</code> and{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">term_conversion</code> are excluded.
            </p>
            <p className="text-muted-foreground">
              Shared suppression: the securities firewall, opt-out and DNC, an upcoming appointment, an active conversation, and a
              live duplicate enrollment each exclude a candidate.
            </p>
          </Card>
        </Section>

        {/* 5 — Schedule */}
        <CampaignScheduleTable
          engine={ENGINE}
          touches={touches}
          description="Each enrollment runs this timeline on its own clock. At most one proactive touch per day; the compliance gate enforces recipient-local quiet hours."
          acceleratesFromDay={90}
        />

        {/* 6 — Message assets */}
        <CampaignAssetsTable
          description="The final §8 copy, seeded as templates. Each must clear the approval gate before this campaign can dispatch it."
          groups={[
            {
              title: 'Emails',
              items: assets
                .filter((a) => a.category === 'pipeline_winback' && a.channel === 'email')
                .map((a) => ({ key: a.id, name: a.name, approval_status: a.approval_status, body: a.body })),
            },
            {
              title: 'SMS',
              items: assets
                .filter((a) => a.category === 'pipeline_winback' && a.channel === 'sms')
                .map((a) => ({ key: a.id, name: a.name, approval_status: a.approval_status, body: a.body })),
            },
            {
              title: 'AI conversation openings',
              items: assets
                .filter((a) => a.category === 'pipeline_winback_ai')
                .map((a) => ({ key: a.id, name: a.name, approval_status: a.approval_status, body: a.body })),
            },
          ]}
        />

        {/* 7 — Workflows & rules */}
        <Section
          title="Workflows & rules"
          description="The AI conversation playbooks, advisor scripts, and event-driven triggers behind the timeline."
        >
          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">AI conversation playbooks ({PLAYBOOKS.length})</h3>
              <div className="space-y-3">
                {PLAYBOOKS.map((p) => (
                  <div key={p.key} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{p.title}</span>
                      <Badge variant="outline">
                        Day {touchDay(touches, p.touch_no)} · touch {p.touch_no}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{p.opening}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Escalates on:</span> {p.escalateOn.join(', ')} — routed to a
                      licensed advisor. The AI never answers substantively (§4.2).
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Exits:</span> {p.exitConditions.join('; ')}.
                    </p>
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
                      <Badge variant="outline">
                        Day {touchDay(touches, s.touch_no)} · touch {s.touch_no}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{s.script}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Goals:</span> {s.goals.join(', ')}. A logged outreach attempt
                      fulfils the touch; a missed task never stalls the timeline (§9a).
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Event-driven triggers ({EVENT_DRIVEN_SMS.length})</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                These fire on events — an appointment, a reply, a follow-up — not on the day schedule, so they do not count toward
                the {ENGINE.touches} proactive touches.
              </p>
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

        {/* 8 — Configuration & settings */}
        <Section
          title="Configuration & settings"
          description="Editable operational defaults. Gold-badged values are config defaults to verify (§4.3), not Farmers-published figures."
        >
          <Card className="p-5">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Message purpose" value={config.purpose ?? '—'} note="Marketing consent and unsubscribe are enforced at the gate" />
              <Field label="Daily enrollment limit" value={String(config.daily_enrollment_limit)} note="New enrollments per day" />
              <Field label="Staleness floor" value={`${config.stale_min_days} days`} note="Minimum inactivity before re-engagement" assumption />
              <Field label="Re-enroll cooldown" value={`${config.reenroll_cooldown_days} days`} assumption />
              <Field label="Resume cooling-off" value={`${config.resume_cooling_off_days} days`} assumption />
              <Field label="Advisor task due" value={`${config.advisor_due_hours} hours`} assumption />
              <Field label="Advisor escalate after" value={`${config.advisor_overdue_escalate_hours} hours`} assumption />
              <Field label="Advisor reassign after" value={`${config.advisor_reassign_after_hours} hours`} assumption />
              <Field label="Conversation timeout" value={`${config.conversation_timeout_hours} hours`} assumption />
              <Field
                label="Advisor hold behavior"
                value={config.advisor_hold_behavior}
                note={config.advisor_hold_behavior === 'proceed' ? 'A missed advisor task never stalls the timeline' : 'The timeline holds until the task is fulfilled or times out'}
              />
              <Field label="Created" node={<TimeCell value={config.created_at} precision="date" />} />
              <Field
                label="Last simulation"
                node={config.simulated_at ? <TimeCell value={config.simulated_at} precision="date" /> : <span>Never</span>}
              />
            </dl>
          </Card>
        </Section>

        {/* 9 — Enrollments */}
        <CampaignEnrollmentTable
          engine={ENGINE}
          rows={enrollments.ok ? enrollments.data : null}
          error={!enrollments.ok}
          emptyDescription="Stalled internal opportunities are enrolled by the daily job or manually. Each must be non-securities, opted in, past the staleness floor, and free of an active advisor opportunity, appointment, or conversation."
          extraColumns={[
            { header: 'Win-back reason', cell: (row) => winbackCategory(row.winback_category) },
            { header: 'Stale at enroll', cell: (row) => (row.stale_days_at_enroll != null ? `${row.stale_days_at_enroll}d` : '—') },
          ]}
        />
      </div>
    </DetailShell>
  )
}

function Field({
  label,
  value,
  node,
  note,
  assumption,
}: {
  label: string
  value?: string
  node?: React.ReactNode
  note?: string
  assumption?: boolean
}) {
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

function Rail({ unapprovedCount }: { unapprovedCount: number }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Related</p>
        <ul className="space-y-1.5">
          <li>
            <Link className="text-primary underline-offset-4 hover:underline" href="/app/comms/templates">
              Templates library {unapprovedCount > 0 ? `(${unapprovedCount} to approve)` : ''}
            </Link>
          </li>
          <li>
            <Link className="text-primary underline-offset-4 hover:underline" href="/app/comms/suppression">
              Suppression
            </Link>
          </li>
          <li>
            <Link className="text-primary underline-offset-4 hover:underline" href="/app/comms">
              Communications overview
            </Link>
          </li>
        </ul>
      </div>
      <CampaignCrossLinks current={ENGINE.key} engines={CAMPAIGN_ENGINE_LIST} />
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Not the imported list</p>
        <p className="mt-1">
          This campaign targets stalled internal pipeline opportunities. The imported former-client list lives at{' '}
          <Link className="text-primary underline-offset-4 hover:underline" href="/app/winback">
            /app/winback
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

function touchDay(touches: { touch_no: number; day_offset: number }[], touchNo: number): number | string {
  return touches.find((t) => t.touch_no === touchNo)?.day_offset ?? '—'
}
