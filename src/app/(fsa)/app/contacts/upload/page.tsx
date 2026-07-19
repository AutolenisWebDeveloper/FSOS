import { ListShell } from '@/components/archetypes'
import { PIPELINES } from '@/lib/ghl'
import { columnAiEnabled } from '@/lib/columnAI'
import { ContactUploadForm } from '@/components/app/ContactUploadForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// App B "Contact Upload → GoHighLevel" (App A parity, in the FSA portal).
// Upload a CSV/XLSX; columns are recognized (exact header → AI → content),
// then each contact is upserted into the GHL location, optionally onto a stage.
export default function ContactUploadPage() {
  const pipelines = PIPELINES.map((p) => ({
    key: p.key,
    name: p.name,
    stages: p.stages.map((s) => ({ position: s.position, name: s.name })),
  }))
  return (
    <ListShell
      title="Contact Upload"
      description="Import a CSV or Excel file of contacts and sync them into GoHighLevel — columns are recognized automatically, contacts are de-duplicated, and nothing is ever double-created."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'FFS Contacts', href: '/app/contacts' }, { label: 'Upload' }]}
    >
      <ContactUploadForm pipelines={pipelines} aiAvailable={columnAiEnabled()} />
    </ListShell>
  )
}
