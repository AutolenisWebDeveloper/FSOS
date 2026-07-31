import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { loadCampaignDetail } from '@/lib/life-campaign/detail'
import { campaignAnalytics } from '@/lib/life-campaign/analytics'
import { CampaignControls } from '../campaign-controls'

export const dynamic = 'force-dynamic'

// Life Conversion Campaign — full detail (drill-down). One place for the complete
// configuration, the 20-touch schedule, the message assets, the workflow rules, live
// analytics, settings, and operational controls (§4b/§5/§14/§15).

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default', paused: 'secondary', disabled: 'secondary',
  emergency_stopped: 'destructive', archived: 'outline', draft: 'outline', approval_pending: 'secondary',
}

const KIND_LABEL: Record<string, string> = {
  email: 'Email', sms: 'SMS', ai_conversation: 'AI conversation', advisor_outreach: 'Advisor outreach',
}
const KIND_TONE: Record<string, 'default' | 'secondary' | 'outline'> = {
  email: 'default', sms: 'secondary', ai_conversation: 'outline', advisor_outreach: 'outline',
}

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

  return (
    <DetailShell
      title={s.name}
      description="180-day, 20-touch multi-channel term-conversion review campaign. Every send passes the compliance gate; eligibility is rechecked before every touch."
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Comms', href: '/app/comms' },
        { label: 'Life Conversion', href: '/app/comms/life-conversion' },
        { label: s.name },
      ]}
      status={
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_TONE[s.status] ?? 'outline'}>{s.status.replace(/_/g, ' ')}</Badge>
          {s.is_assumption && <AssumptionBadge />}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Operational controls (§4b) */}
        <Section title="Operational controls" hint="Enable, pause, resume, disable, emergency-stop, archive. Restricted to ops/admin; every action is audit-logged.">
          <CampaignControls campaignId={s.id} status={s.status} />
          {!s.simulated_at && s.status !== 'active' && (
            <p className="mt-3 text-xs text-muted-foreground">A read-only simulation is recommended before activation (ADR-021).</p>
          )}
        </Section>

        {/* Analytics (§15) */}
        <Section title="Analytics" hint="Live enrollment, touch, and advisor-outreach metrics.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Active enrollments" value={analytics?.active ?? 0} tone="brand" />
            <StatTile label="Completed (Day 180)" value={analytics?.completed ?? 0} />
            <StatTile label="Exited / suppressed" value={analytics?.exited ?? 0} />
            <StatTile label="Message touches sent" value={analytics?.touches.sent ?? 0} hint="Through the compliance gate" />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <MiniPanel title="Phase distribution (active)">
              <Cell label="Early (Day 1–47)" value={analytics?.byPhase.early ?? 0} />
              <Cell label="Mid (Day 48–134)" value={analytics?.byPhase.mid ?? 0} />
              <Cell label="Accelerated (135–180)" value={analytics?.byPhase.accelerated ?? 0} />
            </MiniPanel>
            <MiniPanel title="Advisor outreach (§9a)">
              <Cell label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
              <Cell label="Overdue" value={analytics?.advisor.overdue ?? 0} attention />
              <Cell label="Missed" value={analytics?.advisor.missed ?? 0} />
            </MiniPanel>
          </div>
        </Section>

        {/* Schedule (§5) */}
        <Section title="Schedule — 20 touches over 180 days" hint="Day offsets are authoritative (§5). The final 45 days accelerate and alternate channels.">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Template / status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.touches.map((t) => (
                  <TableRow key={t.touch_no} className={t.day_offset >= 135 ? 'bg-muted/30' : undefined}>
                    <TableCell className="tabular-nums text-muted-foreground">{t.touch_no}</TableCell>
                    <TableCell className="tabular-nums">Day {t.day_offset}</TableCell>
                    <TableCell><Badge variant={KIND_TONE[t.kind] ?? 'outline'}>{KIND_LABEL[t.kind] ?? t.kind}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{t.asset_label ?? '—'}</TableCell>
                    <TableCell>
                      {t.template ? (
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{t.template.name.replace('Life Conversion — ', '')}</span>
                          <Badge variant={t.template.approval_status === 'approved' ? 'default' : 'outline'}>{t.template.approval_status}</Badge>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Advisor task (no template)</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        {/* Assets (§14) */}
        <Section title="Message assets" hint="The finalized §14 copy. Seeded as DRAFT templates — each must pass the human approval gate before the campaign can dispatch it (ADR-023).">
          <div className="space-y-2">
            {detail.touches.filter((t) => t.template).map((t) => (
              <details key={t.touch_no} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  <span className="text-muted-foreground">#{t.touch_no} · {KIND_LABEL[t.kind]}</span> — {t.template!.name.replace('Life Conversion — ', '')}
                  <Badge variant={t.template!.approval_status === 'approved' ? 'default' : 'outline'} className="ml-2">{t.template!.approval_status}</Badge>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap border-t pt-3 text-xs leading-relaxed text-muted-foreground">{t.template!.body}</pre>
              </details>
            ))}
          </div>
        </Section>

        {/* Workflows (§6/§9a/§13) */}
        <Section title="Workflows & rules" hint="How the campaign behaves — grounded in this campaign's actual settings.">
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
        </Section>

        {/* Settings (§4b, §4.3) */}
        <Section title="Configuration & settings" hint="Editable operational defaults. Gold-badged values are config defaults to verify (§4.3), not Farmers-published figures.">
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
            <Setting label="Created" value={new Date(s.created_at).toLocaleDateString()} />
          </dl>
        </Section>

        {/* Enrollments (§15) */}
        <Section title={`Enrollments (${enrollments.ok ? enrollments.data.length : 0})`}>
          {!enrollments.ok ? (
            <ErrorState description="Could not load enrollments." />
          ) : enrollments.data.length === 0 ? (
            <EmptyState title="No enrollments yet" description="Eligible term-conversion contacts are enrolled by the daily job or manually; each must have a verified deadline and no active opportunity." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Status</TableHead><TableHead>Touch</TableHead><TableHead>Baseline</TableHead><TableHead>Conversion deadline</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments.data.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell><Badge variant={e.status === 'active' ? 'default' : 'outline'}>{e.status.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{e.current_touch_no} / 20</TableCell>
                      <TableCell className="text-muted-foreground">{e.baseline_date}</TableCell>
                      <TableCell className="text-muted-foreground">{e.conversion_deadline ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <p className="text-sm">
          <Link href="/app/comms/life-conversion" className="text-primary underline-offset-4 hover:underline">← Back to campaigns</Link>
        </p>
      </div>
    </DetailShell>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-1 mb-3 text-xs text-muted-foreground">{hint}</p>}
      {!hint && <div className="mb-3" />}
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

function Cell({ label, value, attention }: { label: string; value: number; attention?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${attention && value > 0 ? 'border-amber-400/60' : ''}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
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

function Setting({ label, value, assumption }: { label: string; value: string; assumption?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">{label}{assumption && <AssumptionBadge />}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  )
}
