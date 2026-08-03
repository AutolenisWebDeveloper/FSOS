import Link from 'next/link'
import { ListShell, Section, ErrorState, EmptyState, StatTile } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { appointmentFunnel, type Appointment } from '@/lib/appointments/recovery'
import {
  bookedViaBreakdown,
  meetingModeBreakdown,
  reminderCoverage,
  notificationStats,
  type AnalyticsAppointment,
  type Breakdown,
} from '@/lib/appointments/analytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Booking analytics & observability (P4). Everything is DERIVED from existing rows — appointments,
// comm_messages(entity=appointment), and comm_message_events — so there is no new events table and
// no migration. Read-only.
export default async function BookingAnalyticsPage() {
  const apptRes = await load<AnalyticsAppointment[]>(
    (db) =>
      db
        .from('appointments')
        .select('id, household_id, opportunity_id, scheduled_at, starts_at, status, booked_via, meeting_mode, reminder_sent_at')
        .limit(5000),
    [],
  )
  if (!apptRes.ok) {
    return (
      <ListShell title="Booking analytics" description="Appointment and notification observability." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Calendar', href: '/app/calendar' }, { label: 'Analytics' }]}>
        {apptRes.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set Supabase env vars to load analytics." />
        ) : (
          <ErrorState description={apptRes.message} />
        )}
      </ListShell>
    )
  }
  const appts = apptRes.data

  // Appointment notifications + their delivery events (best-effort; empty on failure).
  const msgRes = await load<{ id: string; delivery_status: string }[]>(
    (db) => db.from('comm_messages').select('id, delivery_status').eq('entity_type', 'appointment').limit(5000),
    [],
  )
  const messages = msgRes.ok ? msgRes.data : []
  const ids = messages.map((m) => m.id)
  const evtRes = ids.length
    ? await load<{ message_id: string | null; event: string }[]>(
        (db) => db.from('comm_message_events').select('message_id, event').in('message_id', ids).limit(20000),
        [],
      )
    : ({ ok: true as const, data: [] as { message_id: string | null; event: string }[] })
  const events = evtRes.ok ? evtRes.data : []

  const funnel = appointmentFunnel(appts as Appointment[])
  const bookedVia = bookedViaBreakdown(appts)
  const modes = meetingModeBreakdown(appts)
  const reminders = reminderCoverage(appts, Date.now())
  const notif = notificationStats(messages, events)

  const isEmpty = appts.length === 0

  return (
    <ListShell
      title="Booking analytics"
      description="Appointment outcomes and notification delivery — derived from your existing records."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Calendar', href: '/app/calendar' }, { label: 'Analytics' }]}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/app/calendar">Back to calendar</Link>
        </Button>
      }
    >
      {isEmpty ? (
        <EmptyState title="No appointments yet" description="Analytics populate as appointments are booked and notices sent." />
      ) : (
        <div className="space-y-6">
          {/* Outcomes */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Appointments" value={funnel.total} hint="All time" />
            <StatTile label="Held" value={funnel.completed} hint="Completed meetings" />
            <StatTile label="No-shows" value={funnel.noShow} tone={funnel.noShow > 0 ? 'attention' : 'neutral'} hint="Missed" />
            <StatTile label="Show rate" value={`${funnel.showRate}%`} hint="Held ÷ (held + no-show)" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Booking source" description="How appointments were created.">
              <BreakdownTable rows={bookedVia} />
            </Section>
            <Section title="Meeting format" description="Video, phone, or in person.">
              <BreakdownTable rows={modes} />
            </Section>
          </div>

          <Section title="Reminder coverage" description="Past appointments that recorded a reminder send. A low value means the reminder job or the consent/quiet-hours gate suppressed sends.">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Coverage" value={`${reminders.pct}%`} tone={reminders.eligible > 0 && reminders.pct < 80 ? 'attention' : 'neutral'} hint="Reminded ÷ eligible" />
              <StatTile label="Reminded" value={reminders.reminded} hint="Recorded a reminder" />
              <StatTile label="Eligible" value={reminders.eligible} hint="Past, non-cancelled" />
            </div>
          </Section>

          <Section title="Notification delivery" description="Delivery of appointment notices (confirmations + reminders) through the compliance gate.">
            {notif.total === 0 ? (
              <p className="text-sm text-muted-foreground">No appointment notifications sent yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatTile label="Sent" value={notif.total} hint="Appointment messages" />
                <StatTile label="Delivered" value={`${notif.deliveredPct}%`} hint="Delivered ÷ attempted" />
                <StatTile label="Blocked" value={notif.blocked} tone={notif.blocked > 0 ? 'attention' : 'neutral'} hint="Held by the gate" />
                <StatTile label="Failed" value={notif.failed} tone={notif.failed > 0 ? 'attention' : 'neutral'} hint="Provider failures" />
                <StatTile label="Open rate" value={`${notif.openPct}%`} hint="Opened ÷ delivered" />
                <StatTile label="Click rate" value={`${notif.clickPct}%`} hint="Clicked ÷ delivered" />
              </div>
            )}
          </Section>
        </div>
      )}
    </ListShell>
  )
}

function BreakdownTable({ rows }: { rows: Breakdown[] }) {
  const shown = rows.filter((r) => r.count > 0)
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{r.count}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{r.pct}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
