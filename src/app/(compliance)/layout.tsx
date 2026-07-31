import type { ReactNode } from 'react'
import { requireRole } from '@/lib/auth/session'
import { WorkspaceShell } from '@/components/portal/workspace/WorkspaceShell'

export const dynamic = 'force-dynamic'

// Compliance & Supervisory portal shell (Advisor OS fan-out). Navigation is
// generated from the Workspace Registry filtered to the 'compliance' portal.
// Navigation/layout only — every /compliance route keeps its URL and its
// requireRole('compliance') guard.

// middleware-auth.md §6: the compliance portal renders a standing disclaimer that
// FSOS supervisory views are supplemental to FFS books-and-records systems.
const Banner = (
  <div className="border-b bg-status-pending/10 px-4 py-2 text-center text-xs text-status-pending">
    FSOS supervisory views are supplemental. They do not replace FFS-required supervisory systems or
    books-and-records.
  </div>
)

export default async function ComplianceLayout({ children }: { children: ReactNode }) {
  await requireRole('compliance', '/compliance')
  return (
    <WorkspaceShell portal="compliance" portalLabel="Compliance" banner={Banner}>
      {children}
    </WorkspaceShell>
  )
}
