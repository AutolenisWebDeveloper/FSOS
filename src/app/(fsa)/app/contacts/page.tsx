import Link from 'next/link'
import { Plus, Upload, Contact as ContactIcon, Filter } from 'lucide-react'
import { ListShell, StatTile, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { loadAll } from '@/lib/data/query'
import { getDb } from '@/lib/supabase/client'
import { loadContactConsolidationReport, type ContactConsolidationReport } from '@/lib/services/contactConsolidation'
import { ContactList, type ContactRow } from '@/components/app/ContactList'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Contact Center — the App-B-stored flat contact/lead directory (originated
// contacts from conversion/cross-sell/win-back imports) with its consolidation
// report. Distinct from the canonical CRM "Contacts" (the household aggregate at
// /app/households): kept as its own RELABELED surface rather than redirected, and
// reached from the unified Contacts workspace nav. Manual add + multi-format bulk
// import land here; each contact is categorized, taggable, and managed on its
// detail page.
interface Row extends ContactRow {}

export default async function ContactCenterPage() {
  const [res, report] = await Promise.all([
    loadAll<Row>(
      (db) =>
        db
          .from('contacts')
          .select('id, full_name, email, phone, company, contact_type, tags, status, created_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
    ),
    // Consolidation report degrades to an all-zero report on failure; guard the
    // getDb() config throw so an unconfigured DB still renders the not_configured
    // notice below (driven by `res`), never a crash.
    (async (): Promise<ContactConsolidationReport | null> => {
      try {
        return await loadContactConsolidationReport(getDb())
      } catch {
        return null
      }
    })(),
  ])

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm"><Link href="/app/contacts/new"><Plus className="h-4 w-4" /> Add contact</Link></Button>
      <Button asChild size="sm" variant="outline"><Link href="/app/uploads"><Upload className="h-4 w-4" /> Import</Link></Button>
      <Button asChild size="sm" variant="outline"><Link href="/app/contacts/segments"><Filter className="h-4 w-4" /> Segments</Link></Button>
    </div>
  )

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Contacts', href: '/app/households' },
    { label: 'Contact Center' },
  ]

  if (!res.ok) {
    return (
      <ListShell title="Contact Center" description="The App-B contact/lead directory — distinct from your CRM households." actions={actions} breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set the Supabase environment variables to load contacts." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const rows = res.data
  // Prefer the DB-side consolidation report; fall back to what the loaded rows can
  // show if the report view is unavailable (older DB without migration 070).
  const total = report?.total ?? rows.length
  const active = report?.active ?? rows.filter((r) => r.status === 'active').length
  // The enrollment-blocking orphan count (client-eligible contacts with no household);
  // Slice 3's materialization drives this toward zero. Falls back to null pre-migration.
  const orphaned = report?.orphanedEligible ?? null
  const dupCount = report?.duplicateGroups ?? 0

  return (
    <ListShell
      title="Contact Center"
      description="Your App-B contact/lead directory — categorized, tagged, and fully manageable. Distinct from the CRM household record."
      actions={actions}
      breadcrumb={breadcrumb}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Active contacts" value={active} />
        <StatTile
          label="No household"
          value={orphaned ?? '—'}
          hint={orphaned ? 'Not yet campaign-enrollable' : orphaned === 0 ? 'All linked' : undefined}
        />
        <StatTile label="Total records" value={total} />
        <StatTile label="Possible duplicates" value={dupCount} hint={dupCount ? 'Shared email/phone' : undefined} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ContactIcon}
          title="No contacts yet"
          description="Add a contact manually, or import a CSV, TSV, Excel, or JSON file through the Upload Center."
        />
      ) : (
        <ContactList rows={rows} />
      )}
    </ListShell>
  )
}
