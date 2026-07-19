import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { MonoLabel, Money } from '@/components/ui/typography'
import { SecuritiesChip } from '@/components/ui/securities'
import { load } from '@/lib/data/query'
import { OpraTrackButton } from '@/components/app/OpraTrackButton'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OPRA eligibility — households with exactly one active policy that are not yet
// tracked. This is the defining "eligible for OPRA transfer" list. Add one to
// start tracking it in the OPRA Transfer Center.
interface EligibleRow {
  household_id: string
  primary_name: string | null
  agency_name: string | null
  policy_id: string | null
  annual_premium: number | string | null
  transfer_date: string | null
  is_security: boolean
}

export default async function OpraEligiblePage() {
  const res = await load<EligibleRow[]>(
    (db) =>
      db
        .from('v_opra_eligible')
        .select('household_id, primary_name, agency_name, policy_id, annual_premium, transfer_date, is_security')
        .order('primary_name', { ascending: true })
        .limit(500),
    [],
  )

  const backButton = (
    <Button asChild variant="outline">
      <Link href="/app/opra">OPRA Center</Link>
    </Button>
  )

  if (!res.ok) {
    return (
      <ListShell title="OPRA — Eligible households" description="One active policy, not yet tracked." actions={backButton}>
        {res.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set the Supabase environment variables to load eligible households." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  return (
    <ListShell
      title="OPRA — Eligible households"
      description="Households with exactly one active policy that aren't tracked yet. Add one to begin transfer tracking."
      actions={backButton}
    >
      {res.data.length === 0 ? (
        <EmptyState title="No eligible households" description="Every one-policy household is already tracked, or none exist yet." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Household</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Policy date</TableHead>
                <TableHead className="text-right">Annual premium</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.data.map((r) => (
                <TableRow key={r.household_id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/app/households/${r.household_id}`} className="hover:underline">
                        {r.primary_name ?? 'Unknown household'}
                      </Link>
                      {r.is_security ? <SecuritiesChip /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.agency_name ?? '—'}</TableCell>
                  <TableCell>
                    <MonoLabel>{r.transfer_date ?? '—'}</MonoLabel>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={Number(r.annual_premium ?? 0)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <OpraTrackButton householdId={r.household_id} policyId={r.policy_id ?? undefined} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
