import { SettingsShell, SettingsSection, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { FfsContactForm, type ExistingContact } from '@/components/super/FfsContactForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ContactRow extends ExistingContact {
  slug: string
}

// Legacy-port FFS key contacts (A10). Config-driven directory that feeds the sidebar
// QUICK ACCESS panel (design-system.md §5.3C). Never hard-coded.
export default async function FfsContactsConfigPage() {
  const contacts = await load<ContactRow[]>(
    (db) => db.from('ffs_contacts').select('*').order('sort', { ascending: true }).order('role', { ascending: true }),
    [],
  )

  return (
    <SettingsShell
      title="FFS Key Contacts"
      description="Quick-access directory shown in the sidebar. Config-driven — edit here, not in code."
    >
      <SettingsSection title="Directory" description="Active contacts appear in the sidebar QUICK ACCESS panel, in sort order.">
        {!contacts.ok ? (
          <ErrorState description={contacts.kind === 'not_configured' ? 'Database not configured.' : contacts.message} />
        ) : contacts.data.length === 0 ? (
          <EmptyState title="No contacts configured" description="Add the first FFS contact below." />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.role}</TableCell>
                    <TableCell className="text-muted-foreground">{c.name ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{c.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{c.hours ?? '—'}</TableCell>
                    <TableCell>
                      {c.active ? <Badge variant="active">active</Badge> : <Badge variant="draft">hidden</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Add / edit a contact" description="Blank name is fine for a desk line. Uncheck Active to hide without deleting.">
        <FfsContactForm contacts={contacts.ok ? contacts.data : []} />
      </SettingsSection>
    </SettingsShell>
  )
}
