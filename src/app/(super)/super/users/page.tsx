import { Users } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// Super · Users (A2). Lists provisioned users and their assigned roles. A user may
// hold multiple user_roles rows, so we group by user_id. Invite/provisioning flow
// lives elsewhere — this is a read-only roster.
export default async function SuperUsersPage() {
  const roles = await load<{ user_id: string; role: string }[]>(
    (db) => db.from('user_roles').select('user_id, role').order('user_id', { ascending: true }),
    [],
  )

  let body: React.ReactNode
  if (!roles.ok) {
    body =
      roles.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load users." />
      ) : (
        <ErrorState description={roles.message} />
      )
  } else if (roles.data.length === 0) {
    body = (
      <EmptyState
        icon={Users}
        title="No users provisioned yet"
        description="Users appear here once provisioned. The invite flow lives elsewhere."
      />
    )
  } else {
    const byUser = new Map<string, string[]>()
    for (const r of roles.data) {
      const list = byUser.get(r.user_id) ?? []
      if (!list.includes(r.role)) list.push(r.role)
      byUser.set(r.user_id, list)
    }
    const users = Array.from(byUser.entries())
    body = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User ID</TableHead>
              <TableHead>Roles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(([userId, userRoles]) => (
              <TableRow key={userId}>
                <TableCell className="font-mono text-xs">{userId}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {userRoles.map((role) => (
                      <Badge key={role} variant="secondary">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <ListShell
      title="Users"
      description="Provisioned users and their assigned roles."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Users' }]}
    >
      {body}
    </ListShell>
  )
}
