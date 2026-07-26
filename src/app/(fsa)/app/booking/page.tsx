import { SettingsShell, SettingsSection, EmptyState, ErrorState, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { AppointmentTypesManager, type AppointmentTypeRow } from '@/components/app/booking/AppointmentTypesManager'
import { AvailabilityRulesManager, type AvailabilityRuleRow } from '@/components/app/booking/AvailabilityRulesManager'
import { BlackoutsManager, type BlackoutRow } from '@/components/app/booking/BlackoutsManager'

export const dynamic = 'force-dynamic'

// Slice 2 — FSA booking configuration. The FSA defines the bookable appointment types
// (duration, buffers, notice, meeting mode), the recurring weekly hours the availability
// engine draws from, and blackout ranges. All reads go through the service role AFTER the
// portal layout has gated the FSA role (RLS on these tables is default-deny). The public
// booking flow (Slice 3) consumes exactly this configuration.
export default async function BookingSettingsPage() {
  const [typesRes, rulesRes, blackoutsRes] = await Promise.all([
    load<AppointmentTypeRow[]>(
      (db) =>
        db
          .from('appointment_types')
          .select(
            'id, name, slug, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_lead_days, max_per_day, slot_interval_minutes, meeting_mode, active',
          )
          .order('active', { ascending: false })
          .order('name', { ascending: true }),
      [],
    ),
    load<AvailabilityRuleRow[]>(
      (db) =>
        db
          .from('availability_rules')
          .select('id, weekday, start_time, end_time, timezone, effective_start, effective_end, active')
          .order('weekday', { ascending: true })
          .order('start_time', { ascending: true }),
      [],
    ),
    load<BlackoutRow[]>(
      (db) =>
        db
          .from('availability_blackouts')
          .select('id, starts_at, ends_at, reason')
          .order('starts_at', { ascending: true }),
      [],
    ),
  ])

  // Any hard failure across the three: show one clear notice rather than a partial page.
  const firstFail = [typesRes, rulesRes, blackoutsRes].find((r) => !r.ok) as
    | Extract<typeof typesRes, { ok: false }>
    | undefined
  if (firstFail) {
    return (
      <SettingsShell title="Booking" description="Configure how clients can schedule time with you.">
        {firstFail.kind === 'not_configured' ? (
          <EmptyState
            title="Database not configured"
            description="Set the Supabase environment variables to manage booking configuration."
          />
        ) : (
          <ErrorState description={firstFail.message} />
        )}
      </SettingsShell>
    )
  }

  const types = typesRes.ok ? typesRes.data : []
  const rules = rulesRes.ok ? rulesRes.data : []
  const blackouts = blackoutsRes.ok ? blackoutsRes.data : []

  const activeTypes = types.filter((t) => t.active).length
  const activeRules = rules.filter((r) => r.active).length

  return (
    <SettingsShell
      title="Booking"
      description="Define your appointment types, weekly hours, and blackout dates. Clients book from what you set here."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Active types" value={activeTypes} hint="Bookable appointment types" />
        <StatTile label="Weekly windows" value={activeRules} hint="Recurring availability rules" />
        <StatTile label="Blackouts" value={blackouts.length} hint="Unavailable ranges" />
      </div>

      <SettingsSection
        title="Appointment types"
        description="What clients can book — each with its own duration, buffers, notice window, and meeting mode."
      >
        <AppointmentTypesManager initialTypes={types} />
      </SettingsSection>

      <SettingsSection
        title="Weekly hours"
        description="Recurring working-hours windows the availability engine draws slots from. Times are in the selected timezone and stay correct across daylight-saving shifts."
      >
        <AvailabilityRulesManager initialRules={rules} />
      </SettingsSection>

      <SettingsSection
        title="Blackout dates"
        description="Specific ranges you are unavailable — subtracted from every appointment type's availability."
      >
        <BlackoutsManager initialBlackouts={blackouts} />
      </SettingsSection>
    </SettingsShell>
  )
}
