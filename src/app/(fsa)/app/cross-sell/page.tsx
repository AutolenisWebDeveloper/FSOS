import Link from 'next/link'
import {
  Shuffle,
  Users,
  Building2,
  CalendarCheck,
  DollarSign,
  Send,
  Sparkles,
  Layers,
  Activity as ActivityIcon,
  ArrowRight,
} from 'lucide-react'
import { PageHeader, Section, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import {
  Panel,
  PanelLink,
  MetricCard,
  MetricGrid,
  MiniStat,
  FunnelChart,
  DonutChart,
  BarList,
  Leaderboard,
  ActivityFeed,
  QueueList,
  type FeedItem,
} from '@/components/dashboards'
import { money, timeAgo, humanize } from '@/lib/dashboards/format'
import { loadCrossSellDashboard, type CrossSellGap } from '@/lib/dashboards/crosssell'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-08 Cross-Sell Production Command Center (A1). A coverage-GAP operations
// surface across every partnered agency's book — identify, educate, invite, never
// recommend a product (guardrail §2.2). Every figure is live CRM data; revenue is
// an assumption-based estimate (§2.3). Wired to the existing gap views, activity
// log, reviews, and per-household detail — no data duplicated, nothing rebuilt.
export default async function CrossSellPage() {
  const res = await loadCrossSellDashboard()

  const actions = (
    <div className="hidden flex-wrap gap-2 sm:flex">
      <Button asChild variant="outline" size="sm"><Link href="/app/cross-sell/household-gaps">Household gaps</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href="/app/cross-sell/agency-penetration">Agency penetration</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href="/app/cross-sell/analytics">Analytics</Link></Button>
      <Button asChild size="sm"><Link href="/app/crosssell">Import book</Link></Button>
    </div>
  )

  if (!res.ok) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Cross-Sell"
          description="Coverage gaps and review opportunities across every partnered agency's book."
          breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Production Operations' }, { label: 'Cross-Sell' }]}
          actions={actions}
        />
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </div>
    )
  }

  const { kpis, gaps, lineDistribution, gapIntensity, agencyLeaderboard, activities } = res.data
  const now = Date.now()

  // Funnel — an identify → invite → review pipeline built from the activity log.
  const funnel = [
    { label: 'Gaps identified', value: kpis.totalGaps, href: '/app/cross-sell/household-gaps', tone: 'brand' as const },
    { label: 'Households contacted', value: kpis.contacted, tone: 'brand' as const },
    { label: 'Invited / educated', value: kpis.invited, tone: 'positive' as const },
    { label: 'Reviews scheduled', value: kpis.reviewsScheduled, href: '/app/reviews', tone: 'positive' as const },
  ]

  const topGaps = gaps.slice(0, 12)

  // Follow-up queue: no-life, high-score households are the priority to invite.
  const queue = gaps
    .filter((g) => !g.has_life)
    .slice(0, 6)
    .map((g) => ({
      id: g.household_id,
      title: g.primary_name ?? 'Household',
      subtitle: `${g.gap_count} coverage gap${g.gap_count === 1 ? '' : 's'} · next: ${humanize(g.next_best_line) || '—'}`,
      href: `/app/cross-sell/${g.household_id}`,
      right: <Numeric className="text-sm font-semibold">{g.score}</Numeric>,
      tone: 'attention' as const,
    }))

  const feed: FeedItem[] = activities.slice(0, 8).map((a) => {
    const verb = a.kind ? a.kind.replace('crosssell_', '') : 'activity'
    return {
      id: a.id,
      icon: verb === 'schedule' ? CalendarCheck : verb === 'escalate' ? Sparkles : Send,
      title: (
        <span>
          <span className="font-medium capitalize">{humanize(verb)}</span>
          {a.note ? <span className="text-muted-foreground"> — {a.note}</span> : null}
        </span>
      ),
      meta: a.entity_id ? 'Household outreach' : undefined,
      time: timeAgo(a.created_at, now),
      href: a.entity_id ? `/app/cross-sell/${a.entity_id}` : undefined,
      tone: verb === 'escalate' ? 'security' : verb === 'schedule' ? 'positive' : 'brand',
    }
  })

  const lineTone = (line: string) => (line === 'life' ? 'brand' : line === 'annuity' || line === 'investment' ? 'positive' : 'neutral')

  return (
    <div className="space-y-7">
      <PageHeader
        title="Cross-Sell"
        description="Term Life · FIUL · VUL · Financial Products — coverage-gap opportunities across every partnered agency's book. We identify and invite; we never recommend a product."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Production Operations' }, { label: 'Cross-Sell' }]}
        actions={actions}
      />

      {/* ── Executive KPIs ─────────────────────────────────────────────────── */}
      <MetricGrid>
        <MetricCard label="Total opportunities" value={kpis.totalGaps.toLocaleString()} href="/app/cross-sell/household-gaps" icon={Shuffle} tone="brand" hint="Open coverage gaps" />
        <MetricCard label="No-life households" value={kpis.noLife.toLocaleString()} href="/app/cross-sell/household-gaps" icon={Users} tone="attention" hint="Highest-priority invites" />
        <MetricCard label="Agencies participating" value={kpis.agenciesParticipating.toLocaleString()} href="/app/cross-sell/agency-penetration" icon={Building2} tone="neutral" hint="Books with open gaps" />
        <MetricCard label="Reviews scheduled" value={kpis.reviewsScheduled.toLocaleString()} href="/app/reviews" icon={CalendarCheck} tone="positive" hint={`${kpis.conversionRate}% of identified`} />
        <MetricCard
          label="Est. FSA revenue"
          value={money(kpis.estRevenue)}
          icon={DollarSign}
          tone="neutral"
          hint="Assumption-based estimate"
          delta={<AssumptionBadge />}
        />
      </MetricGrid>

      {/* ── Funnel + coverage-gap mix ──────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Cross-sell funnel"
          description="Identify → contact → invite → review. Invitation only."
          icon={Layers}
          className="lg:col-span-7"
          action={<PanelLink href="/app/cross-sell/analytics">Analytics</PanelLink>}
        >
          <FunnelChart stages={funnel} valueLabel="households" />
        </Panel>
        <Panel
          title="Coverage-gap mix"
          description="Next open line per household (a gap, not a recommendation)"
          icon={Shuffle}
          className="lg:col-span-5"
        >
          <DonutChart
            segments={lineDistribution.slice(0, 6).map((l) => ({ label: humanize(l.label), value: l.value, tone: lineTone(l.label) }))}
            centerLabel="households"
          />
        </Panel>
      </div>

      {/* ── Leaderboard + intensity ────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Agency leaderboard"
          description="Open cross-sell opportunities by book"
          icon={Building2}
          className="lg:col-span-7"
          action={<PanelLink href="/app/cross-sell/agency-penetration">Penetration</PanelLink>}
        >
          <Leaderboard
            rows={agencyLeaderboard.map((a) => ({
              name: a.name,
              value: a.opportunities,
              href: `/app/cross-sell/agency-penetration`,
              meta: a.penetration != null ? `${a.penetration}% life` : undefined,
            }))}
            emptyLabel="No agency-linked gaps yet."
          />
        </Panel>
        <Panel title="Opportunity intensity" description="Open coverage lines per household" icon={Layers} className="lg:col-span-5">
          <BarList
            items={gapIntensity.map((g, i) => ({ label: g.label, value: g.value, tone: i === 2 ? 'attention' : 'brand' }))}
            emptyLabel="No multi-line gaps yet."
          />
        </Panel>
      </div>

      {/* ── Top opportunities + right rail ─────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Top opportunities"
          description="Highest-scoring coverage gaps"
          icon={Shuffle}
          className="lg:col-span-8"
          bodyClassName="p-0"
          action={<PanelLink href="/app/cross-sell/household-gaps">All households</PanelLink>}
        >
          <TopOpportunitiesTable gaps={topGaps} />
        </Panel>

        <div className="space-y-4 lg:col-span-4">
          <Panel title="Follow-up queue" description="Priority invites (no life)" icon={CalendarCheck} tone="attention">
            <QueueList items={queue} emptyLabel="No priority follow-ups." />
          </Panel>
          <Panel title="AI outreach" description="Green-zone activity, all gated" icon={Sparkles}>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Contacted" value={kpis.contacted.toLocaleString()} tone="brand" />
              <MiniStat label="Invited" value={kpis.invited.toLocaleString()} tone="positive" />
              <MiniStat label="Reviews" value={kpis.reviewsScheduled.toLocaleString()} tone="positive" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Every client-facing send clears the 7-step compliance gate. No securities activity is automated.
            </p>
            <Link href="/app/ai" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              AI operations <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Panel>
        </div>
      </div>

      {/* ── Activity feed ──────────────────────────────────────────────────── */}
      <Section title="Recent activity" action={<PanelLink href="/app/cross-sell/analytics">All activity</PanelLink>}>
        <Panel title="Outreach log" icon={ActivityIcon} bodyClassName="pt-2">
          <ActivityFeed items={feed} emptyLabel="No cross-sell outreach logged yet. Identify a gap to begin." />
        </Panel>
      </Section>
    </div>
  )
}

function TopOpportunitiesTable({ gaps }: { gaps: CrossSellGap[] }) {
  if (!gaps.length) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No coverage gaps identified. Adjust the recommended-basket config to change gap logic.</div>
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Household</TableHead>
            <TableHead>Next coverage gap</TableHead>
            <TableHead className="text-right">Gaps</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {gaps.map((g) => (
            <TableRow key={g.household_id}>
              <TableCell>
                <Link href={`/app/cross-sell/${g.household_id}`} className="font-medium text-primary hover:underline">
                  {g.primary_name ?? 'Household'}
                </Link>
                {!g.has_life ? <Badge variant="pending" className="ml-2">no life</Badge> : null}
              </TableCell>
              <TableCell className="capitalize text-muted-foreground">
                {humanize(g.next_best_line ?? '') || '—'} <span className="text-xs">(gap)</span>
              </TableCell>
              <TableCell className="text-right"><Numeric>{g.gap_count}</Numeric></TableCell>
              <TableCell className="text-right"><Numeric className="font-semibold">{g.score}</Numeric></TableCell>
              <TableCell className="text-right">
                <Button asChild size="sm" variant="outline"><Link href={`/app/cross-sell/${g.household_id}`}>Open</Link></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
