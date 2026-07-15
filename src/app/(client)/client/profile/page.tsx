import { SettingsShell, SettingsSection } from '@/components/archetypes'
export const dynamic = 'force-dynamic'
// P-5 Profile (A5).
export default function ClientProfilePage() {
  return (
    <SettingsShell title="Profile" description="Your contact details.">
      <SettingsSection title="Contact" description="Kept in sync with your household record."><p className="text-sm text-muted-foreground">Contact your FSA to update details. Date of birth is stored encrypted and never shown here.</p></SettingsSection>
    </SettingsShell>
  )
}
