import { SettingsShell, SettingsSection } from '@/components/archetypes'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { householdIdFor } from '@/lib/portal/scope'
import { ClientConsentControls } from '@/components/portal/ClientConsentControls'
export const dynamic = 'force-dynamic'
// P-5 Preferences (A5). Manage channels; revoke instantly honored.
export default async function ClientPreferencesPage() {
  const session = await getServerSession()
  const householdId = session ? await householdIdFor(session) : null
  let channels: { channel: string; status: string }[] = []
  if (householdId) {
    const db = getDb()
    const { data: members } = await db.from('household_members').select('id').eq('household_id', householdId).limit(1)
    const memberId = members?.[0]?.id
    if (memberId) { const { data } = await db.from('consents').select('channel, status').eq('member_id', memberId); channels = (data ?? []) as typeof channels }
  }
  return (
    <SettingsShell title="Preferences" description="Choose how we may contact you.">
      <SettingsSection title="Communication channels" description="Opting out is honored immediately, everywhere.">
        <ClientConsentControls channels={channels} />
      </SettingsSection>
    </SettingsShell>
  )
}
