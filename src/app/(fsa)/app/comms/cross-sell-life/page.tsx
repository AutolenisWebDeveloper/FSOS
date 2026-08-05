import Link from 'next/link'
import { ListShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { campaignAnalytics, type CampaignAnalytics } from '@/lib/cross-sell-life/analytics'
import { CAMPAIGN_ENGINES, campaignBreadcrumb, campaignDetailHref } from '@/lib/comms/campaign-presentation'
import { CampaignHeaderActions, CampaignStat, FunnelStat } from '@/components/comms/campaign/CampaignKit'
import { CampaignStateLine } from '@/components/comms/campaign/CampaignStateLine'

export const dynamic = 'force-dynamic'

// Cross-Sell Life Campaign — operations dashboard (§18 dashboard + §19 analytics). Lists every
// Cross-Sell Life campaign in xsell_life_campaigns with live analytics: status + version, the
// enrolled / active / completed / opt-out counts, the conversion funnel (enrolled → appointment →
// quote → application → issued) with stage rates, email/SMS/AI channel sends, and advisor-touch
// health. Read-only data; each campaign links to its management center. Parallel to the Life
// Conversion dashboard (same tokens, shells, and states). Status vocabulary, engine identity,
// and badges come from the shared campaign layer (@/lib/comms/campaign-presentation +
// CampaignKit) — never redeclared here.

const ENGINE = CAMPAIGN_ENGINES.cross_sell_life

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
      <ListShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      </ListShell>
    )
  }

  if (campaigns.data.length === 0) {
    return (
      <ListShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <EmptyState
          title="No campaign found"
          description={`Run migration ${ENGINE.seedMigration} to seed the ${ENGINE.title} campaign and its ${ENGINE.touches}-touch, ${ENGINE.days}-day timeline.`}
        />
      </ListShell>
    )
  }

  const analytics = await Promise.all(campaigns.data.map((c) => campaignAnalytics(c.id)))

  return (
    <ListShell
      title={ENGINE.title}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE)}
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
            href={campaignDetailHref(ENGINE, campaign.id)}
            className="text-base font-semibold underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {campaign.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Configuration, schedule, assets, playbooks, analytics, and controls
          </p>
        </div>
        <CampaignHeaderActions
          engine={ENGINE}
          status={campaign.status}
          version={campaign.version}
          isAssumption={campaign.is_assumption}
          manageHref={campaignDetailHref(ENGINE, campaign.id)}
        />
      </div>

      <CampaignStateLine
        className="mt-4"
        status={campaign.status}
        simulatedAt={campaign.simulated_at}
        activeEnrollments={analytics?.totals?.active ?? 0}
        pausedEnrollments={analytics?.totals?.paused ?? 0}
        suppressedTouches={analytics?.touches.suppressed ?? 0}
        deadLetterTouches={analytics?.touches.dead_letter ?? 0}
        overdueAdvisorTasks={analytics?.advisor.overdue ?? 0}
      />

      {/* KPI counts */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Enrolled (all-time)" value={funnel?.enrolled ?? 0} />
        <StatTile label="Active enrollments" value={analytics?.totals?.active ?? 0} tone="brand" />
        <StatTile label={`Completed (Day ${ENGINE.days})`} value={analytics?.totals?.completed ?? 0} />
        <StatTile label="Opt-outs" value={funnel?.optOuts ?? 0} hint="STOP / unsubscribe / suppression" tone="attention" />
      </div>

      {/* Conversion funnel */}
      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Conversion funnel</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <FunnelStat label="Enrolled" value={funnel?.enrolled ?? 0} />
          <FunnelStat label="Appointment" value={funnel?.appointments ?? 0} rate={rates?.enrollToAppointment} rateLabel="of enrolled" />
          <FunnelStat label="Quote" value={funnel?.quotes ?? 0} rate={rates?.appointmentToQuote} rateLabel="of appts" />
          <FunnelStat label="Application" value={funnel?.applications ?? 0} rate={rates?.quoteToApplication} rateLabel="of quotes" />
          <FunnelStat label="Issued" value={funnel?.issued ?? 0} rate={rates?.applicationToIssued} rateLabel="of apps" tone="brand" />
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
          <div className="grid grid-cols-3 gap-3">
            <CampaignStat label="Email" value={analytics?.channels?.email ?? 0} />
            <CampaignStat label="SMS" value={analytics?.channels?.sms ?? 0} />
            <CampaignStat label="AI" value={analytics?.channels?.ai ?? 0} />
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Advisor outreach health</p>
          <div className="grid grid-cols-3 gap-3">
            <CampaignStat label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
            <CampaignStat label="Overdue" value={analytics?.advisor.overdue ?? 0} attentionWhenNonZero />
            <CampaignStat label="Missed" value={analytics?.advisor.missed ?? 0} />
          </div>
        </div>
      </div>

      {!analytics && (
        <p className="mt-4 text-xs text-muted-foreground">Analytics are not available for this campaign yet.</p>
      )}
    </Card>
  )
}

