import type { ReactNode } from 'react'
import { requireRole } from '@/lib/auth/session'
import { WorkspaceShell } from '@/components/portal/workspace/WorkspaceShell'
import { agencyIdsFor, compDisclosureEnabled } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'

// Agency-Owner portal shell (Advisor OS fan-out). Navigation is generated from the
// Workspace Registry filtered to the 'partner' portal. Navigation/layout only —
// every /partner route keeps its URL and its requireRole('partner') guard.
//
// Comp-disclosure gating is preserved: when disclosure is off, /partner/commissions
// is hidden from the sidebar + command palette (hiddenHrefs). This is presentation
// only — the route still 403s on a deep link (its own guard is unchanged).
export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const session = await requireRole('partner', '/partner')
  const agencyIds = await agencyIdsFor(session)
  const showComp = await compDisclosureEnabled(agencyIds)
  return (
    <WorkspaceShell
      portal="partner"
      portalLabel="Agency Owner"
      settingsHref="/partner/settings"
      hiddenHrefs={showComp ? undefined : ['/partner/commissions']}
    >
      {children}
    </WorkspaceShell>
  )
}
