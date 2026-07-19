import { ListShell } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ROLES } from '@/lib/auth/rbac'

export const dynamic = 'force-dynamic'

// Super · Roles (A2). Reference list of the fixed RBAC role constants with a
// one-line description each. Static data — the role set is defined in code.
const ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin: 'Platform owner',
  fsa: 'Financial services agent',
  licensed_staff: 'Delegated licensed staff',
  admin: 'Back-office admin',
  ops: 'Operations',
  case_manager: 'Case manager',
  compliance: 'Compliance reviewer',
  supervisor: 'Supervisory',
  agency_owner: 'Farmers agency owner',
  client: 'End client',
}

export default function SuperRolesPage() {
  return (
    <ListShell
      title="Roles"
      description="The fixed role set enforced across every portal, layout guard, and RLS policy."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Roles' }]}
    >
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROLES.map((role) => (
              <TableRow key={role}>
                <TableCell>
                  <Badge variant="secondary">{role}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{ROLE_DESCRIPTIONS[role] ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ListShell>
  )
}
