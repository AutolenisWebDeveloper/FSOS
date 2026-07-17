import Link from 'next/link'
import { ListShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { OpraTransferList, type OpraTransferRow } from '@/components/app/OpraTransferList'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OPRA Transfer Center (App A → App B parity). One-policy households eligible for
// an OPRA transfer/review, tracked contact → appointment → review → transfer.
// Rebuilt natively on the household spine; securities-flagged records are surfaced
// read-only and never enrolled in automated outreach (§2.1).
interface Row {
  id: string
  household_id: string
  policy_id: string | null
  referring_agency_id: string | null
  transfer_date: string | null
  annual_premium: number | string | null
  contacted: boolean
  appt_scheduled: boolean
  review_complete: boolean
  transferred: boolean
  status: string
  is_security: boolean
  households: { primary_name: string } | null
}

export default async function OpraCenterPage() {
  const res = await load<Row[]>(
    (db) =>
      db
        .from('opra_transfers')
        .select(
          'id, household_id, policy_id, referring_agency_id, transfer_date, annual_premium, contacted, appt_scheduled, review_complete, transferred, status, is_security, households(primary_name), agency_partnerships(agency_name)',
        )
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
    [],
  )

  const newButton = (
    <Button asChild variant="outline">
      <Link href="/app/opra/eligible">Eligible households</Link>
    </Button>
  )

  if (!res.ok) {
    return (
      <ListShell title="OPRA Transfer Center" description="One-policy households eligible for an OPRA transfer." actions={newButton}>
        {res.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set the Supabase environment variables to load OPRA cases." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const rows: OpraTransferRow[] = res.data.map((r) => {
    // supabase returns the joined agency as an object under agency_partnerships;
    // fall back gracefully whatever the shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ap = (r as any).agency_partnerships
    const agencyName = Array.isArray(ap) ? ap[0]?.agency_name ?? null : ap?.agency_name ?? null
    return {
      id: r.id,
      household_id: r.household_id,
      household_name: r.households?.primary_name ?? 'Unknown household',
      agency_name: agencyName,
      transfer_date: r.transfer_date,
      annual_premium: Number(r.annual_premium ?? 0),
      contacted: r.contacted,
      appt_scheduled: r.appt_scheduled,
      review_complete: r.review_complete,
      transferred: r.transferred,
      status: r.status,
      is_security: r.is_security,
    }
  })

  const total = rows.length
  const notContacted = rows.filter((r) => !r.contacted).length
  const apptBooked = rows.filter((r) => r.appt_scheduled).length
  const ready = rows.filter((r) => !r.review_complete && !r.transferred).length

  return (
    <ListShell
      title="OPRA Transfer Center"
      description="One-policy households eligible for an OPRA transfer · track contact, appointment, review, and transfer status."
      actions={newButton}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total OPRA cases" value={total} />
        <StatTile label="Not contacted" value={notContacted} hint="Needs first touch" />
        <StatTile label="Appointments booked" value={apptBooked} />
        <StatTile label="Ready to close" value={ready} />
      </div>
      <div className="mt-4">
        <OpraTransferList rows={rows} />
      </div>
    </ListShell>
  )
}
