import { ListShell } from '@/components/archetypes'
import { columnAiEnabled } from '@/lib/columnAI'
import { ContactImportForm } from '@/components/app/ContactImportForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Bulk-import contacts (CSV / TSV / XLSX / JSON) into the App B Contact Center.
// Columns are auto-recognized, rows validated + de-duplicated, and each contact
// categorized — then stored in App B (distinct from the outbound GHL sync).
export default function ContactImportPage() {
  return (
    <ListShell
      title="Import contacts"
      description="Upload a CSV, TSV, Excel, or JSON file. Columns are recognized automatically; rows are validated, de-duplicated, categorized, and stored in App B."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: 'Import' }]}
    >
      <div className="max-w-3xl">
        <ContactImportForm aiAvailable={columnAiEnabled()} />
      </div>
    </ListShell>
  )
}
