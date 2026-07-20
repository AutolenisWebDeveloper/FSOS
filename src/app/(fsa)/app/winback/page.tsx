import Link from 'next/link'
import {
  Heart,
  PhoneCall,
  ShieldOff,
  Building2,
  DollarSign,
  Layers,
  History,
  MapPin,
  Sparkles,
  UserPlus,
  Contact as ContactIcon,
  ArrowRight,
} from 'lucide-react'
import { PageHeader, Section, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { loadWinbackDashboard } from '@/lib/dashboards/winback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Life Win-Back Command Center (A1). Re-engage households whose agency once carried
// a Life line that has lapsed — identify and invite only (guardrail §2.2). The
// win-back book lives in `contacts` (source='winback_life'); DNC / unsubscribe flags
// are honored, premium-at-risk is an assumption-based estimate (§2.3), and every
// figure is live CRM data. Nothing here is a securities record.
export default async function WinbackPage() {
  const res = await loadWinbackDashboard()

  const actions = (
    <div className="hidden flex-wrap gap-2 sm:flex">
      <Button asChild variant="outline" size="sm"><Link href="/app/contacts?source=winback_life">All contacts</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href="/app/comms">Outreach</Link></Button>
      <Button asChild size="sm"><Link href="/app/winback/import">Import list</Link></Button>
    </div>
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'Production Operations' }, { label: 'Life Win-Back' }]

  if (!res.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Life Win-Back" description="Re-engage lapsed and former Life clients across every partnered agency's book." breadcrumb={breadcrumb} actions={actions} />
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </div>
    )
  }

  const { kpis, contacts } = res.data
  const now = Date.now()
  const nameOf = (c: (typeof contacts)[number]) =>
    c.full_name ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || 'Contact')

  // Priority outreach queue: reachable, life-winback-tagged, most recently added.
  const queue = contacts
    .filter((c) => {
      const t = (c.tags ?? []).map((x) => x.toLowerCase())
      const suppressed = t.includes('dnc') || t.includes('email-unsubscribed')
      return !suppressed && (c.email || c.phone)
    })
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      title: nameOf(c),
      subtitle: `${(c.lines_of_business ?? []).map(humanize).slice(0, 3).join(' · ') || 'Lapsed life'}${c.state ? ` · ${c.state}` : ''}`,
      href: `/app/contacts/${c.id}`,
      right: c.phone ? <Badge variant="active">phone</Badge> : c.email ? <Badge variant="draft">email</Badge> : undefined,
      tone: 'positive' as const,
    }))

  // Activity: recently added to the win-back book (no fabricated outreach events).
  const feed: FeedItem[] = contacts.slice(0, 8).map((c) => ({
    id: c.id,
    icon: UserPlus,
    title: (
      <span>
        <span className="font-medium">{nameOf(c)}</span>
        <span className="text-muted-foreground"> added to win-back book</span>
      </span>
    ),
    meta: (c.lines_of_business ?? []).map(humanize).slice(0, 3).join(' · ') || undefined,
    time: timeAgo(c.created_at, now),
    href: `/app/contacts/${c.id}`,
    tone: 'brand',
  }))

  const lineTone = (line: string) => (line === 'life' ? 'brand' : 'neutral')

  return (
    <div className="space-y-7">
      <PageHeader
        title="Life Win-Back"
        description="Lapsed & former Life clients across every partnered agency's book. Identify and invite to re-engage — never a securities record, never a product recommendation."
        breadcrumb={breadcrumb}
        actions={actions}
      />

      {/* Guardrail framing. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm">
        <AssumptionBadge label="win-back book — lapsed life" />
        <span className="text-muted-foreground">
          Households whose agency once carried a Life line that is now inactive. DNC and unsubscribed flags are honored on every send; premium-at-risk is an estimate.
        </span>
      </div>

      {/* ── Executive KPIs ─────────────────────────────────────────────────── */}
      <MetricGrid>
        <MetricCard label="Total lapsed clients" value={kpis.total.toLocaleString()} href="/app/contacts?source=winback_life" icon={Heart} tone="brand" hint="In the win-back book" />
        <MetricCard label="Contactable" value={kpis.reachable.toLocaleString()} href="/app/comms" icon={PhoneCall} tone="positive" hint="Phone or email, not suppressed" />
        <MetricCard label="Suppressed" value={kpis.suppressed.toLocaleString()} icon={ShieldOff} tone="attention" hint="DNC or unsubscribed" />
        <MetricCard label="Agencies covered" value={kpis.linkedAgencies.toLocaleString()} href="/app/agencies" icon={Building2} tone="neutral" hint="Books with lapsed life" />
        <MetricCard
          label="Est. premium at risk"
          value={money(kpis.estPremiumAtRisk)}
          icon={DollarSign}
          tone="neutral"
          hint="Assumption-based estimate"
          delta={<AssumptionBadge />}
        />
      </MetricGrid>

      {/* ── Funnel + prior-line mix ────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Win-back funnel" description="Lapsed → contactable → active → worked" icon={Layers} className="lg:col-span-7">
          <FunnelChart stages={res.data.funnel.map((s, i) => ({ ...s, tone: i < 2 ? 'brand' : 'positive' }))} valueLabel="clients" />
        </Panel>
        <Panel title="Contactability" description="Open channels after suppression" icon={PhoneCall} className="lg:col-span-5">
          <DonutChart
            segments={res.data.contactability.map((c, i) => ({
              label: c.label,
              value: c.value,
              tone: i === 0 ? 'positive' : i === 3 ? 'critical' : 'brand',
            }))}
            centerLabel="clients"
          />
        </Panel>
      </div>

      {/* ── Book segmentation ──────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Book by prior line" description="Lines the household previously held" icon={Layers} className="lg:col-span-4">
          <BarList
            items={res.data.lineDistribution.slice(0, 6).map((l) => ({ label: humanize(l.label), value: l.value, tone: lineTone(l.label) }))}
            emptyLabel="No prior-line data captured."
          />
        </Panel>
        <Panel title="Time since lapse" description="How long since added to the book" icon={History} className="lg:col-span-4">
          <BarList
            items={res.data.recency.map((r, i) => ({ label: r.label, value: r.value, tone: i >= 3 ? 'attention' : 'brand' }))}
            emptyLabel="No recency data."
          />
        </Panel>
        <Panel title="Geography" description="Top states in the win-back book" icon={MapPin} className="lg:col-span-4">
          <BarList items={res.data.geography.map((g) => ({ label: g.label, value: g.value, tone: 'neutral' }))} emptyLabel="No geographic data." />
        </Panel>
      </div>

      {/* ── Agency leaderboard + right rail ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Agency leaderboard"
          description="Books with the most lapsed Life clients to win back"
          icon={Building2}
          className="lg:col-span-8"
          action={<PanelLink href="/app/agencies">Agencies</PanelLink>}
        >
          <Leaderboard
            rows={res.data.agencyLeaderboard.map((a) => ({ name: a.name, value: a.value, href: '/app/agencies' }))}
            emptyLabel="No agency-linked win-back contacts yet."
          />
        </Panel>

        <div className="space-y-4 lg:col-span-4">
          <Panel title="Outreach queue" description="Reachable, ready to invite" icon={PhoneCall} tone="positive">
            <QueueList items={queue} emptyLabel="No reachable contacts queued." />
          </Panel>
          <Panel title="AI outreach" description="Green-zone, consent-gated" icon={Sparkles}>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Reachable" value={kpis.reachable.toLocaleString()} tone="positive" />
              <MiniStat label="Priority" value={kpis.priority.toLocaleString()} tone="brand" />
              <MiniStat label="New 30d" value={kpis.newLast30.toLocaleString()} tone="neutral" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Re-engagement invitations clear the 7-step compliance gate. Suppressed contacts are never contacted.
            </p>
            <Link href="/app/comms" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Communications <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Panel>
        </div>
      </div>

      {/* ── Recently added ─────────────────────────────────────────────────── */}
      <Section title="Recently added" action={<PanelLink href="/app/contacts?source=winback_life">All win-back contacts</PanelLink>}>
        <Panel title="Win-back intake" icon={ContactIcon} bodyClassName="pt-2">
          <ActivityFeed items={feed} emptyLabel="No win-back contacts yet. Import a lapsed-life list to begin." />
        </Panel>
      </Section>
    </div>
  )
}
