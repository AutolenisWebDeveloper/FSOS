import { requireRole } from '@/lib/auth/session'
import { SettingsShell, SettingsSection, ErrorState } from '@/components/archetypes'
import { IntegrationShell } from '@/components/archetypes'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// System health & integrations (ports the legacy "Settings & Integrations" live
// health pills into App B). Reports only booleans/reachability — never a secret
// value. A live Supabase probe distinguishes reachable-with-schema from
// reachable-but-unmigrated. Roles: super_admin (portal-gated by the (super) layout).
type Probe = { reachable: boolean; schemaPresent: boolean; message: string | null }

async function probeSupabase(): Promise<Probe> {
  const hasEnv = !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) && !!process.env.SUPABASE_SERVICE_KEY
  if (!hasEnv) return { reachable: false, schemaPresent: false, message: 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY.' }
  try {
    const { error } = await getDb().from('agencies').select('agency_id').limit(1)
    if (!error) return { reachable: true, schemaPresent: true, message: null }
    if (error.code === '42P01' || /does not exist/i.test(error.message)) {
      return { reachable: true, schemaPresent: false, message: 'Reachable, but the schema is not migrated.' }
    }
    return { reachable: true, schemaPresent: false, message: error.message }
  } catch (e) {
    return { reachable: false, schemaPresent: false, message: e instanceof Error ? e.message : 'Unreachable' }
  }
}

function statusOf(connected: boolean): 'connected' | 'disconnected' {
  return connected ? 'connected' : 'disconnected'
}

export default async function SuperHealthPage() {
  await requireRole('super', '/super/health')

  const supa = await probeSupabase()
  const ai = !!process.env.ANTHROPIC_API_KEY
  const email = !!process.env.RESEND_API_KEY
  const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)
  const ghl = !!process.env.GHL_API_KEY

  const supaStatus: 'connected' | 'disconnected' | 'degraded' | 'error' = !supa.reachable
    ? 'error'
    : supa.schemaPresent
      ? 'connected'
      : 'degraded'

  return (
    <SettingsShell title="System Health" description="Live status of FSOS services and integrations. Secrets are never displayed.">
      <SettingsSection title="Data & auth">
        <IntegrationShell name="Supabase (Postgres / Auth / RLS)" status={supaStatus}>
          {supa.reachable
            ? supa.schemaPresent
              ? 'Reachable and migrated.'
              : (supa.message ?? 'Reachable, schema not migrated.')
            : (supa.message ?? 'Unreachable.')}
        </IntegrationShell>
      </SettingsSection>

      <SettingsSection title="Messaging (through the dispatcher gate)">
        <IntegrationShell name="Email provider (Resend)" status={statusOf(email)}>
          Transactional + campaign email — sends only after the 7-step gate passes.
        </IntegrationShell>
        <IntegrationShell name="Twilio (SMS)" status={statusOf(twilio)}>
          Outbound SMS — sends only after the 7-step gate passes.
        </IntegrationShell>
      </SettingsSection>

      <SettingsSection title="AI & external">
        <IntegrationShell name="AI gateway (Claude-first)" status={statusOf(ai)}>
          {ai ? 'Configured. All AI routes through the model-agnostic gateway.' : 'ANTHROPIC_API_KEY unset — FNA and the assistant are unavailable.'}
        </IntegrationShell>
        <IntegrationShell
          name="GoHighLevel (GHL)"
          status={statusOf(ghl)}
          fallbackNote={ghl ? undefined : 'Not configured — contact import uses the CSV fallback.'}
        >
          Contact sync / import.
        </IntegrationShell>
        <IntegrationShell
          name="Farmers / FFS payout API"
          status="disconnected"
          fallbackNote="No verified Farmers/FFS payout API exists. Commissions use the manual / CSV-import fallback (labeled placeholder). Do not present as an available integration."
        >
          Manual / CSV commission entry.
        </IntegrationShell>
      </SettingsSection>

      {!supa.reachable ? (
        <ErrorState title="Supabase unreachable" description={supa.message ?? undefined} />
      ) : null}
    </SettingsShell>
  )
}
