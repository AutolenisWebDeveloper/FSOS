import { SettingsShell, SettingsSection } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const dynamic = 'force-dynamic'

// Super · Permissions (A10). READ-ONLY reference of the RBAC matrix. The runtime
// source of truth is code (lib/auth/rbac + the assert helpers), RLS, and the
// middleware gate — this page summarizes a few key entities for reviewers. It is
// edited here in a later phase.

// V = View, C = Create, E = Edit, D = Delete. ✅ granted · 🔶 conditional · 🚫 denied.
type Grant = '✅' | '🔶' | '🚫'
interface EntityRow {
  entity: string
  fsa: [Grant, Grant, Grant, Grant]
  admin: [Grant, Grant, Grant, Grant]
  compliance: [Grant, Grant, Grant, Grant]
  agency_owner: [Grant, Grant, Grant, Grant]
}

const MATRIX: EntityRow[] = [
  { entity: 'Agency', fsa: ['✅', '✅', '✅', '🔶'], admin: ['✅', '✅', '✅', '🚫'], compliance: ['✅', '🚫', '🚫', '🚫'], agency_owner: ['🔶', '🚫', '🚫', '🚫'] },
  { entity: 'Referral', fsa: ['✅', '✅', '✅', '🔶'], admin: ['✅', '✅', '✅', '🚫'], compliance: ['✅', '🚫', '🚫', '🚫'], agency_owner: ['🔶', '✅', '🚫', '🚫'] },
  { entity: 'Household', fsa: ['✅', '✅', '✅', '🔶'], admin: ['✅', '✅', '✅', '🚫'], compliance: ['✅', '🚫', '🚫', '🚫'], agency_owner: ['🚫', '🚫', '🚫', '🚫'] },
  { entity: 'Opportunity', fsa: ['✅', '✅', '✅', '🔶'], admin: ['✅', '🔶', '🔶', '🚫'], compliance: ['✅', '🚫', '🚫', '🚫'], agency_owner: ['🔶', '🚫', '🚫', '🚫'] },
  { entity: 'Commission', fsa: ['✅', '✅', '✅', '🔶'], admin: ['✅', '🔶', '🔶', '🚫'], compliance: ['✅', '🚫', '🚫', '🚫'], agency_owner: ['🚫', '🚫', '🚫', '🚫'] },
  { entity: 'AI Ops', fsa: ['✅', '🔶', '🔶', '🚫'], admin: ['✅', '🚫', '🚫', '🚫'], compliance: ['✅', '🚫', '🔶', '🚫'], agency_owner: ['🚫', '🚫', '🚫', '🚫'] },
]

function GrantCell({ grants }: { grants: [Grant, Grant, Grant, Grant] }) {
  const labels = ['View', 'Create', 'Edit', 'Delete']
  return (
    <span className="whitespace-nowrap font-mono text-sm" aria-label={grants.map((g, i) => `${labels[i]} ${g === '✅' ? 'granted' : g === '🔶' ? 'conditional' : 'denied'}`).join(', ')}>
      {grants.join(' ')}
    </span>
  )
}

export default function SuperPermissionsPage() {
  return (
    <SettingsShell title="Permissions" description="RBAC matrix reference — grants by entity and role.">
      <SettingsSection
        title="Access matrix"
        description="Columns show V / C / E / D (View · Create · Edit · Delete). ✅ granted · 🔶 conditional · 🚫 denied."
      >
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead>
                <TableHead>FSA</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Agency Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MATRIX.map((row) => (
                <TableRow key={row.entity}>
                  <TableCell className="font-medium">{row.entity}</TableCell>
                  <TableCell><GrantCell grants={row.fsa} /></TableCell>
                  <TableCell><GrantCell grants={row.admin} /></TableCell>
                  <TableCell><GrantCell grants={row.compliance} /></TableCell>
                  <TableCell><GrantCell grants={row.agency_owner} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Source of truth for RBAC; edited here in a later phase. Enforced by middleware + RLS + lib/auth.
        </p>
      </SettingsSection>
    </SettingsShell>
  )
}
