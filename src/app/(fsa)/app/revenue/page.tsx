import { DollarSign, Scale, TrendingUp, Layers, CalendarCheck, AlertTriangle, Wallet, ShieldAlert, Users, Target } from 'lucide-react'
import { DashboardShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Panel, MetricGrid, MetricCard, MiniStat, FunnelChart, BarList, type FunnelStage, type BarItem } from '@/components/dashboards'
import { load, loadAll } from '@/lib/data/query'
import { money } from '@/lib/dashboards/format'
import {
  revenueSummary,
  revenueBySource,
  pipelineByStage,
  conversionFunnel,
  revenueAtRisk,
  attributionQuality,
  dataQualityWarnings,
  type OppRow,
} from '@/lib/revenue/center'
import {
  weightedPipeline,
  runRate,
  normalizeProbabilities,
  stageLabel,
  type OpenOpp,
  type MonthPoint,
} from '@/lib/analytics/forecast'
import { appointmentFunnel, type Appointment } from '@/lib/appointments/recovery'

export const dynamic = 'force-dynamic'

interface ForecastSettings {
  probabilities: unknown
  horizon_months: number | null
  is_assumption: boolean | null
}
interface CommissionMonthRow {
  month: string
  is_security: boolean
  fsa_amount: number | null
}
interface WorkforceRow {
  sent: number
  engaged: number
  escalated: number
  blocked: number
}

// AI Revenue Command Center — Revenue Center (§21). The one net-new top-level page: a
// COMPOSED read-only view over existing data (opportunities + source tags, the forecast
// math, reconciled commissions, the appointment funnel, the workforce). It never holds a
// revenue source of truth and never presents an estimate as earned — Actual / Weighted /
// Expected / Projected / Potential are labeled distinctly, securities are separated
// (firewall), and data-quality gaps are surfaced, not hidden.
export default async function RevenueCenterPage() {
  const [oppsRes, settingsRes, monthsRes, apptsRes, workforceRes] = await Promise.all([
    loadAll<OppRow>(
      (db) =>
        db
          .from('opportunities')
          .select('id, stage, is_security, source, premium, expected_commission, actual_commission, household_id, contact_id, updated_at')
          .is('deleted_at', null),
      { pageSize: 1000 },
    ),
    load<ForecastSettings | null>(
      (db) => db.from('forecast_settings').select('probabilities, horizon_months, is_assumption').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      null,
    ),
    load<CommissionMonthRow[]>(
      (db) => db.from('v_commission_monthly').select('month, is_security, fsa_amount').order('month', { ascending: true }),
      [],
    ),
    load<Appointment[]>(
      (db) => db.from('appointments').select('id, household_id, opportunity_id, scheduled_at, status'),
      [],
    ),
    load<WorkforceRow[]>((db) => db.from('v_workforce_today').select('sent, engaged, escalated, blocked'), []),
  ])

  if (!oppsRes.ok) {
    return (
      <DashboardShell title="Revenue Center">
        {oppsRes.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set the Supabase environment variables to compose the Revenue Center." />
        ) : (
          <ErrorState description={oppsRes.message} />
        )}
      </DashboardShell>
    )
  }

  const opps = oppsRes.data
  const now = new Date()

  // ── Composed revenue model ────────────────────────────────────────────────
  const summary = revenueSummary(opps)
  const bySource = revenueBySource(opps)
  const pipeline = pipelineByStage(opps)
  const funnel = conversionFunnel(opps)
  const atRisk = revenueAtRisk(opps, now)
  const attribution = attributionQuality(opps)
  const warnings = dataQualityWarnings(opps)

  // Weighted pipeline (Expected × stage probability) — reuse the forecast math.
  const probabilities = normalizeProbabilities(settingsRes.ok && settingsRes.data ? settingsRes.data.probabilities : undefined)
  const horizon = (settingsRes.ok && settingsRes.data?.horizon_months) || 3
  const isAssumption = !settingsRes.ok || settingsRes.data?.is_assumption !== false
  const openOpps: OpenOpp[] = opps
    .filter((o) => o.stage !== 'placed_issued' && o.stage !== 'lost')
    .map((o) => ({ stage: o.stage, expected_commission: o.expected_commission, is_security: o.is_security }))
  const weighted = weightedPipeline(openOpps, probabilities)

  // Actual (received, reconciled) + projected run-rate — non-securities only.
  const months = monthsRes.ok ? monthsRes.data : []
  const actualReceived = months.filter((m) => !m.is_security).reduce((a, m) => a + (Number(m.fsa_amount) || 0), 0)
  const history: MonthPoint[] = months.filter((m) => !m.is_security).map((m) => ({ month: m.month, fsa_amount: Number(m.fsa_amount) || 0 }))
  const projected = runRate(history, horizon).projected_total

  // Appointment funnel (slice 5) + workforce activity today.
  const apptFunnel = appointmentFunnel(apptsRes.ok ? apptsRes.data : [])
  const wf = (workforceRes.ok ? workforceRes.data : []).reduce(
    (a, r) => ({ sent: a.sent + (r.sent || 0), engaged: a.engaged + (r.engaged || 0), escalated: a.escalated + (r.escalated || 0), blocked: a.blocked + (r.blocked || 0) }),
    { sent: 0, engaged: 0, escalated: 0, blocked: 0 },
  )

  const sourceBars: BarItem[] = bySource.map((s) => ({
    label: s.label,
    value: s.expected + s.actual,
    meta: `${s.openCount} open · ${s.wonCount} won`,
    tone: s.source === 'unattributed' ? 'attention' : 'brand',
  }))
  const funnelStages: FunnelStage[] = funnel.map((f, i) => ({
    label: stageLabel(f.stage),
    value: f.count,
    tone: i === funnel.length - 1 ? 'positive' : 'brand',
  }))

  return (
    <DashboardShell
      title="Revenue Center"
      description="A composed view of the whole revenue picture — actual, weighted, expected, and projected — attributed to the workflows the AI workforce runs. Read-only; no figure here is a source of truth."
    >
      {/* Revenue distinction — each type labeled, securities separated (§21) */}
      <MetricCard label="Actual (received)" value={money(actualReceived)} icon={Wallet} tone="positive" hint="Reconciled FSA commission" />
      <MetricCard label="Weighted pipeline" value={money(weighted.total_weighted)} icon={Scale} tone="brand" hint="Expected × stage probability" delta={isAssumption ? <AssumptionBadge /> : undefined} />
      <MetricCard label="Expected (open)" value={money(summary.expectedOpen)} icon={Target} tone="neutral" hint={`${summary.openCount} open opportunities`} />
      <MetricCard label={`Projected (${horizon} mo run-rate)`} value={money(projected)} icon={TrendingUp} tone="neutral" hint="From trailing actuals" delta={<AssumptionBadge />} />

      {/* Securities tracked separately + won */}
      <div className="sm:col-span-2 lg:col-span-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Won (placed)" value={summary.wonCount} tone="positive" />
        <MiniStat label="Actual on won" value={money(summary.actualWon)} tone="positive" />
        <MiniStat label="Lost" value={summary.lostCount} tone="critical" />
        <MiniStat label="Securities pipeline (tracked)" value={money(summary.expectedSecurities)} tone="security" />
      </div>

      {/* Revenue by workflow — the payoff of the origination slices */}
      <div className="sm:col-span-2 lg:col-span-2">
        <Panel title="Revenue by workflow" description="Expected + actual commission, attributed to origination source" icon={Layers}>
          {sourceBars.length === 0 ? (
            <EmptyState title="No attributed revenue yet" description="Originate cross-sell, win-back, or term-conversion opportunities to populate this." />
          ) : (
            <BarList items={sourceBars} format={(n) => money(n)} />
          )}
        </Panel>
      </div>

      {/* Conversion funnel */}
      <div className="sm:col-span-2 lg:col-span-2">
        <Panel title="Conversion funnel" description="Opportunities at or past each pipeline stage" icon={Target}>
          <FunnelChart stages={funnelStages} valueLabel="opps" />
        </Panel>
      </div>

      {/* Pipeline by stage */}
      <div className="sm:col-span-2 lg:col-span-2">
        <Panel title="Open pipeline by stage" description="Non-securities open opportunities and expected commission" icon={Scale}>
          <BarList
            items={pipeline.map((b) => ({ label: stageLabel(b.stage), value: b.expected, meta: `${b.count} open` }))}
            format={(n) => money(n)}
            emptyLabel="No open pipeline"
          />
        </Panel>
      </div>

      {/* Appointment funnel (slice 5) + workforce activity */}
      <div className="sm:col-span-2 lg:col-span-2">
        <Panel title="Appointments & workforce" description="Meeting funnel and today's AI workforce activity" icon={CalendarCheck}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Held" value={apptFunnel.completed} tone="positive" />
            <MiniStat label="No-shows" value={apptFunnel.noShow} tone={apptFunnel.noShow > 0 ? 'attention' : 'neutral'} />
            <MiniStat label="Show rate" value={`${apptFunnel.showRate}%`} tone="brand" />
            <MiniStat label="Scheduled" value={apptFunnel.scheduled} tone="neutral" />
            <MiniStat label="Sent today" value={wf.sent} tone="brand" />
            <MiniStat label="Engaged" value={wf.engaged} tone="positive" />
            <MiniStat label="Escalated" value={wf.escalated} tone="attention" />
            <MiniStat label="Blocked" value={wf.blocked} tone="critical" />
          </div>
        </Panel>
      </div>

      {/* Revenue at risk */}
      <div className="sm:col-span-2 lg:col-span-2">
        <Panel title="Revenue at risk" description="Stalled (no movement in 30 days) and lost expected commission" icon={AlertTriangle} tone="attention">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Stalled opps" value={atRisk.stalledCount} tone="attention" />
            <MiniStat label="Stalled expected" value={money(atRisk.stalledExpected)} tone="attention" />
            <MiniStat label="Lost opps" value={atRisk.lostCount} tone="critical" />
            <MiniStat label="Lost expected" value={money(atRisk.lostExpected)} tone="critical" />
          </div>
        </Panel>
      </div>

      {/* Attribution + data-quality (surfaced, never hidden) */}
      <div className="sm:col-span-2 lg:col-span-2">
        <Panel title="Attribution & data quality" description="How well the book is attributed and priced" icon={ShieldAlert}>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Attributed (has source)" value={`${attribution.sourcePct}%`} tone="brand" />
            <MiniStat label="Priced (has value)" value={`${attribution.revenuePct}%`} tone="brand" />
          </div>
          {warnings.length > 0 ? (
            <ul className="mt-4 space-y-2 text-sm">
              {warnings.map((w) => (
                <li key={w.kind} className="flex items-start gap-2 text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-assumption" aria-hidden />
                  <span>
                    <span className="font-medium text-foreground">{w.count.toLocaleString()}</span> {w.note}.
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No data-quality gaps — every opportunity is attributed, priced, and identity-resolved.</p>
          )}
        </Panel>
      </div>
    </DashboardShell>
  )
}
