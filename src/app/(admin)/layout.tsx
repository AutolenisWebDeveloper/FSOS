import type { ReactNode } from 'react'
import { requireRole } from '@/lib/auth/session'
import { WorkspaceShell } from '@/components/portal/workspace/WorkspaceShell'

export const dynamic = 'force-dynamic'

// Admin / Back-Office portal shell (Advisor OS fan-out). Navigation is generated
// from the Workspace Registry filtered to the 'admin' portal. Navigation/layout
// only — every /admin route keeps its URL and its requireRole('admin') guard.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireRole('admin', '/admin')
  return (
    <WorkspaceShell portal="admin" portalLabel="Admin">
      {children}
    </WorkspaceShell>
  )
}
