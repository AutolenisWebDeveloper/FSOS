import { DashboardShell, StatTile } from '@/components/archetypes'

export default function SuperControlPage() {
  return (
    <DashboardShell title="Platform Control" description="System health and platform administration.">
      <StatTile label="Users" value="—" href="/super/users" />
      <StatTile label="AI kill switches" value="—" href="/super/ai/policies" />
      <StatTile label="Integrations" value="—" href="/super/integrations" />
      <StatTile label="Backups" value="—" href="/super/backups" />
    </DashboardShell>
  )
}
