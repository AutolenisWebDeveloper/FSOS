import { ListShell } from '@/components/archetypes'
import { AssumptionBadge } from '@/components/archetypes'
import { BookImportWizard } from '@/components/app/BookImportWizard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// In-Force Book import — load an FNWL district "Review of in-force business"
// export onto the aggregate-root spine (agencies → households → policies).
// Preview (dry run) first; commit is idempotent and audited.
export default function BookImportPage() {
  return (
    <ListShell
      title="District Book import"
      description="Import your FNWL in-force business review. Serving agents become agency partnerships, owners become households, and each policy is stored on the book — variable products flagged as securities."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'District Book' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <AssumptionBadge label="confidential — FNWL book" />
        <span className="text-muted-foreground">
          This is confidential FNWL / Security Life data. It is stored in App B under row-level security and audit; it is never sent to any external system without consent. Conversion windows are not in the export, so they are left blank rather than invented.
        </span>
      </div>
      <div className="max-w-4xl">
        <BookImportWizard />
      </div>
    </ListShell>
  )
}
