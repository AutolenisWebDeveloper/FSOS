import { AuthShell } from '@/components/archetypes'

export const metadata = { title: 'Maintenance — FSOS' }

export default function MaintenancePage() {
  return (
    <AuthShell
      title="Down for maintenance"
      description="FSOS is temporarily unavailable while we perform scheduled maintenance. Please check back shortly."
    >
      <p className="text-center text-sm text-muted-foreground">
        If this is urgent, contact your administrator.
      </p>
    </AuthShell>
  )
}
