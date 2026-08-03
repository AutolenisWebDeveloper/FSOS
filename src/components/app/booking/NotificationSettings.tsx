// src/components/app/booking/NotificationSettings.tsx
// READ-ONLY exposure of the EXISTING appointment-notification configuration (§9.6). It surfaces how
// booking notices work today — it does NOT edit them and does NOT build the P5 advisor reminder
// scheduler. The reminder lead is env-driven (BOOKING_REMINDER_LEAD_HOURS, default 24h), so it
// carries the gold "config default — verify" badge when unset (§4.3). Notices are email-only today;
// SMS is shown as not-enabled (deferred to P5, consent + A2P gated).

import { StatusBadge, AssumptionBadge } from '@/components/archetypes'

export function NotificationSettings({ leadHours, leadIsDefault }: { leadHours: number; leadIsDefault: boolean }) {
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
            <StatusBadge status="active" label="Email" />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">Pre-appointment reminder</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Sent {leadHours} hours before the appointment.
                {leadIsDefault ? <AssumptionBadge /> : null}
              </p>
            </div>
            <StatusBadge status="active" label="Email" />
          </li>
        </ul>
      </div>

      <div>
        <p className="mb-2 font-medium">Channels</p>
        <ul className="divide-y rounded-lg border">
          <li className="flex items-center justify-between gap-2 p-3">
            <span>Email</span>
            <StatusBadge status="active" label="Active" />
          </li>
          <li className="flex items-center justify-between gap-2 p-3">
            <div>
              <span>SMS</span>
              <p className="text-xs text-muted-foreground">
                Requires SMS consent + A2P registration. Deferred to a later phase — not enabled here.
              </p>
            </div>
            <StatusBadge status="draft" label="Not enabled" />
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Every notice is sent through the compliance gate (consent, quiet hours, and DNC are enforced; a blocked send is
        recorded, never forced). This is a read-only summary — reminder timing is set via deployment configuration.
      </p>
    </div>
  )
}
