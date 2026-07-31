import type { ReactNode } from 'react'
import { requireRole } from '@/lib/auth/session'
import { WorkspaceShell } from '@/components/portal/workspace/WorkspaceShell'
import { ShellCharacterPanels } from '@/components/portal/CharacterPanels'
import { loadShellData } from '@/lib/data/shell'

// Session is read per request; never statically render a guarded portal.
export const dynamic = 'force-dynamic'

// FSA portal shell (Advisor OS redesign — reference portal). Navigation is now
// generated from the Workspace Registry (src/lib/workspaces/registry.ts), filtered
// to the 'fsa' portal, and rendered as a workspace icon rail + contextual sidebar
// by WorkspaceShell. This changes ONLY the navigation/layout chrome — every /app
// route keeps its URL and its requireRole('fsa') guard (unchanged below). The
// flat 50-item NAV array that used to live here is retired; nothing it linked to
// is dropped (enforced by the registry-covers-legacy-nav invariant test).
export default async function FsaLayout({ children }: { children: ReactNode }) {
  await requireRole('fsa', '/app')
  const shellData = await loadShellData()
  return (
    <WorkspaceShell
      portal="fsa"
      portalLabel="FSA"
      panels={<ShellCharacterPanels data={shellData} />}
      assistantHref="/app/assistant"
      notificationsHref="/app/notifications"
      settingsHref="/app/settings"
    >
      {children}
    </WorkspaceShell>
  )
}
