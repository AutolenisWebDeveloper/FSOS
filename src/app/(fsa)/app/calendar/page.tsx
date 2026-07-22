import { ListShell, Section, ErrorState, EmptyState, IntegrationShell, StatTile } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { CalendarView, type AppointmentRow } from '@/components/app/CalendarView'
import { RunAppointmentRecoveryButton } from '@/components/app/RunAppointmentRecoveryButton'
import { AppointmentStatusControls } from '@/components/app/AppointmentStatusControls'
import { appointmentFunnel, isOverdue, needsRecovery, type Appointment } from '@/lib/appointments/recovery'

export const dynamic = 'force-dynamic'

interface ApptRow extends AppointmentRow {
  opportunity_id: string | null
}

function fmt(when: string | null): string {
  if (!when) return '—'
  const d = new Date(when)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// P0 Calendar (A2 agenda + A12 labeled manual fallback) + appointment lifecycle & no-show
// recovery (§13.4). FSOS never invents an unavailable Google Calendar API — appointments
// are entered manually / created from a review; this surface manages their lifecycle
// (held / no-show) and recovers no-shows into internal reschedule tasks. It sends nothing.
export default async function CalendarPage() {
  const [res, householdsRes] = await Promise.all([
    load<ApptRow[]>(
      (db) =>
        db
          .from('appointments')
          .select('id, household_id, review_id, scheduled_at, status, external_ref, opportunity_id')
          .order('scheduled_at', { ascending: true, nullsFirst: false }),
      [],
    ),
    load<{ id: string; primary_name: string | null }[]>(
      (db) => db.from('households').select('id, primary_name').is('deleted_at', null).limit(5000),
      [],
    ),
  ])

  if (!res.ok) {
    return (
      <ListShell title="Calendar" description="Upcoming appointments and reviews." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Calendar' }]}>
        {res.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set Supabase env vars to load appointments." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const appts = res.data
  const names = new Map((householdsRes.ok ? householdsRes.data : []).map((h) => [h.id, h.primary_name]))
  const nameOf = (id: string | null) => (id ? names.get(id) ?? 'Household' : 'Household')

  const now = new Date()
  const funnel = appointmentFunnel(appts as Appointment[])
  const overdue = appts.filter((a) => isOverdue(a as Appointment, now))
  const noShows = appts.filter((a) => needsRecovery(a as Appointment))

  return (
    <ListShell
      title="Calendar"
      description="Upcoming appointments and reviews — with lifecycle triage and no-show recovery."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Calendar' }]}
      actions={<RunAppointmentRecoveryButton />}
    >
      <div className="space-y-6">
        {/* Appointment funnel */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Scheduled" value={funnel.scheduled} hint="Upcoming / open" />
          <StatTile label="Held" value={funnel.completed} hint="Completed meetings" />
          <StatTile label="No-shows" value={funnel.noShow} tone={funnel.noShow > 0 ? 'attention' : 'neutral'} hint="Missed — recover below" />
          <StatTile label="Show rate" value={`${funnel.showRate}%`} hint="Held ÷ (held + no-show)" />
        </div>

        {/* Overdue — needs a decision */}
        {overdue.length > 0 ? (
          <Section title="Overdue — needs a decision" description="Scheduled appointments whose time has passed. Mark each held or a no-show.">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Household</TableHead>
                    <TableHead className="text-right">Triage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.slice(0, 50).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{fmt(a.scheduled_at)}</TableCell>
                      <TableCell>{nameOf(a.household_id)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <AppointmentStatusControls appointmentId={a.id} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        ) : null}

        {/* No-shows awaiting recovery */}
        {noShows.length > 0 ? (
          <Section
            title="No-shows"
            description="Missed appointments. Run no-show recovery to create a reschedule follow-up task for each (deduplicated)."
            action={<RunAppointmentRecoveryButton />}
          >
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Household</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noShows.slice(0, 50).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{fmt(a.scheduled_at)}</TableCell>
                      <TableCell>{nameOf(a.household_id)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        ) : null}

        <Section title="Agenda" description="All appointments by day.">
          <CalendarView rows={appts} />
        </Section>

        <IntegrationShell
          name="Google Calendar"
          status="disconnected"
          fallbackNote="No verified Google Calendar connection — appointments are entered manually until an integration is configured. FSOS never invents an unavailable API."
        />
      </div>
    </ListShell>
  )
}
