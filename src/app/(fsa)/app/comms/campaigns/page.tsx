import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-12 Campaigns (A2).
export default async function CampaignsPage() {
  const campaigns = await load<{ id: string; name: string; channel: string | null; category: string | null; status: string; activated_at: string | null }[]>(
    (db) => db.from('comm_campaigns').select('id, name, channel, category, status, activated_at').is('archived_at', null).order('created_at', { ascending: false }),
    [],
  )

  return (
    <ListShell title="Campaigns" description="No campaign sends without an approved template + a passing gate." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Campaigns' }]} actions={<Button asChild><Link href="/app/comms/campaigns/new">New campaign</Link></Button>}>
      {!campaigns.ok ? (
        <ErrorState description={campaigns.kind === 'not_configured' ? 'Database not configured.' : campaigns.message} />
      ) : campaigns.data.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Build a campaign from an approved template." action={<Button asChild><Link href="/app/comms/campaigns/new">New campaign</Link></Button>} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Activated</TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/app/comms/campaigns/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link></TableCell>
                  <TableCell><Badge variant="outline">{c.channel ?? '—'}</Badge></TableCell>
                  <TableCell><Badge variant={c.status === 'active' ? 'active' : c.status === 'completed' ? 'won' : c.status === 'paused' ? 'pending' : 'draft'}>{c.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{c.activated_at ? new Date(c.activated_at).toLocaleDateString('en-US') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
