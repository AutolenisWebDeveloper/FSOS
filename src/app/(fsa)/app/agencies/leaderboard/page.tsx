import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { ReportShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Money, Numeric } from '@/components/ui/typography'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// P2 Agency leaderboard (A11 ReportShell). Ranked by YTD placed premium.
interface LeaderboardRow {
  id: string
  agency_name: string | null
  owner_name: string | null
  ytd_placed_premium: number | null
  ytd_referrals: number | null
  life_penetration_pct: number | null
  premium_rank: number | null
  referral_rank: number | null
}

const money = (n: number | null | undefined) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export default async function AgencyLeaderboardPage() {
  const res = await load<LeaderboardRow[]>(
    (db) =>
      db
        .from('v_agency_leaderboard')
        .select('id, agency_name, owner_name, ytd_placed_premium, ytd_referrals, life_penetration_pct, premium_rank, referral_rank')
        .order('premium_rank', { ascending: true, nullsFirst: false }),
    [],
  )

  if (!res.ok) {
    return (
      <ReportShell title="Agency Leaderboard">
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </ReportShell>
    )
  }

  const rows = res.data
  if (rows.length === 0) {
    return (
      <ReportShell title="Agency Leaderboard" description="Ranked agency production for the year to date.">
        <EmptyState icon={Trophy} title="No ranked agencies yet" description="Once agencies have placed premium or referrals, they appear here." />
      </ReportShell>
    )
  }

  const topPremium = [...rows].sort((a, b) => (a.premium_rank ?? Infinity) - (b.premium_rank ?? Infinity))[0]
  const topReferrals = [...rows].sort((a, b) => (a.referral_rank ?? Infinity) - (b.referral_rank ?? Infinity))[0]

  return (
    <ReportShell title="Agency Leaderboard" description="Ranked by YTD placed premium. Referral and life-penetration signals shown alongside.">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="Top premium"
          value={topPremium?.agency_name ?? '—'}
          href={topPremium ? `/app/agencies/${topPremium.id}` : '/app/agencies'}
          hint={topPremium ? money(topPremium.ytd_placed_premium) : undefined}
        />
        <StatTile
          label="Top referrals"
          value={topReferrals?.agency_name ?? '—'}
          href={topReferrals ? `/app/agencies/${topReferrals.id}` : '/app/agencies'}
          hint={topReferrals ? `${topReferrals.ytd_referrals ?? 0} referrals` : undefined}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Rank</TableHead>
              <TableHead>Agency</TableHead>
              <TableHead className="text-right">YTD premium</TableHead>
              <TableHead className="text-right">Referrals</TableHead>
              <TableHead className="text-right">Life penetration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold"><Numeric>{r.premium_rank ?? '—'}</Numeric></TableCell>
                <TableCell>
                  <Link href={`/app/agencies/${r.id}`} className="font-medium text-primary hover:underline">
                    {r.agency_name ?? 'Agency'}
                  </Link>
                  {r.owner_name ? <div className="text-xs text-muted-foreground">{r.owner_name}</div> : null}
                </TableCell>
                <TableCell className="text-right"><Money value={r.ytd_placed_premium} /></TableCell>
                <TableCell className="text-right"><Numeric>{r.ytd_referrals ?? 0}</Numeric></TableCell>
                <TableCell className="text-right"><Numeric>{Number(r.life_penetration_pct ?? 0).toFixed(1)}%</Numeric></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ReportShell>
  )
}
