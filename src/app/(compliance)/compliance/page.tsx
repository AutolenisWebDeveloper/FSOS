import { DashboardShell, StatTile } from '@/components/archetypes'

export default function ComplianceOverviewPage() {
  return (
    <DashboardShell title="Compliance & Supervisory" description="Supplemental oversight surfaces.">
      <StatTile label="Audit log" value="—" href="/compliance/audit" />
      <StatTile label="Consent coverage" value="—" href="/compliance/consent" />
      <StatTile label="Licenses" value="—" href="/compliance/licenses" />
      <StatTile label="Open incidents" value="—" href="/compliance/incidents" />
    </DashboardShell>
  )
}
