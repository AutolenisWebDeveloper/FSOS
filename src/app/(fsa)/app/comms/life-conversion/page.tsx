import Link from 'next/link'
import { ListShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { campaignAnalytics } from '@/lib/life-campaign/analytics'
import { CampaignControls } from '@/components/app/CampaignEngineControls'
import { CAMPAIGN_ENGINES, campaignBreadcrumb, campaignDetailHref } from '@/lib/comms/campaign-presentation'
import { CampaignStatusBadge, EnrollmentStatusBadge, CampaignHeaderActions, CampaignStat } from '@/components/comms/campaign/CampaignKit'

export const dynamic = 'force-dynamic'

// Life Conversion Campaign — operations dashboard (§4b/§15). Campaign status + controls,
// enrollment KPIs, phase distribution, touch outcomes, advisor-task health, and the current
// enrollment roster. Read-only data; controls POST to the audited /api/life-campaign endpoints.
// Status vocabulary, engine identity, and badges come from the shared campaign layer
// (@/lib/comms/campaign-presentation + CampaignKit) — never redeclared here.

const ENGINE = CAMPAIGN_ENGINES.life_conversion

interface CampaignRow {
  id: string
  name: string
  status: string
  is_assumption: boolean
  simulated_at: string | null
}

interface EnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
  conversion_deadline: string | null
}

export default async function LifeConversionPage() {
  const campaigns = await load<CampaignRow[]>(
    (db) => db.from('life_campaigns').select('id, name, status, is_assumption, simulated_at').order('created_at', { ascending: true }).limit(10),
    [],
  )

  if (!campaigns.ok) {
    return (
      <ListShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      </ListShell>
    )
  }

  const campaign = campaigns.data[0]
  if (!campaign) {
    return (
      <ListShell title={ENGINE.title} breadcrumb={campaignBreadcrumb(ENGINE)}>
        <EmptyState
          title="No campaign found"
          description={`Run migration ${ENGINE.seedMigration} to seed the ${ENGINE.title} campaign and its ${ENGINE.touches}-touch timeline.`}
        />
      </ListShell>
    )
  }

  const [analytics, enrollments] = await Promise.all([
    campaignAnalytics(campaign.id),
    load<EnrollmentRow[]>(
      (db) => db.from('life_campaign_enrollments').select('id, status, current_touch_no, baseline_date, conversion_deadline').eq('campaign_id', campaign.id).order('updated_at', { ascending: false }).limit(50),
      [],
    ),
  ])

  return (
    <ListShell
      title={ENGINE.title}
      description={ENGINE.description}
      breadcrumb={campaignBreadcrumb(ENGINE)}
      actions={
        <CampaignHeaderActions
          engine={ENGINE}
          status={campaign.status}
          isAssumption={campaign.is_assumption}
          manageHref={campaignDetailHref(ENGINE, campaign.id)}
        />
      }
    >
      <div className="space-y-6">
        <Link
          href={campaignDetailHref(ENGINE, campaign.id)}
          className="block rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{campaign.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Configuration, schedule, assets, workflows, analytics, settings, and controls</p>
            </div>
            <CampaignStatusBadge status={campaign.status} />
          </div>
        </Link>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Operational controls</h2>
          <CampaignControls campaignId={campaign.id} status={campaign.status} endpoint="/api/life-campaign" />
          {!campaign.simulated_at && campaign.status !== 'active' && (
            <p className="mt-3 text-xs text-muted-foreground">A read-only simulation is recommended before activation (ADR-021).</p>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Active enrollments" value={analytics?.active ?? 0} tone="brand" />
          <StatTile label="Completed (Day 180)" value={analytics?.completed ?? 0} />
          <StatTile label="Exited / suppressed" value={analytics?.exited ?? 0} />
          <StatTile label="Message touches sent" value={analytics?.touches.sent ?? 0} hint="Through the compliance gate" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Phase distribution (active)</h2>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Early (Day 1–47)" value={analytics?.byPhase.early ?? 0} />
              <CampaignStat label="Mid (Day 48–134)" value={analytics?.byPhase.mid ?? 0} />
              <CampaignStat label="Accelerated (135–180)" value={analytics?.byPhase.accelerated ?? 0} />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Advisor outreach health (§9a)</h2>
            <div className="grid grid-cols-3 gap-3">
              <CampaignStat label="Fulfilled" value={analytics?.advisor.fulfilled ?? 0} />
              <CampaignStat label="Overdue" value={analytics?.advisor.overdue ?? 0} attentionWhenNonZero />
              <CampaignStat label="Missed" value={analytics?.advisor.missed ?? 0} />
            </div>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Enrollments ({enrollments.ok ? enrollments.data.length : 0})</h2>
          {!enrollments.ok ? (
            <ErrorState description="Could not load enrollments." />
          ) : enrollments.data.length === 0 ? (
            <EmptyState title="No enrollments yet" description="Eligible term-conversion contacts are enrolled by the daily job or manually; each must have a verified deadline and no active opportunity." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Touch</TableHead>
                  <TableHead>Baseline</TableHead>
                  <TableHead>Conversion deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><EnrollmentStatusBadge status={e.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{e.current_touch_no} / {ENGINE.touches}</TableCell>
                    <TableCell className="text-muted-foreground">{e.baseline_date}</TableCell>
                    <TableCell className="text-muted-foreground">{e.conversion_deadline ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </ListShell>
  )
}
