import { SettingsShell, SettingsSection, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { HoursOfOperation, type HoursPolicy } from '@/components/app/HoursOfOperation'

export const dynamic = 'force-dynamic'

// Super · Hours of operation. Governs WHEN any automated SMS/email may send (the
// workforce, campaigns, drips, AI replies) via the send gate + orchestrator pre-check.
// Can only tighten the legal recipient-local 9am–8pm floor.
export default async function SuperHoursPage() {
  const policy = await load<HoursPolicy | null>(
    (db) => db.from('comm_hours_policy').select('enabled, start_hour, end_hour, days, timezone_offset_hours, is_assumption').eq('id', 'global').maybeSingle(),
    null,
  )

  let body: React.ReactNode
  if (!policy.ok) {
    body = policy.kind === 'not_configured'
      ? <EmptyState title="Database not configured" description="Set Supabase env vars to manage hours of operation." />
      : <ErrorState description={policy.message} />
  } else {
    const p: HoursPolicy = policy.data ?? { enabled: true, start_hour: 9, end_hour: 19, days: [1, 2, 3, 4, 5, 6], timezone_offset_hours: -6, is_assumption: true }
    body = (
      <SettingsSection
        title="When the AI may contact people"
        description="Automated outreach only sends inside these hours. Outside them, messages are held for the next in-hours cycle — never sent at night."
      >
        <HoursOfOperation initial={p} />
      </SettingsSection>
    )
  }

  return (
    <SettingsShell title="Hours of Operation" description="Control the hours during which AI agents may send automated SMS and email.">
      {body}
    </SettingsShell>
  )
}
