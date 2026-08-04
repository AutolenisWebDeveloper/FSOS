import { ListShell } from '@/components/archetypes'
import { ContactImportMapper } from '@/components/app/ContactImportMapper'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Bulk-import contacts (CSV / TSV / XLSX / JSON / PDF) into the App B Contact
// Center via the unified field-recognition & mapping model (design spec v2.1):
// the file's template is detected by header signature, columns are auto-mapped
// against the recognition dictionary, composite columns (e.g. AOR with Series
// Code) are split, anything unrecognized is mapped once and remembered, and the
// confirmed rows are validated, de-duplicated, materialized into the household
// spine, and stored. No consent step, no birthday gating.
export default function ContactImportPage() {
  return (
    <ListShell
      title="Import contacts"
      description="Upload a Farmers district export or any CSV/Excel file. The importer detects the file, maps its columns, splits composite fields, and remembers your mapping for next time — then validates, de-duplicates, and stores each contact in App B."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: 'Import' }]}
    >
      <div className="max-w-5xl">
        <ContactImportMapper />
      </div>
    </ListShell>
  )
}
