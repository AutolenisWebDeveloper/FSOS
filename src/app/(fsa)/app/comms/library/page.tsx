import { ListShell } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { listBlueprints } from '@/lib/comms/library'
import { InstantiateBlueprintButton } from '@/components/app/LibraryControls'

export const dynamic = 'force-dynamic'

// Slice 8 (§17) — Campaign library. A curated set of pre-built, COMPLIANCE-READY
// campaign blueprints. "Add to templates" seeds a DRAFT template that still goes through
// human approval before any campaign can use it — the approval gate is never bypassed.
export default function CampaignLibraryPage() {
  const blueprints = listBlueprints()

  return (
    <ListShell
      title="Campaign Library"
      description="Pre-built, compliance-ready starting points. Each seeds a draft template for approval — nothing sends until approved."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Library' }]}
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-4 text-sm text-gold-deep">
          <p className="font-medium">Library blueprints are starting points — not send-ready campaigns.</p>
          <p className="mt-1">
            Every blueprint is green-zone (education/invitation), recommendation-free, and footer-free (the dispatcher adds the
            AI-disclosure + opt-out at send time). Adding one creates a <span className="font-medium">draft template</span> that
            a licensed reviewer must approve before any campaign can use it. Claim-bearing blueprints (a conversion deadline, an
            appointment time, a coverage status) are grounded in your stored data at send time.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {blueprints.map((b) => (
            <div key={b.key} className="flex flex-col rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto font-medium">{b.name}</h3>
                <Badge variant="outline">{b.channel}</Badge>
                <Badge variant="outline">{b.purpose.replace(/_/g, ' ').toLowerCase()}</Badge>
                {b.makesSpecificClaims ? <Badge variant="pending" title={`Grounded in: ${(b.claimFields ?? []).join(', ')}`}>data-checked claim</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{b.description}</p>
              <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                {b.suggestedSubject ? <p className="mb-1 font-medium text-foreground">{b.suggestedSubject}</p> : null}
                <p className="whitespace-pre-wrap">{b.body}</p>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Category: {b.category.replace(/_/g, ' ')}</span>
                <InstantiateBlueprintButton blueprintKey={b.key} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </ListShell>
  )
}
