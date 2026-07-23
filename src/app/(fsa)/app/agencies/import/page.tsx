import { ListShell } from '@/components/archetypes'
import { AgencyImportForm } from '@/components/app/AgencyImportForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-02 Agency Directory bulk import. Upload a Farmers agent directory (CSV/XLSX)
// and create agency-partnership + owner pairs on the aggregate-root spine —
// columns are recognized by header, rows are de-duplicated by agent code / email,
// and every row is recorded to the import audit trail.
export default function AgencyImportPage() {
  return (
    <ListShell
      title="Import Agency Directory"
      description="Upload a CSV or Excel directory of Farmers agents to create agency-owner partnerships in bulk — columns are recognized automatically, rows are de-duplicated by agent code and email, and nothing is ever double-created."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Agencies', href: '/app/agencies' }, { label: 'Import' }]}
    >
      <AgencyImportForm />
    </ListShell>
  )
}
