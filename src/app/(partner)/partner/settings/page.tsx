import { SettingsShell, SettingsSection } from '@/components/archetypes'

export const dynamic = 'force-dynamic'

// P-4 Settings (A10). Partner profile + notification preferences.
export default function PartnerSettingsPage() {
  return (
    <SettingsShell title="Settings" description="Your profile and notification preferences.">
      <SettingsSection title="Notifications" description="How your FSA reaches you. All messaging honors consent + quiet hours.">
        <p className="text-sm text-muted-foreground">Notification preferences are managed with your FSA. Reply STOP to any SMS to opt out immediately.</p>
      </SettingsSection>
    </SettingsShell>
  )
}
