import { SettingsShell } from '@/components/archetypes'
import { IntegrationShell } from '@/components/archetypes'
import { smsConfigured } from '@/lib/messaging'
export const dynamic = 'force-dynamic'
// P-6 Integrations (A12). Status/connect/test/failure-log. Never invents an unavailable
// Farmers/FFS API — absent ones show the manual/CSV/reference-field fallback, labeled.
export default function SuperIntegrationsPage() {
  // The SAME predicate sendSms enforces. This page used to call Twilio "connected" on the
  // account SID alone — no auth token, no sender — so a half-configured deployment read as
  // ready on the one screen meant to say whether it is.
  const twilio = smsConfigured()
  const email = !!process.env.RESEND_API_KEY
  const supa = !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)
  const ai = !!process.env.ANTHROPIC_API_KEY
  return (
    <SettingsShell title="Integrations" description="Configured services. “Configured” means the credentials are present; it is not a live connection test. Secrets are never displayed.">
      <IntegrationShell name="Twilio (SMS)" status={twilio ? 'configured' : 'not_configured'}>Outbound SMS sends route through the dispatcher gate.</IntegrationShell>
      <IntegrationShell name="Email provider (Resend)" status={email ? 'configured' : 'not_configured'}>Transactional + campaign email through the gate.</IntegrationShell>
      <IntegrationShell name="Supabase" status={supa ? 'configured' : 'not_configured'}>Postgres, Auth, RLS, Storage.</IntegrationShell>
      <IntegrationShell name="AI gateway" status={ai ? 'configured' : 'not_configured'}>Claude-first, model-agnostic with fallbacks.</IntegrationShell>
      <IntegrationShell name="Farmers / FFS payout API" status="disconnected" fallbackNote="No verified Farmers/FFS payout API exists. Commission receipts use the manual / CSV-import fallback (labeled placeholder). Do not present as an available integration.">Manual / CSV commission entry.</IntegrationShell>
      <IntegrationShell name="Google Calendar" status="disconnected" fallbackNote="Calendar sync connects when configured; otherwise appointments fall back to manual entry.">Appointment scheduling.</IntegrationShell>
    </SettingsShell>
  )
}
