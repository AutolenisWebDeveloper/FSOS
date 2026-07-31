import type { ReactNode } from 'react'
import { requireRole } from '@/lib/auth/session'
import { WorkspaceShell } from '@/components/portal/workspace/WorkspaceShell'

export const dynamic = 'force-dynamic'

// Client-facing portal shell (Advisor OS fan-out). Navigation is generated from the
// Workspace Registry filtered to the 'client' portal. Navigation/layout only —
// every /client route keeps its URL and its requireRole('client') guard. This is
// a non-securities, non-advice surface (§4.1 firewall), unchanged by the shell.
export default async function ClientLayout({ children }: { children: ReactNode }) {
  await requireRole('client', '/client')
  return (
    <WorkspaceShell portal="client" portalLabel="Client" settingsHref="/client/preferences">
      {children}
    </WorkspaceShell>
  )
}
