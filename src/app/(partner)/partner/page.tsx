import { DashboardShell, StatTile } from '@/components/archetypes'

export default function PartnerDashboardPage() {
  return (
    <DashboardShell title="Agency-Owner Portal" description="Your referrals and production.">
      <StatTile label="My referrals" value="—" href="/partner/referrals" />
      <StatTile label="Production" value="—" href="/partner/production" />
      <StatTile label="Materials" value="—" href="/partner/materials" />
      <StatTile label="Submit a referral" value="→" href="/partner/refer" />
    </DashboardShell>
  )
}
