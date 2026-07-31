import type { ReactNode } from 'react'
import { requireRole } from '@/lib/auth/session'
import { WorkspaceShell } from '@/components/portal/workspace/WorkspaceShell'

export const dynamic = 'force-dynamic'

// Super Admin portal shell (Advisor OS fan-out). Navigation is generated from the
// Workspace Registry filtered to the 'super' portal. Navigation/layout only —
// every /super route keeps its URL and its requireRole('super') guard (MFA
// mandatory step-up is enforced upstream in the middleware, unchanged).
export default async function SuperLayout({ children }: { children: ReactNode }) {
  await requireRole('super', '/super')
  return (
    <WorkspaceShell portal="super" portalLabel="Super Admin">
      {children}
    </WorkspaceShell>
  )
}
