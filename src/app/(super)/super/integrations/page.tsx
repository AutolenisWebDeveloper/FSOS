import { SettingsShell } from '@/components/archetypes'
import { IntegrationShell } from '@/components/archetypes'
export const dynamic = 'force-dynamic'
// P-6 Integrations (A12). Status/connect/test/failure-log. Never invents an unavailable
// Farmers/FFS API — absent ones show the manual/CSV/reference-field fallback, labeled.
export default function SuperIntegrationsPage() {
  const twilio = !!process.env.TWILIO_ACCOUNT_SID
  const email = !!process.env.RESEND_API_KEY
  const supa = !!(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)
  const ai = !!process.env.ANTHROPIC_API_KEY
  return (
    <SettingsShell title="Integrations" description="Connected services. Secrets are never displayed.">
      <IntegrationShell name="Twilio (SMS)" status={twilio ? 'connected' : 'disconnected'}>Outbound SMS sends route through the dispatcher gate.</IntegrationShell>
      <IntegrationShell name="Email provider (Resend)" status={email ? 'connected' : 'disconnected'}>Transactional + campaign email through the gate.</IntegrationShell>
      <IntegrationShell name="Supabase" status={supa ? 'connected' : 'disconnected'}>Postgres, Auth, RLS, Storage.</IntegrationShell>
      <IntegrationShell name="AI gateway" status={ai ? 'connected' : 'disconnected'}>Claude-first, model-agnostic with fallbacks.</IntegrationShell>
      <IntegrationShell name="Farmers / FFS payout API" status="disconnected" fallbackNote="No verified Farmers/FFS payout API exists. Commission receipts use the manual / CSV-import fallback (labeled placeholder). Do not present as an available integration.">Manual / CSV commission entry.</IntegrationShell>
      <IntegrationShell name="Google Calendar" status="disconnected" fallbackNote="Calendar sync connects when configured; otherwise appointments fall back to manual entry.">Appointment scheduling.</IntegrationShell>
    </SettingsShell>
  )
}
