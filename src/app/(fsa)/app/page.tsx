import { DashboardShell, StatTile } from '@/components/archetypes'

// Foundation placeholder for the Executive Dashboard (OS-01, P0). Real widgets are
// wired to live counts in the P0 phase; the shell + links exist now so the portal
// is navigable and has no dead ends.
export default function FsaDashboardPage() {
  return (
    <DashboardShell title="Executive Dashboard" description="Your book at a glance.">
      <StatTile label="Agencies" value="—" href="/app/agencies" hint="Partnerships" />
      <StatTile label="Referrals awaiting action" value="—" href="/app/referrals" />
      <StatTile label="Open opportunities" value="—" href="/app/opportunities" />
      <StatTile label="AI escalations" value="—" href="/app/ai/escalations" />
    </DashboardShell>
  )
}
