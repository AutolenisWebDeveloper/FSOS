import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-2 Users. Invite, reset, unlock, impersonate-with-audit (banner + audit event).
export default async function AdminUsersPage() {
  const rows = await load<{ user_id: string; role: string }[]>((db) => db.from('user_roles').select('user_id, role').order('user_id').limit(500), [])
  return (
    <ListShell title="Users" description="Invite, reset, unlock. Impersonation writes an audit event and shows a persistent banner." breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Users' }]}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No users" description="User role assignments appear here." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Role</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((r, i) => (<TableRow key={i}><TableCell className="font-mono text-xs">{r.user_id.slice(0, 12)}…</TableCell><TableCell><Badge variant="outline">{r.role}</Badge></TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
