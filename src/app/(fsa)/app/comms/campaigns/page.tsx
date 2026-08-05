import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { TimeCell } from '@/components/ui/time'
import { smsA2pApproved } from '@/lib/comms/a2p'

export const dynamic = 'force-dynamic'

// OS-12 Campaigns (A2).
export default async function CampaignsPage() {
  const campaigns = await load<{ id: string; name: string; channel: string | null; category: string | null; status: string; activated_at: string | null }[]>(
    (db) => db.from('comm_campaigns').select('id, name, channel, category, status, activated_at').is('archived_at', null).order('created_at', { ascending: false }),
    [],
  )
  // Slice 7 — SMS is staged until A2P 10DLC approval; flag SMS campaigns so the FSA knows
  // they will hold (queued, not sent) until the campaign is approved.
  const smsStaged = !smsA2pApproved()

  return (
    <ListShell title="Campaigns" description="No campaign sends without an approved template + a passing gate." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Campaigns' }]} actions={<Button asChild><Link href="/app/comms/campaigns/new">New campaign</Link></Button>}>
      {!campaigns.ok ? (
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      ) : campaigns.data.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Build a campaign from an approved template." action={<Button asChild><Link href="/app/comms/campaigns/new">New campaign</Link></Button>} />
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Activated</TableHead></TableRow></TableHeader>
          <TableBody>
            {campaigns.data.map((c) => (
              <TableRow key={c.id}>
                <TableCell><Link href={`/app/comms/campaigns/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link></TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge variant="outline">{c.channel ?? '—'}</Badge>
                    {c.channel === 'sms' && smsStaged && (
                      <Badge variant="pending" title="SMS holds (queued, not sent) until A2P 10DLC approval">Pending A2P</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell><Badge variant={c.status === 'active' ? 'active' : c.status === 'completed' ? 'won' : c.status === 'paused' ? 'pending' : 'draft'}>{c.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground"><TimeCell value={c.activated_at} precision="date" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListShell>
  )
}
