import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { loadCampaignDetail } from '@/lib/cross-sell-life/detail'
import { campaignAnalytics } from '@/lib/cross-sell-life/analytics'
import { CampaignControls } from './controls'
import { CampaignHealthPanel } from '@/components/app/CampaignHealthPanel'
import { TimeCell } from '@/components/ui/time'
import { CAMPAIGN_ENGINES, CAMPAIGN_ENGINE_LIST, campaignBreadcrumb, campaignStatus } from '@/lib/comms/campaign-presentation'
import {
  CampaignStatusBadge,
  EnrollmentStatusBadge,
  TouchKindBadge,
  ApprovalBadge,
  CampaignStat,
  FunnelStat,
  CampaignCrossLinks,
} from '@/components/comms/campaign/CampaignKit'

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
        {/* ── Campaign Overview ─────────────────────────────────────────────── */}
        <Section title="Campaign overview" hint="Identity, objective, and lifecycle history for this campaign version.">
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

        {/* ── Operational Controls ──────────────────────────────────────────── */}
        <Section
          title="Operational controls"
          hint="Enable, pause, resume, disable, emergency-stop, archive, and new-version. Restricted to ops/admin; every action is audit-logged. Emergency Stop and Archive confirm first."
        >
          <CampaignControls campaignId={s.id} status={s.status} />
          {!s.simulated_at && s.status !== 'active' && (
            <p className="mt-3 text-xs text-muted-foreground">A read-only simulation is recommended before activation (ADR-021).</p>
          )}
        </Section>

        {/* ── Analytics & Monitoring ────────────────────────────────────────── */}
        <Section title="Analytics" hint="Live enrollment, conversion, channel, and advisor-outreach metrics (§19).">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Enrolled (all-time)" value={analytics?.funnel.enrolled ?? 0} />
            <StatTile label="Active enrollments" value={analytics?.totals.active ?? 0} tone="brand" />
            <StatTile label="Completed (Day 180)" value={analytics?.totals.completed ?? 0} />
            <StatTile label="Opt-outs" value={analytics?.funnel.optOuts ?? 0} hint="STOP / unsubscribe / suppression" tone="attention" />
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Conversion funnel (enrolled → issued)</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <FunnelStat label="Enrolled" value={analytics?.funnel.enrolled ?? 0} />
              <FunnelStat label="Appointment" value={analytics?.funnel.appointments ?? 0} rate={analytics?.rates.enrollToAppointment} rateLabel="of enrolled" />
              <FunnelStat label="Quote" value={analytics?.funnel.quotes ?? 0} rate={analytics?.rates.appointmentToQuote} rateLabel="of appts" />
              <FunnelStat label="Application" value={analytics?.funnel.applications ?? 0} rate={analytics?.rates.quoteToApplication} rateLabel="of quotes" />
              <FunnelStat label="Issued" value={analytics?.funnel.issued ?? 0} rate={analytics?.rates.applicationToIssued} rateLabel="of apps" tone="brand" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Overall enrolled → issued: <span className="font-medium tabular-nums">{analytics?.rates.overall ?? 0}%</span>.
            </p>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <MiniPanel title="Channel sends (through the compliance gate)">
              <CampaignStat label="Email" value={analytics?.channels.email ?? 0} />
              <CampaignStat label="SMS" value={analytics?.channels.sms ?? 0} />
              <CampaignStat label="AI" value={analytics?.channels.ai ?? 0} />
            </MiniPanel>
            <MiniPanel title="Advisor outreach">
              <CampaignStat label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
              <CampaignStat label="Overdue" value={analytics?.advisor.overdue ?? 0} attentionWhenNonZero />
              <CampaignStat label="Missed" value={analytics?.advisor.missed ?? 0} />
            </MiniPanel>
          </div>
        </Section>

        <Section title="Monitoring & health" hint="Live campaign-health checks. Loaded client-side; if monitoring is unavailable the campaign keeps running on its schedule.">
          <CampaignHealthPanel endpoint="/api/cross-sell-life" />
        </Section>

        {/* ── Campaign Schedule ─────────────────────────────────────────────── */}
        <Section
          title="Schedule — 35 touches over 180 days"
          hint="Day offsets are authoritative (§6). Cadence tapers to 4- and 2-day intervals for the final touches (days 166–180)."
        >
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="w-12">#</TableHead>
                  <TableHead scope="col">Day</TableHead>
                  <TableHead scope="col">Channel</TableHead>
                  <TableHead scope="col">Asset</TableHead>
                  <TableHead scope="col">Template / approval</TableHead>
                  <TableHead scope="col">Playbook</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.touches.map((t) => (
                  <TableRow key={t.touch_no} className={t.day_offset >= 166 ? 'bg-muted/30' : undefined}>
                    <TableCell className="tabular-nums text-muted-foreground">{t.touch_no}</TableCell>
                    <TableCell className="tabular-nums">Day {t.day_offset}</TableCell>
                    <TableCell>
                      <TouchKindBadge kind={t.kind} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.asset_label ?? '—'}</TableCell>
                    <TableCell>
                      {t.template ? (
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{t.template.name}</span>
                          <ApprovalBadge status={t.template.approval_status} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Advisor task (no template)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.playbook_key ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        {/* ── Campaign Assets ───────────────────────────────────────────────── */}
        <Section
          title="Message assets — email & SMS templates"
          hint="The 12 email + 12 SMS templates. Seeded as DRAFT and each must pass the human approval gate before the campaign can dispatch it (ADR-023)."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <AssetColumn heading={`Email templates (${emailTouches.length})`} touches={emailTouches} />
            <AssetColumn heading={`SMS templates (${smsTouches.length})`} touches={smsTouches} />
          </div>
        </Section>

        <Section
          title={`AI conversation playbooks (${detail.playbooks.length})`}
          hint="Internal scripts the AI conversation engine grounds on. The AI must identify as automated and may never recommend a product, coverage amount, carrier, premium, or replacement (§4.2). Substantive requests escalate to the advisor."
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
          hint="Suggested openers for the human advisor-outreach touches. Advisor touches are human tasks — a real logged outreach attempt fulfils the touch (§10)."
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

        {/* ── Configuration & Settings ──────────────────────────────────────── */}
        <Section
          title="Configuration & settings"
          hint="Editable operational defaults. Gold-badged values are config defaults to verify (§4.3), not Farmers-published figures."
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

        {/* ── Enrollments ───────────────────────────────────────────────────── */}
        <Section title={`Enrollments (${enrollments.ok ? enrollments.data.length : 0})`}>
          {!enrollments.ok ? (
            <ErrorState description="Could not load enrollments." />
          ) : enrollments.data.length === 0 ? (
            <EmptyState
              title="No enrollments yet"
              description="Existing agency clients are enrolled by the daily job or manually; each must be non-securities, opted-in, and free of an active life opportunity. Activate the campaign to begin enrolling."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Touch</TableHead>
                    <TableHead scope="col">Baseline</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments.data.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <EnrollmentStatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{e.current_touch_no} / {ENGINE.touches}</TableCell>
                      <TableCell className="text-muted-foreground">{e.baseline_date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        {/* ── Version History ───────────────────────────────────────────────── */}
        <Section title={`Version history (${detail.versions.length})`} hint="Every version of this campaign family (§ Audit & Version History).">
          {detail.versions.length === 0 ? (
            <EmptyState title="No versions" description="This campaign family has no recorded versions yet." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Version</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Created</TableHead>
                    <TableHead scope="col"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.versions.map((v) => (
                    <TableRow key={v.id} className={v.id === s.id ? 'bg-muted/30' : undefined}>
                      <TableCell className="tabular-nums">v{v.version}</TableCell>
                      <TableCell>
                        <CampaignStatusBadge status={v.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground"><TimeCell value={v.created_at} precision="date" /></TableCell>
                      <TableCell>
                        {v.id === s.id ? (
                          <span className="text-xs text-muted-foreground">Viewing</span>
                        ) : (
                          <Link href={`/app/comms/cross-sell-life/${v.id}`} className="text-primary text-sm underline-offset-4 hover:underline">
                            Open →
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <p className="text-sm">
          <Link href="/app/comms/cross-sell-life" className="text-primary underline-offset-4 hover:underline">
            ← Back to campaigns
          </Link>
        </p>
      </div>
    </DetailShell>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint ? <p className="mt-1 mb-3 text-xs text-muted-foreground">{hint}</p> : <div className="mb-3" />}
      {children}
    </Card>
  )
}

function MiniPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="grid grid-cols-3 gap-3 text-center">{children}</div>
    </div>
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

function AssetColumn({ heading, touches }: { heading: string; touches: { touch_no: number; kind: string; template: { name: string; approval_status: string; body: string } | null }[] }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{heading}</p>
      {touches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates seeded yet.</p>
      ) : (
        <div className="space-y-2">
          {touches.map((t) => (
            <details key={t.touch_no} className="rounded-md border p-2.5">
              <summary className="cursor-pointer text-sm font-medium">
                <span className="text-muted-foreground">#{t.touch_no}</span> — {t.template!.name}
                <Badge variant={t.template!.approval_status === 'approved' ? 'default' : 'outline'} className="ml-2">
                  {t.template!.approval_status}
                </Badge>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap border-t pt-2 text-xs leading-relaxed text-muted-foreground">{t.template!.body}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
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
