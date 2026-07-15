import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { agencyIdsFor } from '@/lib/portal/scope'
import { PARTNER_ALLOWLIST, selectFor, pickAllowed } from '@/lib/portal/allowlist'

export const dynamic = 'force-dynamic'

// P-4 My Referrals (A2). Status only — no securities detail, no client PII beyond
// what the owner submitted. Column-allowlisted by construction.
export default async function PartnerReferralsPage() {
  const session = await getServerSession()
  const agencyIds = session ? await agencyIdsFor(session) : []
  let rows: { id: string; referred_name: string | null; engagement: string; status: string; received_at: string }[] = []
  let error: string | null = null
  if (agencyIds.length) {
    try {
      const { data } = await getDb().from('referrals').select(selectFor(PARTNER_ALLOWLIST, 'referrals')).in('referring_agency_id', agencyIds).is('deleted_at', null).order('received_at', { ascending: false })
      rows = pickAllowed(PARTNER_ALLOWLIST, 'referrals', (data ?? []) as never[]) as typeof rows
    } catch (e) { error = e instanceof Error ? e.message : 'Failed' }
  }

  return (
    <ListShell title="My Referrals" description="Progress on the clients you referred. Status only — never the FSA's private notes." breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'My Referrals' }]} actions={<Button asChild><Link href="/partner/refer">Submit referral</Link></Button>}>
      {error ? (
        <ErrorState description={error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No referrals yet" description="Submit your first referral to see its progress here." action={<Button asChild><Link href="/partner/refer">Submit a referral</Link></Button>} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Referred</TableHead><TableHead>Engagement</TableHead><TableHead>Status</TableHead><TableHead>Received</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/partner/referrals/${r.id}`} className="font-medium text-primary hover:underline">{r.referred_name ?? 'Referral'}</Link></TableCell>
                  <TableCell className="text-muted-foreground">{r.engagement?.replace(/_/g, ' ')}</TableCell>
                  <TableCell><Badge variant={r.status === 'converted' ? 'won' : r.status === 'declined' ? 'lost' : 'active'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.received_at ? new Date(r.received_at).toLocaleDateString('en-US') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
