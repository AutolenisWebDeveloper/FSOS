import { SettingsShell, SettingsSection, EmptyState, ErrorState, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { AppointmentTypesManager, type AppointmentTypeRow } from '@/components/app/booking/AppointmentTypesManager'
import { AvailabilityRulesManager, type AvailabilityRuleRow } from '@/components/app/booking/AvailabilityRulesManager'
import { BlackoutsManager, type BlackoutRow } from '@/components/app/booking/BlackoutsManager'
import { GoogleCalendarConnect, type CalendarConnection } from '@/components/app/booking/GoogleCalendarConnect'
import { googleCalendarConfigured } from '@/lib/booking/google/oauth'
import { NotificationSettings } from '@/components/app/booking/NotificationSettings'
import { WeeklyAvailabilitySummary } from '@/components/app/booking/WeeklyAvailabilitySummary'
import { ruleFromRow, type AvailabilityRuleRow as EngineRuleRow } from '@/lib/booking/availability'
import { describeWeeklyAvailability, summaryTimezone } from '@/lib/booking/availability-summary'
import { CommTimeline } from '@/components/comms/CommTimeline'
import { BOOKING_CONFIG_ENTITIES, toTimelineEntry, type ConfigAuditRow } from '@/lib/booking/config-history'
import { loadBookingNotificationConfig, reminderLeadHours } from '@/lib/booking/notification-config'
import { smsA2pApproved } from '@/lib/comms/a2p'
import { smsConfigured } from '@/lib/messaging'

interface CalendarConnRow {
  id: string
  status: CalendarConnection['status']
  google_account_email: string | null
  calendar_id: string
  scopes: unknown
  token_expires_at: string | null
  last_synced_at: string | null
  last_error: string | null
  connected_at: string | null
}

export const dynamic = 'force-dynamic'

// Slice 2 — FSA booking configuration. The FSA defines the bookable appointment types
// (duration, buffers, notice, meeting mode), the recurring weekly hours the availability
// engine draws from, and blackout ranges. All reads go through the service role AFTER the
// portal layout has gated the FSA role (RLS on these tables is default-deny). The public
// booking flow (Slice 3) consumes exactly this configuration.
export default async function BookingSettingsPage() {
  const [typesRes, rulesRes, blackoutsRes, calendarRes, historyRes] = await Promise.all([
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
    load<CalendarConnRow[]>(
      (db) =>
        db
          .from('booking_calendar_connections')
          .select(
            'id, status, google_account_email, calendar_id, scopes, token_expires_at, last_synced_at, last_error, connected_at',
          )
          .is('deleted_at', null)
          .order('connected_at', { ascending: false })
          .limit(1),
      [],
    ),
    // Read-only settings-change history (config.changed audit rows), rendered via the reusable
    // CommTimeline. Best-effort — a failure degrades to an empty history, never blanks the page.
    load<ConfigAuditRow[]>(
      (db) =>
        db
          .from('audit_log')
          .select('id, actor, entity, action, diff, at')
          .eq('action', 'config.changed')
          .in('entity', BOOKING_CONFIG_ENTITIES as unknown as string[])
          .order('at', { ascending: false })
          .limit(50),
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

  // Calendar connection is non-blocking: if it can't load (e.g. table not yet migrated),
  // fall back to "not connected" rather than failing the whole settings page.
  const calRow = calendarRes.ok ? calendarRes.data[0] : undefined
  const calendarConnection: CalendarConnection | null = calRow
    ? {
        id: calRow.id,
        status: calRow.status,
        googleAccountEmail: calRow.google_account_email,
        calendarId: calRow.calendar_id || 'primary',
        scopes: Array.isArray(calRow.scopes) ? (calRow.scopes as string[]) : [],
        tokenExpiresAt: calRow.token_expires_at,
        lastSyncedAt: calRow.last_synced_at,
        lastError: calRow.last_error,
        connectedAt: calRow.connected_at,
      }
    : null

  const activeTypes = types.filter((t) => t.active).length
  const activeRules = rules.filter((r) => r.active).length

  // Notification config (§9.6 — expose EXISTING config read-only). Read through the SAME loader
  // the send path uses, so this panel cannot claim a channel state the cron would disagree with.
  const notificationConfig = await loadBookingNotificationConfig()
  // The reminder offsets are an editable config default until an operator verifies them
  // (booking_reminder_config.is_assumption), which is exactly what the gold badge means.
  const leadHours = Math.max(...notificationConfig.offsets) / 60 || reminderLeadHours()
  const leadIsDefault = notificationConfig.isAssumption

  // Settings-change history → reusable timeline entries (no bodies/PII in config audits).
  const historyEntries = (historyRes.ok ? historyRes.data : []).map(toTimelineEntry)

  // Weekly template summary — reads rules through the SAME engine mapper (ruleFromRow) the slot
  // calculator uses, so this FSA-facing view can't drift from the slots clients actually get.
  const weeklyDays = describeWeeklyAvailability(rules.map((r) => ruleFromRow(r as unknown as EngineRuleRow)))
  const weeklyTz = summaryTimezone(weeklyDays)

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
        <div className="space-y-4">
          <WeeklyAvailabilitySummary days={weeklyDays} timezone={weeklyTz} />
          <AvailabilityRulesManager initialRules={rules} />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Blackout dates"
        description="Specific ranges you are unavailable — subtracted from every appointment type's availability."
      >
        <BlackoutsManager initialBlackouts={blackouts} />
      </SettingsSection>

      <SettingsSection
        title="Google Calendar"
        description="Connect your Google Calendar so booked time is blocked automatically. Read-only and one-way — FSOS reads only your busy times and never changes your calendar."
      >
        <GoogleCalendarConnect configured={googleCalendarConfigured()} connection={calendarConnection} />
      </SettingsSection>

      <SettingsSection
        title="Notifications"
        description="How clients are notified about their appointments, and why a channel is or is not live. Read-only — timing and channels are set in the reminder configuration."
      >
        <NotificationSettings
          leadHours={leadHours}
          leadIsDefault={leadIsDefault}
          offsetsMinutes={notificationConfig.offsets}
          emailEnabled={notificationConfig.emailEnabled}
          smsEnabled={notificationConfig.smsEnabled}
          a2pApproved={smsA2pApproved()}
          smsConfigured={smsConfigured()}
          configResolved={notificationConfig.resolved}
        />
      </SettingsSection>

      <SettingsSection
        title="Recent changes"
        description="Audit trail of changes to your appointment types, weekly hours, and blackout dates."
      >
        <CommTimeline
          entries={historyEntries}
          emptyHint="Changes to types, hours, and blackouts will appear here as you make them."
        />
      </SettingsSection>
    </SettingsShell>
  )
}
