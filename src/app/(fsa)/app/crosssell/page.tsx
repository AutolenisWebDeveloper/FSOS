import { ListShell, AssumptionBadge } from '@/components/archetypes'
import { CrossSellImportWizard } from '@/components/app/CrossSellImportWizard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Cross-Sell import — load a Farmers P&C book (Auto/Home/Umbrella, No Life) and
// sync it into the Contact Center: match each row to an existing contact and
// enrich it in place, or create a new cross_sell contact. Preview first; commit
// is idempotent and audited. P&C lines only — nothing here is a security.
export default function CrossSellImportPage() {
  return (
    <ListShell
      title="Cross-Sell import"
      description="Sync a Farmers P&C book (Auto/Home/Umbrella, No Life) into the Contact Center. The system identifies matching contacts, merges records without overwriting valid data, and flags each household as a life cross-sell target."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cross-Sell import' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <AssumptionBadge label="P&C list — no life" />
        <span className="text-muted-foreground">
          These are property/casualty households with no life coverage — prime life cross-sell targets. Lines of business are captured for context only; nothing here is a securities record and no product recommendation is implied. Do-not-call and unsubscribed flags are preserved on each contact.
        </span>
      </div>
      <div className="max-w-4xl">
        <CrossSellImportWizard />
      </div>
    </ListShell>
  )
}
