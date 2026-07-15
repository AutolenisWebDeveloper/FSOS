import Link from 'next/link'
import { PageHeader, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money, Numeric } from '@/components/ui/typography'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { loadGdcSummary } from '@/lib/data/gdc'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const fmt = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString('en-US')}`
// Half-open band [min, max): display the top as max − $1 (e.g. $0 – $14,999).
const band = (min: number, max: number | null) => (max === null ? `${fmt(min)}+` : `${fmt(min)} – ${fmt(max - 1)}`)

const STAGE_LABEL: Record<string, string> = {
  prospect: 'Prospect',
  fact_find: 'Fact Find',
  quoted_proposed: 'Quoted / Proposed',
  application: 'Application',
  underwriting_suitability: 'Underwriting',
  placed_issued: 'Placed / Issued',
}

// Legacy-port GDC & Commission (A1) — a tab inside Commission OS. Rolling-12mo GDC,
// current tier, distance to next, tier history, and estimated-FSA-payout pipeline.
// Tiers are assumption-flagged config; no value is a Farmers-published figure.
export default async function GdcPage() {
  const res = await loadGdcSummary()

  const header = (
    <PageHeader
      title="GDC & Tier"
      description="Rolling-12-month Gross Dealer Concession and FSA payout tier. Config defaults — verify against contract."
      breadcrumb={[{ label: 'Commissions', href: '/app/commissions' }, { label: 'GDC & Tier' }]}
    />
  )

  if (!res.ok) {
    return (
      <div className="space-y-6">
        {header}
        {res.notConfigured ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </div>
    )
  }

  const { math, tiers, rolling12, windowStart, pipeline, pipelineExpectedTotal, pipelineEstPayoutTotal } = res
  const current = math.current
  const next = math.next

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        {/* Current tier — the signature gold card (design-system.md §5.3B). */}
        <Card className="border-status-assumption/40 bg-status-assumption/5">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">
              Current GDC Tier
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {current ? (
              <>
                <div className="text-2xl font-semibold text-status-assumption">
                  {current.label} — {current.payout_pct}%
                </div>
                <p className="text-sm text-muted-foreground">{band(current.min_gdc, current.max_gdc)} GDC</p>
                <AssumptionBadge />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No tiers configured. Add tiers in Super → GDC Tiers.</p>
            )}
          </CardContent>
        </Card>

        {/* Headline metrics. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric label="Rolling-12mo GDC" value={fmt(rolling12)} hint={`Since ${windowStart}`} />
          <Metric
            label="To next tier"
            value={next ? fmt(math.distanceToNext) : '—'}
            hint={next ? `Reach ${next.label} (${next.payout_pct}%)` : 'At the top tier'}
          />
          <Metric label="Est. payout at tier" value={fmt(math.estimatedPayout)} hint="Rolling GDC × payout %" />
        </div>
      </div>

      {/* Tier ladder (history/config reference). */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tier ladder</CardTitle>
          <p className="text-sm text-muted-foreground">
            Editable, assumption-flagged config. <Link href="/super/config/gdc-tiers" className="text-primary hover:underline">Manage tiers</Link>.
          </p>
        </CardHeader>
        <CardContent>
          {tiers.length === 0 ? (
            <EmptyState title="No tiers configured" description="Add GDC tiers in Super → GDC Tiers." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tier</TableHead>
                    <TableHead>Band</TableHead>
                    <TableHead className="text-right">FSA payout</TableHead>
                    <TableHead></TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((t) => (
                    <TableRow key={t.tier_no} className={current && t.tier_no === current.tier_no ? 'bg-status-assumption/5' : undefined}>
                      <TableCell className="font-medium">{t.label}</TableCell>
                      <TableCell className="text-muted-foreground"><Numeric>{band(t.min_gdc, t.max_gdc)}</Numeric></TableCell>
                      <TableCell className="text-right"><Numeric>{t.payout_pct}%</Numeric></TableCell>
                      <TableCell>{current && t.tier_no === current.tier_no ? <span className="text-xs font-medium text-status-assumption">current</span> : null}</TableCell>
                      <TableCell>{t.is_assumption ? <AssumptionBadge /> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline snapshot — estimated FSA payout by stage at the current tier. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pipeline snapshot</CardTitle>
          <p className="text-sm text-muted-foreground">
            Open opportunities by stage, with estimated FSA payout at the current tier ({current ? `${current.payout_pct}%` : 'n/a'}).
          </p>
        </CardHeader>
        <CardContent>
          {pipeline.length === 0 ? (
            <EmptyState title="No open pipeline" description="Estimated payout appears here as opportunities progress." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Opps</TableHead>
                    <TableHead className="text-right">Expected commission</TableHead>
                    <TableHead className="text-right">Est. FSA payout</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipeline.map((p) => (
                    <TableRow key={p.stage}>
                      <TableCell className="font-medium">{STAGE_LABEL[p.stage] ?? p.stage}</TableCell>
                      <TableCell className="text-right"><Numeric>{p.count}</Numeric></TableCell>
                      <TableCell className="text-right"><Money value={p.expected} /></TableCell>
                      <TableCell className="text-right"><Money value={p.estPayout} /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-medium">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right"><Numeric>{pipeline.reduce((s, p) => s + p.count, 0)}</Numeric></TableCell>
                    <TableCell className="text-right"><Money value={pipelineExpectedTotal} /></TableCell>
                    <TableCell className="text-right"><Money value={pipelineEstPayoutTotal} /></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Estimate for the FSA&apos;s own production planning. Payout % is an assumption-flagged config default, not a Farmers-published figure.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <Numeric as="div" className="text-2xl font-semibold">{value}</Numeric>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
