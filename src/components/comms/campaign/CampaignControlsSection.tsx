import * as React from 'react'
import { Section } from '@/components/archetypes'
import { Card } from '@/components/ui/card'
import { isCampaignLive, type CampaignEngine } from '@/lib/comms/campaign-presentation'

/*
 * The "Operational controls" section, once.
 *
 * All three campaign pages wrapped their controls in the same Section + Card, then each
 * appended its own set of advisory lines below — the simulation hint on all three (three
 * different wordings), the unapproved-asset warning on Win-Back only. Because the warning
 * lived on one page, an operator on Life Conversion or Cross-Sell Life could look at a
 * campaign whose templates were all still DRAFT and see nothing telling them why activating
 * it would dispatch nothing.
 *
 * The controls themselves are NOT re-implemented here — this renders whatever control
 * client the engine passes as `children`, because Cross-Sell's controls carry version
 * actions the other two do not have. The send path is untouched.
 */

export function CampaignControlsSection({
  engine,
  status,
  simulatedAt,
  unapprovedCount,
  assetCount,
  children,
}: {
  engine: CampaignEngine
  status: string
  /** ISO timestamp of the last read-only simulation, or null if never simulated. */
  simulatedAt: string | null
  /** Templates on this campaign that have not cleared the approval gate. */
  unapprovedCount?: number
  assetCount?: number
  children: React.ReactNode
}) {
  const live = isCampaignLive(status)
  const needsSimulation = !simulatedAt && !live
  const hasUnapproved = typeof unapprovedCount === 'number' && unapprovedCount > 0

  return (
    <Section
      title="Operational controls"
      description="Enable, pause, resume, disable, emergency-stop, or archive. Only an active campaign dispatches; every action is RBAC-guarded and audit-logged."
    >
      <Card className="p-5">
        {children}

        {(hasUnapproved || needsSimulation) && (
          <ul className="mt-4 space-y-2 border-t pt-3">
            {hasUnapproved && (
              <li className="text-xs text-status-pending">
                {unapprovedCount} of {assetCount ?? unapprovedCount} templates have not cleared the approval gate. The campaign
                cannot dispatch them until each is approved in the Templates library (ADR-023).
              </li>
            )}
            {needsSimulation && (
              <li className="text-xs text-muted-foreground">
                This campaign has never been simulated. Run a read-only simulation before activating it (ADR-021) to see exactly
                who {engine.title} would contact.
              </li>
            )}
          </ul>
        )}
      </Card>
    </Section>
  )
}
