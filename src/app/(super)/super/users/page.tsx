import { Users } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { CreateUserForm } from '@/components/super/CreateUserForm'
import { UserRowActions } from '@/components/super/UserRowActions'
import { listPortalUsers } from '@/lib/services/users'
import { getServerSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// Super · Users (A2). Provision new portal users (assign roles + email them a
// single-use password-setup link) and see the roster of provisioned users with their
// roles and activation status. Auth user + user_roles are joined in listPortalUsers().
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US')
}

export default async function SuperUsersPage() {
  const [result, session] = await Promise.all([listPortalUsers(), getServerSession()])
  const currentUserId = session?.userId ?? null

  let roster: React.ReactNode
  if (!result.ok) {
    roster =
      result.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load users." />
      ) : (
        <ErrorState description="We couldn’t load the user roster. Please try again." />
      )
  } else if (result.users.length === 0) {
    roster = (
      <EmptyState
        icon={Users}
        title="No users provisioned yet"
        description="Create the first user above — they’ll receive a secure link to set their password."
      />
    )
  } else {
    roster = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  {u.email ? (
                    <span className="font-medium">{u.email}</span>
                  ) : (
                    <Numeric className="text-xs text-muted-foreground">{u.id}</Numeric>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 ? (
                      <span className="text-xs text-muted-foreground">— none —</span>
                    ) : (
                      u.roles.map((role) => (
                        <Badge key={role} variant="secondary">
                          {role}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.status === 'active' ? 'won' : 'pending'}>
                    {u.status === 'active' ? 'active' : 'pending setup'}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Numeric className="text-xs">{fmtDate(u.createdAt)}</Numeric>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Numeric className="text-xs">{fmtDate(u.lastSignInAt)}</Numeric>
                </TableCell>
                <TableCell>
                  <UserRowActions
                    user={{ id: u.id, email: u.email, roles: u.roles, securitiesScope: u.securitiesScope }}
                    isSelf={u.id === currentUserId}
                  />
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
      description="Provision portal users and manage their assigned roles. New users receive a single-use link to set their own password."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Users' }]}
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Create user</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateUserForm />
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Provisioned users</h2>
          {roster}
        </section>
      </div>
    </ListShell>
  )
}
