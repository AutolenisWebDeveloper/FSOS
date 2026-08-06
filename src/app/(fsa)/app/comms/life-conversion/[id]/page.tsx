import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, Section, AssumptionBadge } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { loadCampaignDetail } from '@/lib/life-campaign/detail'
import { campaignAnalytics } from '@/lib/life-campaign/analytics'
import { CampaignControls } from '@/components/app/CampaignEngineControls'
import { CampaignHealthPanel } from '@/components/app/CampaignHealthPanel'
import { TimeCell } from '@/components/ui/time'
import { CAMPAIGN_ENGINES, CAMPAIGN_ENGINE_LIST, campaignBreadcrumb, touchKind } from '@/lib/comms/campaign-presentation'
import { CampaignStatusBadge, CampaignCrossLinks } from '@/components/comms/campaign/CampaignKit'
import { CampaignStateLine } from '@/components/comms/campaign/CampaignStateLine'
import { CampaignControlsSection } from '@/components/comms/campaign/CampaignControlsSection'
import { CampaignAnalyticsPanel } from '@/components/comms/campaign/CampaignAnalyticsPanel'
import { CampaignTimelineRibbon } from '@/components/comms/campaign/CampaignTimelineRibbon'
import { CampaignScheduleTable } from '@/components/comms/campaign/CampaignScheduleTable'
import { CampaignAssetsTable } from '@/components/comms/campaign/CampaignAssetsTable'
import { CampaignEnrollmentTable } from '@/components/comms/campaign/CampaignEnrollmentTable'

export const dynamic = 'force-dynamic'

// Life Conversion Campaign — full detail (drill-down). One place for the complete
// configuration, the 20-touch schedule, the message assets, the workflow rules, live
// analytics, settings, and operational controls (§4b/§5/§14/§15).
// Status vocabulary, engine identity, and badges come from the shared campaign layer
// (@/lib/comms/campaign-presentation + CampaignKit) — never redeclared here.

const ENGINE = CAMPAIGN_ENGINES.life_conversion

interface EnrollmentRow {
  id: string; status: string; current_touch_no: number; baseline_date: string; conversion_deadline: string | null
}

export default async function LifeConversionDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const [detail, analytics, enrollments] = await Promise.all([
    loadCampaignDetail(id),
    campaignAnalytics(id),
    load<EnrollmentRow[]>(
      (db) => db.from('life_campaign_enrollments').select('id, status, current_touch_no, baseline_date, conversion_deadline').eq('campaign_id', id).order('updated_at', { ascending: false }).limit(50),
      [],
    ),
  ])

  if (!detail) notFound()
  const s = detail.settings
  const templated = detail.touches.filter((t) => t.template)

  return (
    <DetailShell
      title={s.name}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE, s.name)}
      status={
        <div className="flex items-center gap-2">
          <CampaignStatusBadge status={s.status} />
          {s.is_assumption && <AssumptionBadge />}
        </div>
      }
      rail={<CampaignCrossLinks current={ENGINE.key} engines={CAMPAIGN_ENGINE_LIST} />}
    >
      <div className="space-y-6">
        {/* 0 — Is this campaign OK right now? */}
        <CampaignStateLine
          status={s.status}
          simulatedAt={s.simulated_at}
          unapprovedTemplates={templated.filter((t) => t.template!.approval_status !== 'approved').length}
          totalTemplates={templated.length}
          activeEnrollments={analytics?.totals.active ?? 0}
          pausedEnrollments={analytics?.totals.paused ?? 0}
          suppressedTouches={analytics?.touches.suppressed ?? 0}
          deadLetterTouches={analytics?.touches.dead_letter ?? 0}
          overdueAdvisorTasks={analytics?.advisor.overdue ?? 0}
        />

        {/* Campaign at a glance — the timeline shape and where the active book sits */}
        <CampaignTimelineRibbon
          engine={ENGINE}
          touches={detail.touches}
          acceleratesFromDay={135}
          phases={[
            { key: 'early', label: 'Early', fromDay: 0, activeCount: analytics?.byPhase?.early ?? 0 },
            { key: 'mid', label: 'Mid', fromDay: 48, activeCount: analytics?.byPhase?.mid ?? 0 },
            { key: 'accelerated', label: 'Accelerated', fromDay: 135, activeCount: analytics?.byPhase?.accelerated ?? 0 },
          ]}
        />

        {/* 1 — Operational controls */}
        <CampaignControlsSection engine={ENGINE} status={s.status} simulatedAt={s.simulated_at}>
          <CampaignControls campaignId={s.id} status={s.status} endpoint={ENGINE.apiRoot} />
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
        <CampaignAnalyticsPanel engine={ENGINE} analytics={analytics} />

        {/* 5 — Schedule */}
        <CampaignScheduleTable
          engine={ENGINE}
          touches={detail.touches}
          description="Day offsets are authoritative (§5). The final 45 days accelerate and alternate channels."
          acceleratesFromDay={135}
          stripTemplatePrefix="Life Conversion — "
        />

        {/* 6 — Message assets */}
        <CampaignAssetsTable
          description="The finalized §14 copy, seeded as templates. Each must clear the human approval gate before this campaign can dispatch it (ADR-023)."
          groups={[
            {
              title: 'Templates',
              items: templated
                .map((t) => ({
                  key: String(t.touch_no),
                  name: t.template!.name.replace('Life Conversion — ', ''),
                  approval_status: t.template!.approval_status,
                  body: t.template!.body,
                  eyebrow: `#${t.touch_no} · ${touchKind(t.kind).label}`,
                })),
            },
          ]}
        />

        {/* 6b — AI conversation playbooks + advisor scripts */}
        <Section
          title={`AI conversation playbooks (${detail.playbooks.length})`}
          description="What the AI may say on an ai_conversation touch, and where it must stop. Every opener identifies itself as an automated assistant; the SMS path also appends the TRAIGA AI disclosure."
        >
          <Card className="p-5">
            <div className="space-y-3">
              {detail.playbooks.map((p) => (
                <div key={p.key} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{p.title}</span>
                    <Badge variant="outline">touch {p.touch_no}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.objective}</p>
                  <PlaybookLine label="Opening" value={p.opening} />
                  <PlaybookLine label="No-reply follow-up" value={p.followUp} />
                  <PlaybookLine label="Advisor handoff" value={p.handoff} />
                  <PlaybookLine label="Closing" value={p.closing} />
                  <PlaybookLine label="Allowed (green zone)" value={p.allowed} />
                  <PlaybookLine label="Prohibited (red line)" value={p.prohibited} danger />
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Escalates on:</span> {p.escalateOn.join(', ')} — routed to the
                    licensed FSA. The AI never answers a policy-specific question (§4.2).
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        <Section
          title={`Advisor scripts (${detail.advisorScripts.length})`}
          description="Suggested openers for the two human advisor-outreach touches. A logged outreach attempt fulfils the touch; nothing here is auto-dispatched."
        >
          <Card className="p-5">
            <div className="space-y-3">
              {detail.advisorScripts.map((a) => (
                <div key={a.key} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{a.title}</span>
                    <Badge variant="outline">touch {a.touch_no}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.script}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Goals:</span> {a.goals.join(', ')}.
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* 7 — Workflows & rules */}
        <Section title="Workflows & rules" description="How the campaign behaves — grounded in this campaign's actual settings.">
          <Card className="p-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Rule term="Eligibility (Active Opportunity Ownership)" def="Enrolled only with a verified conversion deadline, no securities flag, no open term-conversion opportunity, and not opted out. Rechecked before enrollment and before every touch." />
            <Rule term="A reply pauses automation" def="Any genuine inbound reply pauses the timeline; it resumes only on manual resume, a resolved/closed conversation, or after the cooling-off period." />
            <Rule term="Resume cooling-off" def={`${s.resume_cooling_off_days} days quiet before automation resumes.`} assumption />
            <Rule term="Conversation timeout" def={`A one-reply-then-silent conversation closes as abandoned after ${s.conversation_timeout_hours} hours (advisor-owned conversations are exempt).`} assumption />
            <Rule term="Advisor outreach" def={`Task due in ${s.advisor_due_hours}h; escalates after ${s.advisor_overdue_escalate_hours}h overdue; reassigns after ${s.advisor_reassign_after_hours}h. Completion requires a logged outreach attempt.`} assumption />
            <Rule term="Advisor hold behavior" def={s.advisor_hold_behavior === 'proceed' ? 'Timeline proceeds past an incomplete advisor task (logged as missed).' : 'Timeline holds until the advisor task is fulfilled or times out.'} />
            <Rule term="Deadline safety" def={`Enrollment is declined (routed to advisor review) unless Day 180 lands ≥ ${s.early_enrollment_buffer_days} days before the verified deadline.`} assumption />
            <Rule term="Exits" def="Appointment booked, application started, conversion completed, or opt-out each exit the campaign to the appropriate workflow." />
          </dl>
          </Card>
        </Section>

        {/* 8 — Configuration & settings */}
        <Section title="Configuration & settings" description="Editable operational defaults. Gold-badged values are config defaults to verify (§4.3), not Farmers-published figures.">
          <Card className="p-5">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Setting label="Message purpose" value={s.purpose ?? '—'} />
            <Setting label="Delegated sender" value={s.delegation_id ? 'Configured' : 'None (FSA is sender)'} />
            <Setting label="Daily enrollment limit" value={String(s.daily_enrollment_limit)} assumption />
            <Setting label="Re-enrollment cooldown" value={`${s.reenroll_cooldown_days} days`} assumption />
            <Setting label="Resume cooling-off" value={`${s.resume_cooling_off_days} days`} assumption />
            <Setting label="Advisor task due" value={`${s.advisor_due_hours} hours`} assumption />
            <Setting label="Advisor escalate after" value={`${s.advisor_overdue_escalate_hours} hours`} assumption />
            <Setting label="Advisor reassign after" value={`${s.advisor_reassign_after_hours} hours`} assumption />
            <Setting label="Conversation timeout" value={`${s.conversation_timeout_hours} hours`} assumption />
            <Setting label="Early-enrollment buffer" value={`${s.early_enrollment_buffer_days} days`} assumption />
            <Setting label="Advisor hold behavior" value={s.advisor_hold_behavior} />
            <Setting label="Created" node={<TimeCell value={s.created_at} precision="date" />} />
          </dl>
          </Card>
        </Section>

        {/* 9 — Enrollments */}
        <CampaignEnrollmentTable
          engine={ENGINE}
          rows={enrollments.ok ? enrollments.data : null}
          error={!enrollments.ok}
          emptyDescription="Eligible term-conversion contacts are enrolled by the daily job or manually. Each must have a verified conversion deadline and no active opportunity."
          extraColumns={[{ header: 'Conversion deadline', cell: (row) => row.conversion_deadline ?? '—' }]}
        />

        <p className="text-sm">
          <Link href={ENGINE.href} className="text-primary underline-offset-4 hover:underline">
            ← Back to {ENGINE.title}
          </Link>
        </p>
      </div>
    </DetailShell>
  )
}



/** One labelled line of playbook copy. `danger` tints the red-line row. */
function PlaybookLine({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <p className={`mt-1 text-sm ${danger ? 'text-destructive' : 'text-muted-foreground'}`}>
      <span className="font-medium text-foreground">{label}:</span> {value}
    </p>
  )
}

function Rule({ term, def, assumption }: { term: string; def: string; assumption?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="flex items-center gap-2 text-sm font-medium">{term}{assumption && <AssumptionBadge />}</dt>
      <dd className="mt-1 text-xs text-muted-foreground">{def}</dd>
    </div>
  )
}

function Setting({ label, value, node, assumption }: { label: string; value?: string; node?: React.ReactNode; assumption?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">{label}{assumption && <AssumptionBadge />}</dt>
      <dd className="mt-1 text-sm font-medium">{node ?? value}</dd>
    </div>
  )
}
