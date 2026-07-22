import Link from 'next/link'
import {
  Repeat,
  Clock,
  CalendarClock,
  CalendarCheck,
  DollarSign,
  Landmark,
  Layers,
  Building2,
  Sparkles,
  Activity as ActivityIcon,
  Send,
  ArrowRight,
} from 'lucide-react'
import { PageHeader, Section, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { SecuritiesChip } from '@/components/ui/securities'
import {
  Panel,
  PanelLink,
  MetricCard,
  MetricGrid,
  MiniStat,
  FunnelChart,
  BarList,
  Leaderboard,
  HeatGrid,
  ActivityFeed,
  QueueList,
  type FeedItem,
} from '@/components/dashboards'
import { money, timeAgo, humanize } from '@/lib/dashboards/format'
import { loadConversionsDashboard, type ConversionDue } from '@/lib/dashboards/conversions'
import { load } from '@/lib/data/query'
import { OriginateTermConversionButton } from '@/components/app/OriginateTermConversionButton'

// Open (non-terminal) opportunity stages — a conversion opportunity is "live" here.
const OPEN_OPP_STAGES = ['prospect', 'fact_find', 'quoted_proposed', 'application', 'underwriting_suitability']

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-07 Life Conversion Command Center (A1). Detect approaching term-to-permanent
// conversion windows across the own-book and invite to a review — educational only,
// never product-specific (guardrail §2.2). Conversion windows are editable config
// defaults (§2.3); securities-flagged policies are shown but excluded from every
// automated figure (firewall §2.1). All data is live; nothing is rebuilt.
export default async function ConversionsPage() {
  const [res, oppRes] = await Promise.all([
    loadConversionsDashboard(),
    // Open term-conversion opportunities originated from due windows (mig 047).
    load<{ id: string }[]>(
      (db) =>
        db
          .from('opportunities')
          .select('id')
          .eq('source', 'term_conversion')
          .is('deleted_at', null)
          .in('stage', OPEN_OPP_STAGES)
          .limit(1000),
      [],
    ),
  ])
  const openOpportunities = oppRes.ok ? oppRes.data.length : 0

  const actions = (
    <div className="hidden flex-wrap gap-2 sm:flex">
      <Button asChild variant="outline" size="sm"><Link href="/app/conversions/eligible">Eligible list</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href="/app/conversions/timeline">Timeline</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href="/app/conversions/monitoring">Monitoring</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href="/app/conversions/import">Import list</Link></Button>
      <OriginateTermConversionButton />
    </div>
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'Production Operations' }, { label: 'Life Conversion' }]

  if (!res.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Life Conversion" description="Term-to-permanent conversion windows across the own-book." breadcrumb={breadcrumb} actions={actions} />
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </div>
    )
  }

  const { kpis, rows, activities, householdName } = res.data
  const now = Date.now()

  const funnel = [
    { label: 'Eligible policies', value: kpis.eligible, href: '/app/conversions/eligible', tone: 'brand' as const },
    { label: 'Policies contacted', value: kpis.contacted, tone: 'brand' as const },
    { label: 'Educated / invited', value: kpis.educated, tone: 'positive' as const },
    { label: 'Reviews scheduled', value: kpis.reviewsScheduled, href: '/app/reviews', tone: 'positive' as const },
    { label: 'Converted', value: kpis.converted, tone: 'positive' as const },
  ]

  const tierTone = (tier: string) => (tier === '30' ? 'critical' : tier === '90' ? 'attention' : 'brand')
  const timeline = res.data.tierDistribution.map((t) => ({
    label: t.label,
    value: t.value,
    href: `/app/conversions/eligible?tier=${t.tier}`,
    tone: tierTone(t.tier) as 'critical' | 'attention' | 'brand',
    meta: undefined,
  }))

  // Priority follow-up: soonest-expiring eligible policies (non-security by construction).
  const queue = [...rows]
    .filter((r) => r.days_remaining != null)
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
    .slice(0, 6)
    .map((r) => ({
      id: r.policy_id,
      title: r.primary_name ?? householdName.get(r.household_id ?? '') ?? 'Policyholder',
      subtitle: `Policy ${r.policy_number ?? '—'} · window closes in ${r.days_remaining}d`,
      href: `/app/conversions/${r.policy_id}`,
      right: <Numeric className="text-sm font-semibold">{r.days_remaining}d</Numeric>,
      tone: (r.urgency_tier === '30' ? 'critical' : 'attention') as 'critical' | 'attention',
    }))

  const feed: FeedItem[] = activities.slice(0, 8).map((a) => {
    const verb = a.kind ? a.kind.replace('conversion_', '') : 'activity'
    return {
      id: a.id,
      icon: verb === 'schedule' ? CalendarCheck : verb === 'escalate' ? Sparkles : Send,
      title: (
        <span>
          <span className="font-medium capitalize">{humanize(verb)}</span>
          {a.note ? <span className="text-muted-foreground"> — {a.note}</span> : null}
        </span>
      ),
      meta: 'Term-conversion outreach',
      time: timeAgo(a.created_at, now),
      href: a.entity_id ? `/app/conversions/${a.entity_id}` : undefined,
      tone: verb === 'escalate' ? 'security' : verb === 'schedule' ? 'positive' : 'brand',
    }
  })

  return (
    <div className="space-y-7">
      <PageHeader
        title="Life Conversion"
        description="Term-to-permanent opportunities across the own-book. Detect approaching conversion windows and invite to a review — educational only, never product-specific."
        breadcrumb={breadcrumb}
        actions={actions}
      />

      {/* Guardrail framing — config-default windows + securities firewall. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm">
        <AssumptionBadge />
        <span className="text-muted-foreground">
          Conversion windows are config defaults — verify against the FNWL / ICC25-FTL contract.
        </span>
        {kpis.securityCount > 0 ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <SecuritiesChip />
            {kpis.securityCount} securities-flagged {kpis.securityCount === 1 ? 'policy' : 'policies'} excluded from automation.
          </span>
        ) : null}
      </div>

      {/* ── Executive KPIs ─────────────────────────────────────────────────── */}
      <MetricGrid>
        <MetricCard label="Eligible policies" value={kpis.eligible.toLocaleString()} href="/app/conversions/eligible" icon={Repeat} tone="brand" hint="In an open window" />
        <MetricCard label="≤ 30 days" value={kpis.urgent30.toLocaleString()} href="/app/conversions/eligible?tier=30" icon={Clock} tone="attention" hint="Urgent — window closing" />
        <MetricCard label="≤ 90 days" value={kpis.within90.toLocaleString()} href="/app/conversions/eligible?tier=90" icon={CalendarClock} tone="neutral" hint="Upcoming expirations" />
        <MetricCard label="Reviews scheduled" value={kpis.reviewsScheduled.toLocaleString()} href="/app/reviews" icon={CalendarCheck} tone="positive" hint={`${kpis.conversionRate}% of eligible`} />
        <MetricCard label="Conversion opportunities" value={openOpportunities.toLocaleString()} href="/app/opportunities" icon={Layers} tone="brand" hint="Open in the pipeline" />
        <MetricCard
          label="Est. added premium"
          value={money(kpis.estAddedPremium)}
          icon={DollarSign}
          tone="neutral"
          hint="Assumption-based estimate"
          delta={<AssumptionBadge />}
        />
      </MetricGrid>

      {/* ── Funnel + window timeline ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Conversion funnel"
          description="Detect → invite → review → convert. Educational only."
          icon={Layers}
          className="lg:col-span-7"
          action={<PanelLink href="/app/conversions/analytics">Analytics</PanelLink>}
        >
          <FunnelChart stages={funnel} valueLabel="policies" />
        </Panel>
        <Panel
          title="Expiration timeline"
          description="Eligible policies by window"
          icon={CalendarClock}
          className="lg:col-span-5"
          action={<PanelLink href="/app/conversions/timeline">Timeline</PanelLink>}
        >
          <BarList items={timeline} emptyLabel="No policies in an open window." />
        </Panel>
      </div>

      {/* ── Agency performance + heat map ──────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Agency performance" description="Conversion opportunities by book" icon={Building2} className="lg:col-span-5">
          <Leaderboard
            rows={res.data.agencyLeaderboard.map((a) => ({ name: a.name, value: a.opportunities, href: '/app/conversions/eligible' }))}
            emptyLabel="No agency-linked windows yet."
          />
        </Panel>
        <Panel
          title="Opportunity heat map"
          description="Agencies × window urgency"
          icon={Repeat}
          className="lg:col-span-7"
          bodyClassName="p-4"
        >
          <HeatGrid columns={res.data.heat.tiers} rows={res.data.heat.agencies} cells={res.data.heat.cells.map((row) => row.map((v) => ({ value: v, title: `${v} policies` })))} tone="brand" />
        </Panel>
      </div>

      {/* ── Eligible policies + right rail ─────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Soonest windows"
          description="Eligible policies by days remaining"
          icon={Clock}
          className="lg:col-span-8"
          bodyClassName="p-0"
          action={<PanelLink href="/app/conversions/eligible">All eligible</PanelLink>}
        >
          <SoonestWindowsTable rows={rows} householdName={householdName} />
        </Panel>

        <div className="space-y-4 lg:col-span-4">
          <Panel title="Follow-up queue" description="Closing windows first" icon={CalendarCheck} tone="attention">
            <QueueList items={queue} emptyLabel="No windows closing soon." />
          </Panel>
          <Panel title="Compliance & firewall" description="Securities excluded from automation" icon={Landmark} tone="security">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="FFS-managed" value={kpis.securityCount.toLocaleString()} tone="security" />
              <MiniStat label="Automatable" value={kpis.eligible.toLocaleString()} tone="brand" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Securities-flagged policies are routed to the human FSA / FFS and never receive automated educational sends.
            </p>
            <Link href="/app/compliance/firewall" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Firewall <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Panel>
          <Panel title="AI outreach" description="Green-zone, gated" icon={Sparkles}>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Contacted" value={kpis.contacted.toLocaleString()} tone="brand" />
              <MiniStat label="Educated" value={kpis.educated.toLocaleString()} tone="positive" />
              <MiniStat label="Converted" value={kpis.converted.toLocaleString()} tone="positive" />
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Activity feed ──────────────────────────────────────────────────── */}
      <Section title="Recent activity" action={<PanelLink href="/app/conversions/monitoring">Monitoring</PanelLink>}>
        <Panel title="Conversion outreach log" icon={ActivityIcon} bodyClassName="pt-2">
          <ActivityFeed items={feed} emptyLabel="No conversion outreach logged yet. Invite an eligible policyholder to begin." />
        </Panel>
      </Section>
    </div>
  )
}

function SoonestWindowsTable({ rows, householdName }: { rows: ConversionDue[]; householdName: Map<string, string> }) {
  const sorted = [...rows]
    .filter((r) => r.days_remaining != null)
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
    .slice(0, 12)
  if (!sorted.length) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No policies in an open conversion window.</div>
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Household</TableHead>
            <TableHead>Policy</TableHead>
            <TableHead className="text-right">Window</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => {
            const urgent = r.urgency_tier === '30'
            return (
              <TableRow key={r.policy_id}>
                <TableCell>
                  <Link href={`/app/conversions/${r.policy_id}`} className="font-medium text-primary hover:underline">
                    {r.primary_name ?? householdName.get(r.household_id ?? '') ?? 'Policyholder'}
                  </Link>
                </TableCell>
                <TableCell><Numeric className="text-muted-foreground">{r.policy_number ?? '—'}</Numeric></TableCell>
                <TableCell className="text-right">
                  <Badge variant={urgent ? 'lost' : 'pending'}>{r.days_remaining}d</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline"><Link href={`/app/conversions/${r.policy_id}`}>Open</Link></Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
