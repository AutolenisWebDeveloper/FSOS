import { ListShell, AssumptionBadge } from '@/components/archetypes'
import { WinBackImportWizard } from '@/components/app/WinBackImportWizard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Win-Back Life import — load a list of households whose agency once had a Life
// line that is now lapsed (a re-engagement / "win-back" list) and sync it into
// the Contact Center with the shared entity-resolution engine: match each row to
// an existing contact and enrich it in place, queue an ambiguous match for
// review, or create a new prospect. Optionally assign the agent/agency that owns
// the book. Preview first; commit is idempotent and audited. Green-zone identify
// only — nothing here is a securities record and no product recommendation.
export default function WinBackImportPage() {
  return (
    <ListShell
      title="Win-Back Life import"
      description="Sync a Life win-back list (households whose agency previously had a lapsed Life line) into the Contact Center. The system matches each row to an existing contact, merges without overwriting valid data, queues ambiguous matches for review, and can link the whole book to a selected agent/agency."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Win-Back import' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <AssumptionBadge label="Win-back list — lapsed life" />
        <span className="text-muted-foreground">
          These are households whose agency once carried a Life line that is now inactive — prime life re-engagement targets. Lines of business are captured for context only; nothing here is a securities record and no product recommendation is implied. Do-not-call and unsubscribed flags are preserved on each contact, and any match the system cannot make with confidence is queued for manual review rather than guessed.
        </span>
      </div>
      <div className="max-w-4xl">
        <WinBackImportWizard />
      </div>
    </ListShell>
  )
}
