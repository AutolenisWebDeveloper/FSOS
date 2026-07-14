import { DashboardShell, StatTile } from '@/components/archetypes'

// Firewall by construction: the client portal never renders securities/advice/
// commission data (data-guardrails §2; RLS column allowlist).
export default function ClientHomePage() {
  return (
    <DashboardShell title="Welcome" description="Your appointments, documents, and preferences.">
      <StatTile label="Schedule a meeting" value="→" href="/client/schedule" />
      <StatTile label="Documents" value="—" href="/client/documents" />
      <StatTile label="Education" value="—" href="/client/education" />
      <StatTile label="Preferences" value="→" href="/client/preferences" />
    </DashboardShell>
  )
}
