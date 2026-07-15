import { SettingsShell, SettingsSection } from '@/components/archetypes'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { householdIdFor } from '@/lib/portal/scope'
import { ClientConsentControls } from '@/components/portal/ClientConsentControls'

export const dynamic = 'force-dynamic'

// P-5 Consent (A5). Manage channels; revoke instantly honored across all channels.
export default async function ClientConsentPage() {
  const session = await getServerSession()
  const householdId = session ? await householdIdFor(session) : null
  let channels: { channel: string; status: string }[] = []
  if (householdId) {
    const db = getDb()
    const { data: members } = await db.from('household_members').select('id').eq('household_id', householdId).limit(1)
    const memberId = members?.[0]?.id
    if (memberId) {
      const { data } = await db.from('consents').select('channel, status').eq('member_id', memberId)
      channels = (data ?? []) as typeof channels
    }
  }

  return (
    <SettingsShell title="Consent" description="Manage how we may contact you. Opting out is honored immediately across every channel.">
      <SettingsSection title="Contact consent" description="Revoking a channel suppresses it everywhere — re-checked at send time.">
        <ClientConsentControls channels={channels} />
      </SettingsSection>
    </SettingsShell>
  )
}
