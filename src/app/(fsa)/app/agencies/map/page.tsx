import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { DashboardShell, StatTile, ErrorState, EmptyState, Breadcrumb } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Money } from '@/components/ui/typography'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// P2 Agency geographic distribution (A1-map). No map SDK is available, so agencies
// are grouped by `status` as a labeled placeholder for a future geo integration.
interface AgencyRow {
  id: string
  agency_name: string | null
  owner_name: string | null
  status: string | null
  ytd_placed_premium: number | null
}

const STATUS_VARIANT: Record<string, 'active' | 'draft' | 'lost' | 'pending'> = {
  producing: 'active',
  active: 'active',
  prospect: 'draft',
  dormant: 'pending',
  terminated: 'lost',
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Agencies', href: '/app/agencies' },
  { label: 'Map' },
]

export default async function AgencyMapPage() {
  const res = await load<AgencyRow[]>(
    (db) => db.from('agency_partnerships').select('id, agency_name, owner_name, status, ytd_placed_premium').is('deleted_at', null),
    [],
  )

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={breadcrumb} />
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </div>
    )
  }

  const rows = res.data
  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={breadcrumb} />
        <EmptyState icon={MapPin} title="No agency partnerships yet" description="Add an agency partnership to see it on the distribution view." />
      </div>
    )
  }

  const producing = rows.filter((r) => r.status === 'producing' || r.status === 'active').length
  const dormant = rows.filter((r) => r.status === 'dormant').length

  // Group by status (geo location is not modeled; this is the labeled placeholder).
  const groups = new Map<string, AgencyRow[]>()
  for (const r of rows) {
    const key = r.status ?? 'unknown'
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }
  const groupEntries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="space-y-6">
      <Breadcrumb items={breadcrumb} />
      <DashboardShell title="Agency Distribution" description="Grouped by partnership status. Geographic mapping is a labeled placeholder — see the note below.">
        <StatTile label="Total agencies" value={rows.length} href="/app/agencies" />
        <StatTile label="Producing" value={producing} href="/app/agencies" />
        <StatTile label="Dormant" value={dormant} href="/app/agencies" />
      </DashboardShell>

      <Card className="border-status-assumption/40 bg-status-assumption/10">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-status-assumption">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Geo-mapping placeholder. True geographic distribution requires an address/region field on the agency
            partnership plus a maps integration (config default — verify). Until then, agencies are grouped by status.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {groupEntries.map(([status, list]) => (
          <Card key={status}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base capitalize">
                {status.replace(/_/g, ' ')}
                <Badge variant={STATUS_VARIANT[status] ?? 'draft'}>{list.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agency</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead className="text-right">YTD placed premium</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link href={`/app/agencies/${r.id}`} className="font-medium text-primary hover:underline">
                            {r.agency_name ?? 'Agency'}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.owner_name ?? '—'}</TableCell>
                        <TableCell className="text-right"><Money value={r.ytd_placed_premium} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
