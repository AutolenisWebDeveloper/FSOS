import Link from 'next/link'
import { ListShell, Section, ErrorState, EmptyState, IntegrationShell, StatTile } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { load, unwrapOne } from '@/lib/data/query'
import { CalendarView, type AppointmentRow } from '@/components/app/CalendarView'
import { AppointmentList, type AppointmentListRow } from '@/components/app/AppointmentList'
import { AppointmentCalendarGrid } from '@/components/app/AppointmentCalendarGrid'
import { RunAppointmentRecoveryButton } from '@/components/app/RunAppointmentRecoveryButton'
import { AppointmentStatusControls } from '@/components/app/AppointmentStatusControls'
import { appointmentFunnel, isOverdue, needsRecovery, type Appointment } from '@/lib/appointments/recovery'
import { summarizeCommandCenter, type CommandRow } from '@/lib/appointments/list'

export const dynamic = 'force-dynamic'

// FSA business timezone for the "today" bucket (config default — Plano/TX practice, Central).
const BUSINESS_TZ = 'America/Chicago'

interface NamedRel {
  name?: string | null
  full_name?: string | null
}
interface ApptRow extends AppointmentRow {
  opportunity_id: string | null
  starts_at: string | null
  meeting_mode: string | null
  booked_via: string | null
  appointment_types: NamedRel | NamedRel[] | null
  contacts: NamedRel | NamedRel[] | null
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
  const [res, householdsRes, followupRes, notesRes] = await Promise.all([
    load<ApptRow[]>(
      (db) =>
        db
          .from('appointments')
          .select(
            'id, household_id, review_id, scheduled_at, starts_at, status, external_ref, opportunity_id, ' +
              'meeting_mode, booked_via, appointment_types:appointment_type_id(name), contacts:contact_id(full_name)',
          )
          .order('scheduled_at', { ascending: true, nullsFirst: false }),
      [],
    ),
    load<{ id: string; primary_name: string | null }[]>(
      (db) => db.from('households').select('id, primary_name').is('deleted_at', null).limit(5000),
      [],
    ),
    // Open follow-up tasks keyed to appointments (the "follow-ups due" signal).
    load<{ entity_id: string }[]>(
      (db) => db.from('work_tasks').select('entity_id').eq('entity_type', 'appointment').eq('completed', false),
      [],
    ),
    // Appointments with a logged note (the "missing notes" signal is the complement).
    load<{ entity_id: string }[]>(
      (db) => db.from('activities').select('entity_id').eq('entity_type', 'appointment').eq('kind', 'appointment_note'),
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

  // Rows for the filterable operational list — contact name (native bookings) first, else the
  // household name, else a neutral fallback; type name + format from the joined relations.
  const listRows: AppointmentListRow[] = appts.map((a) => {
    const contactName = unwrapOne(a.contacts)?.full_name ?? null
    const householdName = a.household_id ? names.get(a.household_id) ?? null : null
    return {
      id: a.id,
      whenIso: a.starts_at ?? a.scheduled_at,
      personName: contactName ?? householdName ?? 'Appointment',
      typeName: unwrapOne(a.appointment_types)?.name ?? null,
      status: a.status,
      meetingMode: a.meeting_mode,
      bookedVia: a.booked_via,
    }
  })

  const now = new Date()
  const funnel = appointmentFunnel(appts as Appointment[])
  const overdue = appts.filter((a) => isOverdue(a as Appointment, now))
  const noShows = appts.filter((a) => needsRecovery(a as Appointment))

  // Command-center KPIs (P2) — buckets derived through the pure read model so they can never
  // drift from the triage tables below (both reuse isOverdue / needsRecovery).
  const nowMs = now.getTime()
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const summary = summarizeCommandCenter(appts as unknown as CommandRow[], {
    nowMs,
    tz: BUSINESS_TZ,
    todayKey,
    weekEndMs: nowMs + 7 * 24 * 60 * 60 * 1000,
    openFollowupApptIds: new Set((followupRes.ok ? followupRes.data : []).map((r) => r.entity_id)),
    notedApptIds: new Set((notesRes.ok ? notesRes.data : []).map((r) => r.entity_id)),
  })

  return (
    <ListShell
      title="Calendar"
      description="Upcoming appointments and reviews — with lifecycle triage and no-show recovery."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Calendar' }]}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/app/calendar/analytics">Analytics</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/booking">Booking settings</Link>
          </Button>
          <RunAppointmentRecoveryButton />
        </div>
      }
    >
      <div className="space-y-6">
        {/* Command center — what needs attention now. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Today" value={summary.today} hint="Scheduled for today" />
          <StatTile label="Next 7 days" value={summary.upcoming} hint="Upcoming appointments" />
          <StatTile
            label="Needs a decision"
            value={summary.overdue}
            tone={summary.overdue > 0 ? 'attention' : 'neutral'}
            hint="Past — mark held / no-show"
          />
          <StatTile
            label="No-shows"
            value={summary.noShow}
            tone={summary.noShow > 0 ? 'attention' : 'neutral'}
            hint="Awaiting recovery"
          />
          <StatTile label="Follow-ups due" value={summary.followUpsDue} hint="Open reschedule tasks" />
          <StatTile label="Missing notes" value={summary.missingNotes} hint="Held meetings with no note" />
        </div>

        {/* Book health (honest funnel — show rate = held ÷ held+no-show). */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Scheduled" value={funnel.scheduled} hint="Upcoming / open" />
          <StatTile label="Held" value={funnel.completed} hint="Completed meetings" />
          <StatTile label="Cancelled" value={funnel.cancelled} hint="Cancelled appointments" />
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

        <Section
          title="All appointments"
          description="Search, filter by status, and sort your whole book. Triage scheduled rows inline."
        >
          <AppointmentList rows={listRows} />
        </Section>

        <Section title="Calendar" description="Your booked appointments by week or month.">
          <AppointmentCalendarGrid rows={listRows} tz={BUSINESS_TZ} />
        </Section>

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
