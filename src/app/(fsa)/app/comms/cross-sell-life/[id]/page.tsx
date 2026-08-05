import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, Section, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { loadCampaignDetail } from '@/lib/cross-sell-life/detail'
import { campaignAnalytics } from '@/lib/cross-sell-life/analytics'
import { CampaignControls } from './controls'
import { CampaignHealthPanel } from '@/components/app/CampaignHealthPanel'
import { TimeCell } from '@/components/ui/time'
import { CAMPAIGN_ENGINES, CAMPAIGN_ENGINE_LIST, campaignBreadcrumb, campaignDetailHref, campaignStatus } from '@/lib/comms/campaign-presentation'
import { CampaignStatusBadge, CampaignCrossLinks } from '@/components/comms/campaign/CampaignKit'
import { CampaignStateLine } from '@/components/comms/campaign/CampaignStateLine'
import { CampaignControlsSection } from '@/components/comms/campaign/CampaignControlsSection'
import { CampaignAnalyticsPanel } from '@/components/comms/campaign/CampaignAnalyticsPanel'
import { CampaignScheduleTable } from '@/components/comms/campaign/CampaignScheduleTable'
import { CampaignAssetsTable } from '@/components/comms/campaign/CampaignAssetsTable'
import { CampaignEnrollmentTable } from '@/components/comms/campaign/CampaignEnrollmentTable'

export const dynamic = 'force-dynamic'

// Cross-Sell Life Campaign — Management Center (the full "Campaign Management Interface").
// One place for the complete campaign: overview, configuration/settings, the 35-touch / 180-day
// schedule, the message + AI-playbook + advisor-script assets, operational controls, live
// analytics + health monitoring, and version history. Server component: reads come directly from
// loadCampaignDetail + campaignAnalytics (no self-fetch for SSR). Parallel to the Life Conversion
// detail page (same shells, tokens, and states). Status vocabulary, engine identity, and badges
// come from the shared campaign layer (@/lib/comms/campaign-presentation + CampaignKit) — never
// redeclared here. Timestamps render through TimeCell, so an advisor reads their own clock rather
// than the server's UTC.

const ENGINE = CAMPAIGN_ENGINES.cross_sell_life

interface EnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
}

export default async function CrossSellLifeDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const [detail, analytics, enrollments] = await Promise.all([
    loadCampaignDetail(id),
    campaignAnalytics(id),
    load<EnrollmentRow[]>(
      (db) =>
        db
          .from('xsell_life_campaign_enrollments')
          .select('id, status, current_touch_no, baseline_date')
          .eq('campaign_id', id)
          .order('updated_at', { ascending: false })
          .limit(50),
      [],
    ),
  ])

  if (!detail) notFound()
  const s = detail.settings
  const emailTouches = detail.touches.filter((t) => t.template && t.kind === 'email')
  const smsTouches = detail.touches.filter((t) => t.template && t.kind === 'sms')
  const templated = detail.touches.filter((t) => t.template)

  return (
    <DetailShell
      title={s.name}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE, s.name)}
      status={
        <div className="flex items-center gap-2">
          <CampaignStatusBadge status={s.status} />
          <Badge variant="outline" title="Campaign version">v{s.version}</Badge>
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

        {/* 1 — Operational controls */}
        <CampaignControlsSection engine={ENGINE} status={s.status} simulatedAt={s.simulated_at}>
          <CampaignControls campaignId={s.id} status={s.status} />
        </CampaignControlsSection>

        {/* 2 — Monitoring & health */}
        <Section
          title="Monitoring & health"
          description="Live campaign-health checks. Loaded after the page; if monitoring is unavailable the campaign keeps running on its schedule."
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
          description="Day offsets are authoritative (§6). Cadence tapers to 4- and 2-day intervals for the final touches (days 166–180)."
          acceleratesFromDay={166}
          showPlaybook
        />

        {/* 6 — Message assets */}
        <CampaignAssetsTable
          description="The seeded email and SMS templates. Each must clear the human approval gate before this campaign can dispatch it (ADR-023)."
          groups={[
            {
              title: 'Email templates',
              items: emailTouches.map((t) => ({
                key: String(t.touch_no),
                name: t.template!.name,
                approval_status: t.template!.approval_status,
                body: t.template!.body,
                eyebrow: `#${t.touch_no}`,
              })),
            },
            {
              title: 'SMS templates',
              items: smsTouches.map((t) => ({
                key: String(t.touch_no),
                name: t.template!.name,
                approval_status: t.template!.approval_status,
                body: t.template!.body,
                eyebrow: `#${t.touch_no}`,
              })),
            },
          ]}
        />

        {/* 7 — Workflows & rules */}
        <Section
          title={`AI conversation playbooks (${detail.playbooks.length})`}
          description="Internal scripts the AI conversation engine grounds on. The AI must identify as automated and may never recommend a product, coverage amount, carrier, premium, or replacement (§4.2). Substantive requests escalate to the advisor."
        >
          <div className="space-y-2">
            {detail.playbooks.map((p) => (
              <details key={p.key} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  <span className="text-muted-foreground">Touch #{p.touch_no}</span> — {p.title}
                </summary>
                <div className="mt-3 space-y-3 border-t pt-3 text-sm">
                  <PlaybookField label="Objective" value={p.objective} />
                  <PlaybookField label="Opening" value={p.opening} pre />
                  <PlaybookField label="Allowed (green zone)" value={p.allowed} />
                  <PlaybookField label="Prohibited (red line)" value={p.prohibited} tone="danger" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Escalate on</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.escalateOn.map((e) => (
                        <Badge key={e} variant="outline">{e}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </Section>

        <Section
          title={`Advisor scripts (${detail.advisorScripts.length})`}
          description="Suggested openers for the human advisor-outreach touches. Advisor touches are human tasks — a real logged outreach attempt fulfils the touch (§10)."
        >
          <div className="space-y-2">
            {detail.advisorScripts.map((a) => (
              <details key={a.key} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  <span className="text-muted-foreground">Touch #{a.touch_no}</span> — {a.title}
                </summary>
                <div className="mt-3 space-y-3 border-t pt-3 text-sm">
                  <PlaybookField label="Suggested script" value={a.script} pre />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Goals</p>
                    <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                      {a.goals.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </Section>

        {/* 8 — Campaign overview, configuration & settings */}
        <Section title="Campaign overview" description="Identity, objective, and lifecycle history for this campaign version.">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name" value={s.name} />
            <Field label="Version" value={`v${s.version}`} />
            <Field label="Status" value={campaignStatus(s.status).label} />
            <Field label="Family key" value={s.family_key} mono />
            <Field label="Created by" value={s.created_by ?? '—'} mono />
            <Field label="Created" node={<TimeCell value={s.created_at} />} />
          </dl>
          {s.description && (
            <div className="mt-3 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="mt-1 text-sm">{s.description}</p>
            </div>
          )}
          {s.objective && (
            <div className="mt-3 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Objective</p>
              <p className="mt-1 text-sm">{s.objective}</p>
            </div>
          )}
          {/* Activation history */}
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Activation history</p>
            <ul className="space-y-1 text-sm">
              <HistoryItem label="Simulated" when={s.simulated_at} />
              <HistoryItem label="Activated" when={s.activated_at} />
              <HistoryItem label="Emergency-stopped" when={s.emergency_stopped_at} />
              <HistoryItem label="Archived" when={s.archived_at} />
            </ul>
          </div>
        </Section>

        <Section
          title="Configuration & settings"
          description="Editable operational defaults. Gold-badged values are config defaults to verify (§4.3), not Farmers-published figures."
        >
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Setting label="Message purpose" value={s.purpose ?? '—'} />
            <Setting label="Delegated sender" value={s.delegation_id ? 'Configured' : 'None (FSA is sender)'} />
            <Setting label="Represented agency owner" value={s.represented_agency_owner_id ? 'Set' : '—'} />
            <Setting label="Daily enrollment limit" value={String(s.daily_enrollment_limit)} assumption />
            <Setting label="Re-enrollment cooldown" value={`${s.reenroll_cooldown_days} days`} assumption />
            <Setting label="Resume cooling-off" value={`${s.resume_cooling_off_days} days`} assumption />
            <Setting label="Send on weekends" value={s.send_on_weekends ? 'Yes' : 'No'} assumption />
            <Setting label="Send on holidays" value={s.send_on_holidays ? 'Yes' : 'No'} assumption />
            <Setting label="Advisor task due" value={`${s.advisor_due_hours} hours`} assumption />
            <Setting label="Advisor escalate after" value={`${s.advisor_overdue_escalate_hours} hours`} assumption />
            <Setting label="Advisor reassign after" value={`${s.advisor_reassign_after_hours} hours`} assumption />
            <Setting label="Advisor hold behavior" value={s.advisor_hold_behavior} />
            <Setting label="Conversation timeout" value={`${s.conversation_timeout_hours} hours`} assumption />
            <Setting label="Intent confidence threshold" value={String(s.intent_confidence_threshold)} assumption />
            <Setting label="Resume behavior" value={s.resume_behavior.replace(/_/g, ' ')} assumption />
            <Setting label="Replay policy" value={s.replay_policy.replace(/_/g, ' ')} assumption />
          </dl>
        </Section>

        {/* 9 — Enrollments */}
        <CampaignEnrollmentTable
          engine={ENGINE}
          rows={enrollments.ok ? enrollments.data : null}
          error={!enrollments.ok}
          emptyDescription="Existing agency clients are enrolled by the daily job or manually. Each must be non-securities, opted in, and free of an active life opportunity. Activate the campaign to begin enrolling."
        />

        {/* 10 — Version history (Cross-Sell Life is the only versioned engine) */}
        <Section title={`Version history (${detail.versions.length})`} description="Every version of this campaign family. Only Cross-Sell Life is versioned.">
          {detail.versions.length === 0 ? (
            <EmptyState title="No versions" description="This campaign family has no recorded versions yet." />
          ) : (
            <Table>
              <TableCaption srOnly>
                {`Version history for ${s.family_key} — ${detail.versions.length} versions, with status and creation date.`}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Version</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Created</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.versions.map((v) => (
                  <TableRow key={v.id} className={v.id === s.id ? 'bg-muted/30' : undefined}>
                    <TableCell className="numeric">v{v.version}</TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={v.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <TimeCell value={v.created_at} precision="date" />
                    </TableCell>
                    <TableCell>
                      {v.id === s.id ? (
                        <span className="text-xs text-muted-foreground">Viewing</span>
                      ) : (
                        <Link
                          href={campaignDetailHref(ENGINE, v.id)}
                          className="text-sm text-primary underline-offset-4 hover:underline"
                        >
                          Open v{v.version}
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <p className="text-sm">
          <Link href={ENGINE.href} className="text-primary underline-offset-4 hover:underline">
            ← Back to {ENGINE.title}
          </Link>
        </p>
      </div>
    </DetailShell>
  )
}




function Field({ label, value, node, mono }: { label: string; value?: string; node?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-sm font-medium ${mono ? 'break-all font-mono text-xs' : ''}`}>{node ?? value}</dd>
    </div>
  )
}

function Setting({ label, value, assumption }: { label: string; value: string; assumption?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        {label}
        {assumption && <AssumptionBadge />}
      </dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  )
}

function HistoryItem({ label, when }: { label: string; when: string | null }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{when ? <TimeCell value={when} /> : 'Not yet'}</span>
    </li>
  )
}


function PlaybookField({ label, value, pre, tone }: { label: string; value: string; pre?: boolean; tone?: 'danger' }) {
  return (
    <div>
      <p className={`text-xs font-medium ${tone === 'danger' ? 'text-destructive' : 'text-muted-foreground'}`}>{label}</p>
      {pre ? (
        <pre className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{value}</pre>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{value}</p>
      )}
    </div>
  )
}
