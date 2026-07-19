import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReportShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Numeric, Money } from '@/components/ui/typography'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

const MONEY_KEYS = new Set(['total_premium', 'expected_commission', 'total_commission', 'fsa_amount', 'agency_amount', 'ytd_placed_premium'])

const REPORTS: Record<string, { name: string; view: string; columns: { key: string; label: string; num?: boolean }[] }> = {
  pipeline: { name: 'Pipeline by engagement', view: 'v_pipeline_by_engagement', columns: [{ key: 'engagement', label: 'Engagement' }, { key: 'stage', label: 'Stage' }, { key: 'opp_count', label: 'Opps', num: true }, { key: 'total_premium', label: 'Premium', num: true }, { key: 'expected_commission', label: 'Expected commission', num: true }] },
  'commission-by-agency': { name: 'Commission by agency', view: 'v_commission_by_agency', columns: [{ key: 'agency_name', label: 'Agency' }, { key: 'product_family', label: 'Family' }, { key: 'total_commission', label: 'Total', num: true }, { key: 'fsa_amount', label: 'FSA', num: true }, { key: 'agency_amount', label: 'Agency', num: true }] },
  'agency-leaderboard': { name: 'Agency leaderboard', view: 'v_agency_leaderboard', columns: [{ key: 'premium_rank', label: '#', num: true }, { key: 'agency_name', label: 'Agency' }, { key: 'owner_name', label: 'Owner' }, { key: 'status', label: 'Status' }, { key: 'ytd_placed_premium', label: 'YTD premium', num: true }, { key: 'ytd_referrals', label: 'YTD referrals', num: true }, { key: 'life_penetration_pct', label: 'Life pen. %', num: true }] },
  'referral-analytics': { name: 'Referral analytics', view: 'v_referral_analytics', columns: [{ key: 'engagement', label: 'Engagement' }, { key: 'status', label: 'Status' }, { key: 'referral_count', label: 'Referrals', num: true }, { key: 'converted_count', label: 'Converted', num: true }] },
}

// Report view. Renders a DB-derived view; audit logs generation/export in the API.
export default async function ReportViewPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const def = REPORTS[params.id]
  if (!def) {
    // Conversion / cross-sell / production reports point at their analytics pages.
    const redirects: Record<string, string> = { conversion: '/app/conversions/analytics', 'cross-sell': '/app/cross-sell/analytics', production: '/app/executive/production' }
    const to = redirects[params.id]
    if (to) {
      return (
        <ReportShell title={params.id} description="This report opens in its module.">
          <p className="text-sm"><Link href={to} className="text-primary hover:underline">Open the {params.id} report →</Link></p>
        </ReportShell>
      )
    }
    notFound()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await load<Record<string, any>[]>((db) => db.from(def.view).select('*').limit(500), [])

  return (
    <ReportShell title={def.name} description="Derived from the data. Export CSV/PDF (audit-logged).">
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No data" description="This report has no rows yet." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow>{def.columns.map((c) => (<TableHead key={c.key} className={c.num ? 'text-right' : ''}>{c.label}</TableHead>))}</TableRow></TableHeader>
            <TableBody>
              {rows.data.map((row, i) => (
                <TableRow key={i}>
                  {def.columns.map((c) => (
                    <TableCell key={c.key} className={c.num ? 'text-right' : ''}>
                      {c.num ? (
                        MONEY_KEYS.has(c.key) ? (
                          <Money value={Number(row[c.key] ?? 0)} />
                        ) : (
                          <Numeric>{Number(row[c.key] ?? 0).toLocaleString('en-US')}</Numeric>
                        )
                      ) : (
                        String(row[c.key] ?? '—')
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ReportShell>
  )
}
