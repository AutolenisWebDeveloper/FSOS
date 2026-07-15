import { Check, CircleDashed, Ban } from 'lucide-react'
import { SettingsShell, SettingsSection } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const dynamic = 'force-dynamic'

// Super · Permissions (A10). READ-ONLY reference of the RBAC matrix. The runtime
// source of truth is code (lib/auth/rbac + the assert helpers), RLS, and the
// middleware gate — this page summarizes a few key entities for reviewers. It is
// edited here in a later phase.

// V = View, C = Create, E = Edit, D = Delete. G granted · C conditional · X denied.
// Design system bans emoji: grants render as lucide icons with status color.
type Grant = 'G' | 'C' | 'X'
interface EntityRow {
  entity: string
  fsa: [Grant, Grant, Grant, Grant]
  admin: [Grant, Grant, Grant, Grant]
  compliance: [Grant, Grant, Grant, Grant]
  agency_owner: [Grant, Grant, Grant, Grant]
}

const MATRIX: EntityRow[] = [
  { entity: 'Agency', fsa: ['G', 'G', 'G', 'C'], admin: ['G', 'G', 'G', 'X'], compliance: ['G', 'X', 'X', 'X'], agency_owner: ['C', 'X', 'X', 'X'] },
  { entity: 'Referral', fsa: ['G', 'G', 'G', 'C'], admin: ['G', 'G', 'G', 'X'], compliance: ['G', 'X', 'X', 'X'], agency_owner: ['C', 'G', 'X', 'X'] },
  { entity: 'Household', fsa: ['G', 'G', 'G', 'C'], admin: ['G', 'G', 'G', 'X'], compliance: ['G', 'X', 'X', 'X'], agency_owner: ['X', 'X', 'X', 'X'] },
  { entity: 'Opportunity', fsa: ['G', 'G', 'G', 'C'], admin: ['G', 'C', 'C', 'X'], compliance: ['G', 'X', 'X', 'X'], agency_owner: ['C', 'X', 'X', 'X'] },
  { entity: 'Commission', fsa: ['G', 'G', 'G', 'C'], admin: ['G', 'C', 'C', 'X'], compliance: ['G', 'X', 'X', 'X'], agency_owner: ['X', 'X', 'X', 'X'] },
  { entity: 'AI Ops', fsa: ['G', 'C', 'C', 'X'], admin: ['G', 'X', 'X', 'X'], compliance: ['G', 'X', 'C', 'X'], agency_owner: ['X', 'X', 'X', 'X'] },
]

const GRANT_META: Record<Grant, { label: string; className: string }> = {
  G: { label: 'granted', className: 'text-status-won' },
  C: { label: 'conditional', className: 'text-status-pending' },
  X: { label: 'denied', className: 'text-status-lost/70' },
}

function GrantGlyph({ g }: { g: Grant }) {
  const Icon = g === 'G' ? Check : g === 'C' ? CircleDashed : Ban
  return <Icon className={`h-4 w-4 ${GRANT_META[g].className}`} strokeWidth={1.75} aria-hidden />
}

function GrantCell({ grants }: { grants: [Grant, Grant, Grant, Grant] }) {
  const labels = ['View', 'Create', 'Edit', 'Delete']
  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={grants.map((g, i) => `${labels[i]} ${GRANT_META[g].label}`).join(', ')}
    >
      {grants.map((g, i) => (
        <GrantGlyph key={i} g={g} />
      ))}
    </span>
  )
}

export default function SuperPermissionsPage() {
  return (
    <SettingsShell title="Permissions" description="RBAC matrix reference — grants by entity and role.">
      <SettingsSection
        title="Access matrix"
        description="Columns show V / C / E / D (View · Create · Edit · Delete). Icons: granted · conditional · denied."
      >
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><GrantGlyph g="G" /> Granted</span>
          <span className="inline-flex items-center gap-1.5"><GrantGlyph g="C" /> Conditional</span>
          <span className="inline-flex items-center gap-1.5"><GrantGlyph g="X" /> Denied</span>
        </div>
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
