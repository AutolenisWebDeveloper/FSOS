import { DashboardShell, StatTile } from '@/components/archetypes'

export default function AdminDashboardPage() {
  return (
    <DashboardShell title="Admin / Back-Office" description="Operational queues.">
      <StatTile label="Case queue" value="—" href="/admin/cases" />
      <StatTile label="Document verification" value="—" href="/admin/documents" />
      <StatTile label="Import jobs" value="—" href="/admin/data/imports" />
      <StatTile label="Support requests" value="—" href="/admin/support/requests" />
    </DashboardShell>
  )
}
