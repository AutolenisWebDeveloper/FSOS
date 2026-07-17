import { ListShell, AssumptionBadge } from '@/components/archetypes'
import { ConversionImportWizard } from '@/components/app/ConversionImportWizard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Life Conversion import — load an FNWL term-conversion opportunity list and set
// each policy's conversion deadline on the book (matched by policy number), so
// the Term Conversion pipeline works from real windows. Preview first; commit is
// idempotent and audited. Term products only — nothing here is a security.
export default function ConversionImportPage() {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <ListShell
      title="Life Conversion import"
      description="Load a term-conversion opportunity list. Each policy is matched to the book by policy number, its conversion deadline is set, and the owner is flagged as a term-conversion opportunity — without overwriting valid data."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Term Conversion', href: '/app/conversions' }, { label: 'Import' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <AssumptionBadge label="FNWL term policies" />
        <span className="text-muted-foreground">
          These are FNWL term policies inside their conversion window — confidential book data stored in App B under row-level security and audit. Conversion deadlines and convertible amounts come straight from the file. Term products only; nothing here is a securities record and no conversion is recommended. The insured birthday carries month/day only (no year in the source) and is never fabricated.
        </span>
      </div>
      <div className="max-w-4xl">
        <ConversionImportWizard today={today} />
      </div>
    </ListShell>
  )
}
