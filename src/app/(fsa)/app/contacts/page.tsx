import Link from 'next/link'
import { Plus, Upload, Contact as ContactIcon, RefreshCw } from 'lucide-react'
import { ListShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { ContactList, type ContactRow } from '@/components/app/ContactList'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Contact Center — the centralized, App-B-stored contact directory. Manual add +
// multi-format bulk import land here; each contact is categorized, taggable, and
// fully manageable (edit / archive / delete on its detail page).
interface Row extends ContactRow {}

export default async function ContactCenterPage() {
  const [res, dupes] = await Promise.all([
    load<Row[]>(
      (db) =>
        db
          .from('contacts')
          .select('id, full_name, email, phone, company, contact_type, tags, status, created_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1000),
      [],
    ),
    load<{ match_key: string }[]>((db) => db.from('v_contact_duplicates').select('match_key'), []),
  ])

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm"><Link href="/app/contacts/new"><Plus className="h-4 w-4" /> Add contact</Link></Button>
      <Button asChild size="sm" variant="outline"><Link href="/app/contacts/import"><Upload className="h-4 w-4" /> Import file</Link></Button>
      <Button asChild size="sm" variant="outline"><Link href="/app/contacts/upload"><RefreshCw className="h-4 w-4" /> Sync to GHL</Link></Button>
      <Button asChild size="sm" variant="ghost"><Link href="/app/contacts/ffs"><ContactIcon className="h-4 w-4" /> FFS Contacts</Link></Button>
    </div>
  )

  if (!res.ok) {
    return (
      <ListShell title="Contact Center" description="Your centralized contact directory, stored in App B." actions={actions} breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts' }]}>
        {res.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set the Supabase environment variables to load contacts." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const rows = res.data
  const active = rows.filter((r) => r.status === 'active').length
  const owners = rows.filter((r) => r.contact_type === 'agency_owner').length
  const dupCount = dupes.ok ? dupes.data.length : 0

  return (
    <ListShell
      title="Contact Center"
      description="Your centralized contact directory — stored securely in App B, categorized, tagged, and fully manageable."
      actions={actions}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts' }]}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Contacts" value={active} />
        <StatTile label="Agency owners" value={owners} />
        <StatTile label="Total records" value={rows.length} />
        <StatTile label="Possible duplicates" value={dupCount} hint={dupCount ? 'Shared email/phone' : undefined} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ContactIcon}
          title="No contacts yet"
          description="Add a contact manually, or import a CSV, TSV, Excel, or JSON file — everything is stored here in App B."
        />
      ) : (
        <ContactList rows={rows} />
      )}
    </ListShell>
  )
}
