import { notFound } from 'next/navigation'
import Link from 'next/link'
import { DetailShell, Section } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TimeCell } from '@/components/ui/time'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/district-nurture/analytics'
import { loadCampaignDetail } from '@/lib/district-nurture/detail'
import { CURRICULUM, LIVE_TOUCHPOINTS, CALENDAR_OVERLAYS } from '@/lib/district-nurture/playbooks'
import { TOUCH_SCHEDULE } from '@/lib/district-nurture/schedule'
import { CampaignControls } from '@/components/app/CampaignEngineControls'
import { CampaignHealthPanel } from '@/components/app/CampaignHealthPanel'
import { CAMPAIGN_ENGINES, CAMPAIGN_ENGINE_LIST, campaignBreadcrumb } from '@/lib/comms/campaign-presentation'
import { CampaignStatusBadge, CampaignCrossLinks } from '@/components/comms/campaign/CampaignKit'
import { CampaignStateLine } from '@/components/comms/campaign/CampaignStateLine'
import { CampaignControlsSection } from '@/components/comms/campaign/CampaignControlsSection'
import { CampaignAnalyticsPanel } from '@/components/comms/campaign/CampaignAnalyticsPanel'
import { CampaignTimelineRibbon } from '@/components/comms/campaign/CampaignTimelineRibbon'
import { CampaignScheduleTable } from '@/components/comms/campaign/CampaignScheduleTable'
import { CampaignAssetsTable } from '@/components/comms/campaign/CampaignAssetsTable'
import { CampaignEnrollmentTable } from '@/components/comms/campaign/CampaignEnrollmentTable'

export const dynamic = 'force-dynamic'

// The Second Conversation — full campaign detail (ADR-038). Agent-facing 12-module curriculum.
// Composed from the shared campaign components so section order and vocabulary match the three
// client engines, plus curriculum / live-touchpoint / calendar-overlay / launch-readiness
// sections specific to this agent-education campaign. Read-only data; controls POST to the
// audited /api/district-nurture endpoints.

const ENGINE = CAMPAIGN_ENGINES.district_nurture

interface EnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
}

export default async function DistrictNurtureDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const [detail, analytics, enrollments] = await Promise.all([
    loadCampaignDetail(id),
    campaignAnalytics(id),
    load<EnrollmentRow[]>(
      (db) =>
        db
          .from('district_nurture_enrollments')
          .select('id, status, current_touch_no, baseline_date')
          .eq('campaign_id', id)
          .order('updated_at', { ascending: false })
          .limit(50),
      [],
    ),
  ])

  if (!detail) notFound()
  const { config, touches, assets, unapprovedCount } = detail

  // Launch-readiness checklist (required before deliberate production activation).
  const readiness = [
    { label: 'All content approved', ok: assets.length > 0 && unapprovedCount === 0, hint: `${unapprovedCount} of ${assets.length} templates still draft` },
    { label: 'Curriculum fully built (40 touches)', ok: touches.length === ENGINE.touches, hint: `${touches.length}/${ENGINE.touches} touch rows` },
    { label: 'Simulation run', ok: !!config.simulated_at, hint: config.simulated_at ? 'Last simulation on record' : 'Run a simulation from the console before activating' },
    { label: 'Campaign not yet live', ok: config.status !== 'active', hint: config.status === 'active' ? 'Already active' : 'Draft/paused — safe to review' },
  ]
  const readyCount = readiness.filter((r) => r.ok).length

  return (
    <DetailShell
      title={config.name}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE, config.name)}
      status={
        <div className="flex items-center gap-2">
          <CampaignStatusBadge status={config.status} />
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

        {/* Campaign at a glance — the 12-month curriculum shape */}
        <CampaignTimelineRibbon
          engine={ENGINE}
          touches={touches}
          acceleratesFromDay={241}
          phases={[
            { key: 'early', label: 'Foundations', fromDay: 0, activeCount: analytics?.byPhase?.early ?? 0 },
            { key: 'mid', label: 'Products & FNA', fromDay: 121, activeCount: analytics?.byPhase?.mid ?? 0 },
            { key: 'accelerated', label: 'Advanced & legacy', fromDay: 241, activeCount: analytics?.byPhase?.accelerated ?? 0 },
          ]}
        />

        {/* 1 — Launch readiness */}
        <Section
          title="Launch readiness"
          description="Verify each item before deliberate production activation. Nothing dispatches while any template is unapproved or the campaign is not Active."
        >
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium">
              {readyCount}/{readiness.length} checks passing
            </p>
            <ul className="space-y-2">
              {readiness.map((r) => (
                <li key={r.label} className="flex items-start gap-2 text-sm">
                  <Badge variant={r.ok ? 'won' : 'pending'}>{r.ok ? 'Ready' : 'Pending'}</Badge>
                  <span>
                    <span className="font-medium">{r.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{r.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        {/* 2 — Operational controls */}
        <CampaignControlsSection
          engine={ENGINE}
          status={config.status}
          simulatedAt={config.simulated_at}
          unapprovedCount={unapprovedCount}
          assetCount={assets.length}
        >
          <CampaignControls campaignId={config.id} status={config.status} endpoint={ENGINE.apiRoot} />
        </CampaignControlsSection>

        {/* 3 — Monitoring & health */}
        <Section
          title="Monitoring & health"
          description="Live retry/dead-letter and enrollment counts plus the last cron runs. Loaded after the page; if monitoring is unavailable the campaign keeps running on its schedule."
        >
          <Card className="p-5">
            <CampaignHealthPanel endpoint={ENGINE.apiRoot} />
          </Card>
        </Section>

        {/* 4 — Analytics */}
        <CampaignAnalyticsPanel engine={ENGINE} analytics={analytics} />

        {/* 5 — Eligibility & audience */}
        <Section
          title="Eligibility & audience"
          description="The single source of truth is the v_district_nurture_candidates view; the pure gate is re-checked before every touch."
        >
          <Card className="space-y-2 p-5 text-sm">
            <p>
              <span className="font-medium">Targets:</span> Farmers district agents (agency owners) who are reachable by email or
              phone and whose agency is not terminated. This is an agent-facing B2B education campaign — it never enrolls a client
              or household.
            </p>
            <p className="text-muted-foreground">
              Suppression: an opt-out (STOP / DNC), a terminated agency, an unreachable contact, an active conversation, a live
              duplicate enrollment, or the re-enroll cooldown each exclude a candidate. Every send additionally passes the
              compliance gate (consent, quiet hours, DNC, approved template, securities firewall).
            </p>
            <p className="text-muted-foreground">
              Agent consent is captured as durable contact-consent (comm_contact_consents) keyed by the agent&apos;s phone/email —
              agents are contact-resolvable, not household members (ADR-038).
            </p>
          </Card>
        </Section>

        {/* 6 — Schedule */}
        <CampaignScheduleTable
          engine={ENGINE}
          touches={touches}
          description="Each enrollment runs this 12-month timeline on its own clock from its baseline. At most one touch per day; the compliance gate enforces recipient-local quiet hours. Two emails and one SMS per module, plus a live touchpoint each quarter."
          acceleratesFromDay={241}
        />

        {/* 7 — Curriculum (agent education matrix) */}
        <Section
          title="Financial Services curriculum (12 modules)"
          description="The sequential learning progression. Each module teaches what a concept does, the client statement that signals it, what the agent may say, what requires the licensed FSA, and how to introduce."
        >
          <div className="space-y-3">
            {CURRICULUM.map((m) => (
              <Card key={m.module_no} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    Module {m.module_no}: {m.title}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {m.topics.map((tp) => (
                      <Badge key={tp} variant="outline">
                        {tp}
                      </Badge>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{m.objective}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Concept:</span> {m.concept}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Client signals:</span> {m.client_signals.join(' · ')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Agent may say:</span> {m.agent_may_say}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-status-security">Requires the FSA:</span> {m.requires_fsa}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">How to introduce:</span> {m.how_to_introduce}
                </p>
              </Card>
            ))}
          </div>
        </Section>

        {/* 8 — Content library */}
        <CampaignAssetsTable
          description="The full curriculum copy, seeded as draft templates. Each must clear the approval gate before this campaign can dispatch it. Preview in the console (Test this campaign)."
          groups={[
            {
              title: 'Emails (24)',
              items: assets
                .filter((a) => a.category === 'district_nurture' && a.channel === 'email')
                .map((a) => ({ key: a.id, name: a.name, approval_status: a.approval_status, body: a.body })),
            },
            {
              title: 'SMS (12)',
              items: assets
                .filter((a) => a.category === 'district_nurture' && a.channel === 'sms')
                .map((a) => ({ key: a.id, name: a.name, approval_status: a.approval_status, body: a.body })),
            },
          ]}
        />

        {/* 9 — Live touchpoints & calendar overlays */}
        <Section
          title="Live touchpoints & calendar overlays"
          description="Four quarterly human touchpoints (never auto-dispatched) plus seasonal overlays that activate on the calendar without reordering the sequential curriculum (ADR-038 §5)."
        >
          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Quarterly live touchpoints ({LIVE_TOUCHPOINTS.length})</h3>
              <div className="space-y-3">
                {LIVE_TOUCHPOINTS.map((l) => (
                  <div key={l.key} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{l.title}</span>
                      <Badge variant="outline">
                        Day {touchDay(touches, l.touch_no)} · touch {l.touch_no}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{l.script}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Goals:</span> {l.goals.join(', ')}. A logged attempt fulfils the
                      touch; a missed live touch never stalls the timeline (§9a).
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Calendar overlays ({CALENDAR_OVERLAYS.length})</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                The 12-module curriculum is sequential relative to each agent&apos;s baseline. These seasonal initiatives are
                activation tasks layered on the calendar — they never reorder the curriculum (ADR-038 §5).
              </p>
              <div className="space-y-2">
                {CALENDAR_OVERLAYS.map((o) => (
                  <div key={o.key} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{o.title}</span>
                      <Badge variant="outline">{MONTHS[o.month - 1]}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{o.note}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Activation:</span> {o.activation}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Section>

        {/* 10 — Configuration & settings */}
        <Section
          title="Configuration & settings"
          description="Editable operational defaults."
        >
          <Card className="p-5">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Message purpose" value={config.purpose ?? '—'} note="Marketing consent and unsubscribe are enforced at the gate" />
              <Field
                label="Start date"
                node={config.start_date ? <TimeCell value={config.start_date} precision="date" /> : <span>On enrollment</span>}
                note="Baseline = the later of this date and the enrollment day"
              />
              <Field label="Daily enrollment limit" value={String(config.daily_enrollment_limit)} note="New agents enrolled per day" />
              <Field label="Re-enroll cooldown" value={`${config.reenroll_cooldown_days} days`} />
              <Field label="Resume cooling-off" value={`${config.resume_cooling_off_days} days`} />
              <Field label="Live-touch task due" value={`${config.advisor_due_hours} hours`} />
              <Field label="Live-touch escalate after" value={`${config.advisor_overdue_escalate_hours} hours`} />
              <Field label="Live-touch reassign after" value={`${config.advisor_reassign_after_hours} hours`} />
              <Field label="Conversation timeout" value={`${config.conversation_timeout_hours} hours`} />
              <Field
                label="Live-touch hold behavior"
                value={config.advisor_hold_behavior}
                note={config.advisor_hold_behavior === 'proceed' ? 'A missed live touch never stalls the timeline' : 'The timeline holds until the touch is fulfilled or times out'}
              />
              <Field label="Created" node={<TimeCell value={config.created_at} precision="date" />} />
              <Field
                label="Last simulation"
                node={config.simulated_at ? <TimeCell value={config.simulated_at} precision="date" /> : <span>Never</span>}
              />
            </dl>
          </Card>
        </Section>

        {/* 11 — Enrollments */}
        <CampaignEnrollmentTable
          engine={ENGINE}
          rows={enrollments.ok ? enrollments.data : null}
          error={!enrollments.ok}
          emptyDescription="District agents are enrolled by the daily job or manually. Each must be a reachable, non-terminated agency owner who has not opted out and is not already enrolled."
          extraColumns={[{ header: 'Curriculum', cell: (row) => moduleForTouch(row.current_touch_no) }]}
        />
      </div>
    </DetailShell>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function moduleForTouch(touchNo: number): string {
  const t = TOUCH_SCHEDULE.find((x) => x.touch_no === touchNo)
  if (!t) return '—'
  return t.module_no ? `Module ${t.module_no}` : 'Live touchpoint'
}

function Field({
  label,
  value,
  node,
  note,
}: {
  label: string
  value?: string
  node?: React.ReactNode
  note?: string
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
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
        <p className="font-medium text-foreground">Agent-facing education</p>
        <p className="mt-1">
          This campaign nurtures Farmers district agents so they recognize financial signals and refer to the licensed FSA. It is
          separate from the client-facing Life Conversion, Cross-Sell Life, and Win-Back campaigns.
        </p>
      </div>
    </div>
  )
}

function touchDay(touches: { touch_no: number; day_offset: number }[], touchNo: number): number | string {
  return touches.find((t) => t.touch_no === touchNo)?.day_offset ?? '—'
}
