// src/components/app/booking/NotificationSettings.tsx
// READ-ONLY exposure of the EXISTING appointment-notification configuration (§9.6). It surfaces
// how booking notices work today — it does NOT edit them.
//
// It used to hardcode "SMS — not enabled", which had become the opposite of the truth: the
// booking-SMS feature flag (`booking_reminder_config.sms_enabled`, mig 093) already defaults ON,
// so the panel told the FSA that appointment texts were off while the send path was willing to
// send them. Every row below is now derived from the same values the send path reads, and when a
// prerequisite is missing the panel names WHICH one — because "not enabled" without a reason is
// what makes an operator go looking in the wrong place.

import { StatusBadge, AssumptionBadge } from '@/components/archetypes'

export interface NotificationSettingsProps {
  /** Reminder lead in hours, from the configured offsets (or the env fallback). */
  leadHours: number
  /** The lead is an unverified config default (§4.3 gold badge). */
  leadIsDefault: boolean
  /** Every configured reminder offset, minutes before start. */
  offsetsMinutes?: number[]
  /** `booking_reminder_config.email_enabled`. */
  emailEnabled?: boolean
  /** `booking_reminder_config.sms_enabled` — the booking-SMS feature flag. */
  smsEnabled?: boolean
  /** SMS_A2P_APPROVED — the A2P 10DLC carrier go-live gate. */
  a2pApproved?: boolean
  /** Twilio credentials + an origination number are present. */
  smsConfigured?: boolean
  /** False when the config row could not be read and the legacy fallback is in force. */
  configResolved?: boolean
}

/** Human phrase for a minutes-before-start offset ("24 hours", "1 hour", "30 minutes"). */
function describeOffset(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `${minutes} minutes`
}

export function NotificationSettings({
  leadHours,
  leadIsDefault,
  offsetsMinutes,
  emailEnabled = true,
  smsEnabled = false,
  a2pApproved = false,
  smsConfigured = false,
  configResolved = true,
}: NotificationSettingsProps) {
  // SMS reaches a client only when ALL of these hold. Each is enforced independently at send
  // time, so the panel reports the first missing one rather than a bare "off".
  const smsLive = smsEnabled && a2pApproved && smsConfigured
  const smsBlocker = !smsEnabled
    ? 'Turned off in the reminder configuration (booking_reminder_config.sms_enabled).'
    : !a2pApproved
      ? 'Waiting on the A2P 10DLC go-live switch — set SMS_A2P_APPROVED=true once the campaign is approved.'
      : !smsConfigured
        ? 'Twilio is not configured for this deployment (account SID, auth token, and an origination number).'
        : null

  const offsets = offsetsMinutes?.length ? [...offsetsMinutes].sort((a, b) => b - a) : [leadHours * 60]
  // "1 day, 12 hours and 1 hour" — a plain `join(' and ')` reads as a run-on once the cadence
  // carries more than two offsets, which the shipped 24h + 12h + 1h one does.
  const described = offsets.map(describeOffset)
  const reminderTiming =
    described.length > 1 ? `${described.slice(0, -1).join(', ')} and ${described[described.length - 1]}` : described[0]

  const channelLabel = smsLive ? 'Email + SMS' : 'Email'

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-2 font-medium">Automated notices</p>
        <ul className="divide-y rounded-lg border">
          <li className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">Booking confirmation</p>
              <p className="text-xs text-muted-foreground">Sent to the client immediately after they book.</p>
            </div>
            <StatusBadge status="active" label={channelLabel} />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">Pre-appointment reminder</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Sent {reminderTiming} before the appointment.
                {leadIsDefault || !configResolved ? <AssumptionBadge /> : null}
              </p>
            </div>
            <StatusBadge status={emailEnabled || smsLive ? 'active' : 'draft'} label={channelLabel} />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">Reschedule &amp; cancellation notices</p>
              <p className="text-xs text-muted-foreground">
                Sent when an appointment moves or is cancelled, from either side.
              </p>
            </div>
            <StatusBadge status="active" label={channelLabel} />
          </li>
        </ul>
      </div>

      <div>
        <p className="mb-2 font-medium">Channels</p>
        <ul className="divide-y rounded-lg border">
          <li className="flex items-center justify-between gap-2 p-3">
            <span>Email</span>
            <StatusBadge status={emailEnabled ? 'active' : 'draft'} label={emailEnabled ? 'Active' : 'Off'} />
          </li>
          <li className="flex flex-wrap items-start justify-between gap-2 p-3">
            <div className="min-w-0">
              <span>SMS</span>
              <p className="text-xs text-muted-foreground">
                {smsLive
                  ? 'Sent only to clients who gave written SMS consent at booking. STOP opts them out immediately.'
                  : smsBlocker}
              </p>
            </div>
            <StatusBadge status={smsLive ? 'active' : 'draft'} label={smsLive ? 'Active' : 'Not enabled'} />
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Every notice is sent through the compliance gate (consent, quiet hours, and DNC are enforced; a blocked send is
        recorded, never forced). Appointment texts go only to clients who ticked the SMS consent box on the booking
        form; a client who did not still gets every notice by email. This is a read-only summary — reminder timing and
        channels live in the reminder configuration.
      </p>
    </div>
  )
}
