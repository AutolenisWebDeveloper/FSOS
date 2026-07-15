import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Numeric, Money } from '@/components/ui/typography'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// P2 Policy lapse-risk (A2 ListShell). Informational only — any outreach is routed
// through the comms gate and securities-flagged rows are excluded from automation.
interface LapseRow {
  policy_id: string
  household_id: string | null
  primary_name: string | null
  policy_number: string | null
  status: string | null
  premium: number | null
  renewal_date: string | null
  is_security: boolean | null
  days_to_renewal: number | null
  risk_band: string | null
}

// Risk-band → Badge variant mapping per spec.
const RISK_VARIANT: Record<string, 'lost' | 'blocked' | 'pending' | 'draft'> = {
  critical: 'blocked',
  lapsed: 'lost',
  non_renewed: 'lost',
  high: 'pending',
  watch: 'draft',
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Policies', href: '/app/policies' },
  { label: 'Lapse risk' },
]

export default async function PolicyLapseRiskPage() {
  const res = await load<LapseRow[]>(
    (db) =>
      db
        .from('v_policy_lapse_risk')
        .select('policy_id, household_id, primary_name, policy_number, status, premium, renewal_date, is_security, days_to_renewal, risk_band')
        .order('days_to_renewal', { ascending: true, nullsFirst: false }),
    [],
  )

  if (!res.ok) {
    return (
      <ListShell title="Policy Lapse Risk" breadcrumb={breadcrumb}>
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </ListShell>
    )
  }

  // risk_band is a computed column; filter out 'ok' rows in JS.
  const rows = res.data.filter((r) => r.risk_band !== 'ok')

  const note = (
    <Card className="border-status-assumption/40 bg-status-assumption/10">
      <CardContent className="p-4 text-sm text-status-assumption">
        Lapse-risk is informational. Any outreach goes through the communications gate (consent, quiet hours, DNC,
        approved template) and excludes securities-flagged policies, which are handled by a human / FFS.
      </CardContent>
    </Card>
  )

  if (rows.length === 0) {
    return (
      <ListShell title="Policy Lapse Risk" description="In-force policies nearing renewal or already lapsed/non-renewed." breadcrumb={breadcrumb}>
        {note}
        <div className="mt-4">
          <EmptyState icon={CheckCircle2} title="No at-risk policies" description="Every in-force policy is outside the lapse-risk window." />
        </div>
      </ListShell>
    )
  }

  return (
    <ListShell title="Policy Lapse Risk" description="In-force policies nearing renewal or already lapsed/non-renewed." breadcrumb={breadcrumb}>
      {note}
      <div className="mt-4 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Household</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead className="text-right">Premium</TableHead>
              <TableHead>Renewal</TableHead>
              <TableHead className="text-right">Days to renewal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.policy_id} className={r.is_security ? securitiesRowClass : undefined}>
                <TableCell>
                  {r.household_id ? (
                    <Link href={`/app/households/${r.household_id}`} className="font-medium text-primary hover:underline">
                      {r.primary_name ?? 'Household'}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.primary_name ?? '—'}</span>
                  )}
                  {r.is_security ? (
                    <div className="mt-1">
                      <SecuritiesChip />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Link href={`/app/policies/${r.policy_id}`} className="text-primary hover:underline">
                    {r.policy_number ?? 'Policy'}
                  </Link>
                  {r.status ? <div className="text-xs capitalize text-muted-foreground">{r.status.replace(/_/g, ' ')}</div> : null}
                </TableCell>
                <TableCell>
                  <Badge variant={RISK_VARIANT[r.risk_band ?? ''] ?? 'draft'}>{(r.risk_band ?? 'unknown').replace(/_/g, ' ')}</Badge>
                </TableCell>
                <TableCell className="text-right"><Money value={r.premium} /></TableCell>
                <TableCell>
                  <Numeric className="text-muted-foreground">
                    {r.renewal_date ? new Date(r.renewal_date).toLocaleDateString('en-US') : '—'}
                  </Numeric>
                </TableCell>
                <TableCell className="text-right"><Numeric>{r.days_to_renewal ?? '—'}</Numeric></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ListShell>
  )
}
