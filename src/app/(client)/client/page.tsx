import { DashboardShell, StatTile } from '@/components/archetypes'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { householdIdFor } from '@/lib/portal/scope'
import { CLIENT_ALLOWLIST, selectFor } from '@/lib/portal/allowlist'

export const dynamic = 'force-dynamic'

// P-5 Client Home (A1-lite). Column-allowlisted by construction — no policy
// financials beyond permitted review info, no securities data, no recommendations.
export default async function ClientHomePage() {
  const session = await getServerSession()
  const householdId = session ? await householdIdFor(session) : null
  let appts = 0, docReqs = 0
  if (householdId) {
    const db = getDb()
    const { data: a } = await db.from('appointments').select(selectFor(CLIENT_ALLOWLIST, 'appointments')).eq('household_id', householdId).eq('status', 'scheduled')
    appts = a?.length ?? 0
    const { data: d } = await db.from('document_requests').select(selectFor(CLIENT_ALLOWLIST, 'document_requests')).eq('household_id', householdId).eq('status', 'requested')
    docReqs = d?.length ?? 0
  }

  return (
    <DashboardShell title="Welcome" description="Your appointments, documents, and preferences. No securities data appears here.">
      <StatTile label="Upcoming appointments" value={appts} href="/client/appointments" />
      <StatTile label="Document requests" value={docReqs} href="/client/documents/requests" />
      <StatTile label="Education" value="View" href="/client/education" />
      <StatTile label="Preferences" value="Manage" href="/client/preferences" />
    </DashboardShell>
  )
}
