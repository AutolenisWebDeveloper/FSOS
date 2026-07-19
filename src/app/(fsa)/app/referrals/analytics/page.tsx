import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { ReportShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Numeric } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// P2 Referral analytics (A11 ReportShell). Funnel counts aggregated by engagement.
interface AnalyticsRow {
  engagement: string | null
  status: string | null
  referral_count: number | null
  converted_count: number | null
}

const ENGAGEMENTS = ['warm_handoff', 'co_sell', 'direct'] as const

const pct = (converted: number, total: number) => (total > 0 ? `${((converted / total) * 100).toFixed(1)}%` : '—')

export default async function ReferralAnalyticsPage() {
  const res = await load<AnalyticsRow[]>(
    (db) => db.from('v_referral_analytics').select('engagement, status, referral_count, converted_count'),
    [],
  )

  const actions = (
    <Button asChild variant="outline">
      <Link href="/app/referrals">All referrals</Link>
    </Button>
  )

  if (!res.ok) {
    return (
      <ReportShell title="Referral Analytics" actions={actions}>
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </ReportShell>
    )
  }

  const rows = res.data
  if (rows.length === 0) {
    return (
      <ReportShell title="Referral Analytics" description="Conversion funnel by engagement model." actions={actions}>
        <EmptyState icon={BarChart3} title="No referral data yet" description="Once referrals are logged, conversion analytics appear here." />
      </ReportShell>
    )
  }

  const totalReferrals = rows.reduce((s, r) => s + Number(r.referral_count || 0), 0)
  const totalConverted = rows.reduce((s, r) => s + Number(r.converted_count || 0), 0)

  // Aggregate by engagement.
  const byEngagement = new Map<string, { referrals: number; converted: number }>()
  for (const r of rows) {
    const key = r.engagement ?? 'unknown'
    const acc = byEngagement.get(key) ?? { referrals: 0, converted: 0 }
    acc.referrals += Number(r.referral_count || 0)
    acc.converted += Number(r.converted_count || 0)
    byEngagement.set(key, acc)
  }

  // Order known engagements first, then any extras.
  const orderedKeys = [
    ...ENGAGEMENTS.filter((e) => byEngagement.has(e)),
    ...Array.from(byEngagement.keys()).filter((k) => !ENGAGEMENTS.includes(k as (typeof ENGAGEMENTS)[number])),
  ]

  return (
    <ReportShell title="Referral Analytics" description="Conversion funnel by engagement model." actions={actions}>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total referrals" value={totalReferrals} href="/app/referrals" />
        <StatTile label="Converted" value={totalConverted} href="/app/referrals" />
        <StatTile label="Conversion rate" value={pct(totalConverted, totalReferrals)} href="/app/referrals" />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Engagement</TableHead>
              <TableHead className="text-right">Referrals</TableHead>
              <TableHead className="text-right">Converted</TableHead>
              <TableHead className="text-right">Conversion rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orderedKeys.map((key) => {
              const agg = byEngagement.get(key)!
              return (
                <TableRow key={key}>
                  <TableCell className="font-medium capitalize">{key.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-right"><Numeric>{agg.referrals}</Numeric></TableCell>
                  <TableCell className="text-right"><Numeric>{agg.converted}</Numeric></TableCell>
                  <TableCell className="text-right"><Numeric>{pct(agg.converted, agg.referrals)}</Numeric></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </ReportShell>
  )
}
