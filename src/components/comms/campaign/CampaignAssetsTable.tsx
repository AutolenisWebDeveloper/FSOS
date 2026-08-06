import * as React from 'react'
import Link from 'next/link'
import { Section, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApprovalBadge } from './CampaignKit'

/*
 * The message-asset browser, once.
 *
 * Three copies: Life listed every templated touch in one flat `<details>` stack,
 * Cross-Sell split email and SMS into two hand-built columns, Win-Back grouped by channel
 * into three separate Cards. All three used a bare `approved | outline` badge, so a
 * REJECTED template was visually identical to a DRAFT one — on a screen whose entire job
 * is telling you what the campaign is allowed to send.
 *
 * Grouped, with the approval state on the shared vocabulary, and a count of what is not
 * yet dispatchable stated up front rather than left for the reader to tally.
 */

export interface CampaignAsset {
  /** Stable key — a template id, or the touch number for schedule-derived assets. */
  key: string
  name: string
  approval_status: string
  body: string
  /** Optional lead-in, e.g. "#4 · Email". */
  eyebrow?: string
}

export interface AssetGroup {
  title: string
  items: CampaignAsset[]
}

export function CampaignAssetsTable({ groups, description }: { groups: AssetGroup[]; description: string }) {
  const all = groups.flatMap((g) => g.items)
  const unapproved = all.filter((a) => a.approval_status !== 'approved').length
  const nonEmpty = groups.filter((g) => g.items.length > 0)

  return (
    <Section title="Message assets" description={description}>
      {all.length === 0 ? (
        <EmptyState
          title="No assets seeded"
          description="This campaign has no message templates yet, so it has nothing to send. Run its seed migration, or add templates in the library."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/comms/templates">Open the Templates library</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {unapproved > 0 ? (
            <p className="text-xs text-status-pending">
              {unapproved} of {all.length} templates cannot be dispatched yet — each must clear the human approval gate in the
              Templates library first (ADR-023).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">All {all.length} templates have cleared the approval gate.</p>
          )}

          {nonEmpty.map((group) => (
            <Card key={group.title} className="p-5">
              <h3 className="mb-3 text-sm font-semibold">
                {group.title} ({group.items.length})
              </h3>
              <div className="space-y-2">
                {group.items.map((asset) => (
                  <details key={asset.key} className="rounded-lg border p-3">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      <span className="text-sm font-medium">
                        {asset.eyebrow ? <span className="text-muted-foreground">{asset.eyebrow} — </span> : null}
                        {asset.name}
                      </span>
                      <ApprovalBadge status={asset.approval_status} />
                    </summary>
                    <pre className="mt-3 whitespace-pre-wrap break-words border-t pt-3 font-sans text-xs leading-relaxed text-muted-foreground">
                      {asset.body}
                    </pre>
                  </details>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  )
}
