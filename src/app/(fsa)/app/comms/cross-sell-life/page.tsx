import Link from 'next/link'
import { ListShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { campaignAnalytics, type CampaignAnalytics } from '@/lib/cross-sell-life/analytics'

export const dynamic = 'force-dynamic'

// Cross-Sell Life Campaign — operations dashboard (§18 dashboard + §19 analytics). Lists every
// Cross-Sell Life campaign in xsell_life_campaigns with live analytics: status + version, the
// enrolled / active / completed / opt-out counts, the conversion funnel (enrolled → appointment →
// quote → application → issued) with stage rates, email/SMS/AI channel sends, and advisor-touch
// health. Read-only data; each campaign links to its management center. Parallel to the Life
// Conversion dashboard (same tokens, shells, and states).

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  disabled: 'secondary',
  emergency_stopped: 'destructive',
  archived: 'outline',
  draft: 'outline',
  approval_pending: 'secondary',
}

interface CampaignRow {
  id: string
  name: string
  status: string
  version: number
  is_assumption: boolean
  simulated_at: string | null
}

export default async function CrossSellLifePage() {
  const campaigns = await load<CampaignRow[]>(
    (db) =>
      db
        .from('xsell_life_campaigns')
        .select('id, name, status, version, is_assumption, simulated_at')
        .order('created_at', { ascending: true })
        .limit(25),
    [],
  )

  if (!campaigns.ok) {
    return (
      <ListShell title="Cross-Sell Life Campaign" breadcrumb={crumb()}>
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      </ListShell>
    )
  }

  if (campaigns.data.length === 0) {
    return (
      <ListShell title="Cross-Sell Life Campaign" breadcrumb={crumb()}>
        <EmptyState
          title="No campaign found"
          description="Run migration 086 to seed the Cross-Sell Life campaign and its 35-touch, 180-day timeline."
        />
      </ListShell>
    )
  }

  const analytics = await Promise.all(campaigns.data.map((c) => campaignAnalytics(c.id)))

  return (
    <ListShell
      title="Cross-Sell Life Campaign"
      description="180-day, 35-touch multi-channel life-insurance cross-sell to existing agency clients. Every send passes the compliance gate; eligibility is rechecked before every touch. AI conversations stay behind the §4.2 red line."
      breadcrumb={crumb()}
    >
      <div className="space-y-6">
        {campaigns.data.map((campaign, i) => (
          <CampaignPanel key={campaign.id} campaign={campaign} analytics={analytics[i]} />
        ))}
      </div>
    </ListShell>
  )
}

function CampaignPanel({ campaign, analytics }: { campaign: CampaignRow; analytics: CampaignAnalytics | null }) {
  const funnel = analytics?.funnel
  const rates = analytics?.rates
  return (
    <Card className="p-5">
      {/* Header — name, version, status, assumption badge, link to management center */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/app/comms/cross-sell-life/${campaign.id}`}
            className="text-base font-semibold underline-offset-4 hover:underline"
          >
            {campaign.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Version {campaign.version} · Configuration, schedule, assets, playbooks, analytics & controls →
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_TONE[campaign.status] ?? 'outline'}>{campaign.status.replace(/_/g, ' ')}</Badge>
          {campaign.is_assumption && <AssumptionBadge />}
          <Link
            href="/app/comms/console?mode=test&campaign=cross_sell_life"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Test this campaign
          </Link>
          <Link
            href={`/app/comms/cross-sell-life/${campaign.id}`}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Manage →
          </Link>
        </div>
      </div>

      {!campaign.simulated_at && campaign.status !== 'active' && (
        <p className="mt-3 text-xs text-muted-foreground">A read-only simulation is recommended before activation (ADR-021).</p>
      )}

      {/* KPI counts */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Enrolled (all-time)" value={funnel?.enrolled ?? 0} />
        <StatTile label="Active enrollments" value={analytics?.totals.active ?? 0} tone="brand" />
        <StatTile label="Completed (Day 180)" value={analytics?.totals.completed ?? 0} />
        <StatTile label="Opt-outs" value={funnel?.optOuts ?? 0} hint="STOP / unsubscribe / suppression" tone="attention" />
      </div>

      {/* Conversion funnel */}
      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Conversion funnel</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <FunnelCell label="Enrolled" value={funnel?.enrolled ?? 0} />
          <FunnelCell label="Appointment" value={funnel?.appointments ?? 0} rate={rates?.enrollToAppointment} rateLabel="of enrolled" />
          <FunnelCell label="Quote" value={funnel?.quotes ?? 0} rate={rates?.appointmentToQuote} rateLabel="of appts" />
          <FunnelCell label="Application" value={funnel?.applications ?? 0} rate={rates?.quoteToApplication} rateLabel="of quotes" />
          <FunnelCell label="Issued" value={funnel?.issued ?? 0} rate={rates?.applicationToIssued} rateLabel="of apps" tone="brand" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Overall enrolled → issued: <span className="font-medium tabular-nums">{rates?.overall ?? 0}%</span>. Opens are not counted as
          engagement (§19) — only inbound replies and terminal states advance the funnel.
        </p>
      </div>

      {/* Channels + advisor */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Channel sends (through the compliance gate)</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <MiniCell label="Email" value={analytics?.channels.email ?? 0} />
            <MiniCell label="SMS" value={analytics?.channels.sms ?? 0} />
            <MiniCell label="AI" value={analytics?.channels.ai ?? 0} />
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Advisor outreach health</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <MiniCell label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
            <MiniCell label="Overdue" value={analytics?.advisor.overdue ?? 0} attention />
            <MiniCell label="Missed" value={analytics?.advisor.missed ?? 0} />
          </div>
        </div>
      </div>

      {!analytics && (
        <p className="mt-4 text-xs text-muted-foreground">Analytics are not available for this campaign yet.</p>
      )}
    </Card>
  )
}

function FunnelCell({
  label,
  value,
  rate,
  rateLabel,
  tone,
}: {
  label: string
  value: number
  rate?: number
  rateLabel?: string
  tone?: 'brand'
}) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'brand' ? 'border-primary/40' : ''}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-medium">{label}</p>
      {typeof rate === 'number' && (
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {rate}% {rateLabel}
        </p>
      )}
    </div>
  )
}

function MiniCell({ label, value, attention }: { label: string; value: number; attention?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${attention && value > 0 ? 'border-amber-400/60' : ''}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function crumb() {
  return [
    { label: 'FSA', href: '/app' },
    { label: 'Comms', href: '/app/comms' },
    { label: 'Cross-Sell Life' },
  ]
}
