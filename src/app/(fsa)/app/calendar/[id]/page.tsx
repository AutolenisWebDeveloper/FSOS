import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, Section, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { load, unwrapOne } from '@/lib/data/query'
import { getServerSession } from '@/lib/auth/session'
import { loadCommTimeline } from '@/lib/comms/timeline-load'
import { CommTimeline } from '@/components/comms/CommTimeline'
import { AppointmentStatusControls } from '@/components/app/AppointmentStatusControls'
import { AppointmentActions } from '@/components/app/AppointmentActions'
import { STATUS_MAP } from '@/components/app/CalendarView'
import { meetingModeLabel } from '@/lib/booking/display'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Rel {
  name?: string | null
  full_name?: string | null
  primary_name?: string | null
  email?: string | null
  phone?: string | null
}
interface ApptDetail {
  id: string
  status: string
  scheduled_at: string | null
  starts_at: string | null
  ends_at: string | null
  external_ref: string | null
  booked_via: string | null
  meeting_mode: string | null
  cancellation_reason: string | null
  reminder_sent_at: string | null
  join_url: string | null
  duration_minutes: number | null
  household_id: string | null
  contact_id: string | null
  review_id: string | null
  opportunity_id: string | null
  appointment_types: Rel | Rel[] | null
  contacts: Rel | Rel[] | null
  households: Rel | Rel[] | null
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
}

export default async function AppointmentDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const res = await load<ApptDetail | null>(
    (db) =>
      db
        .from('appointments')
        .select(
          'id, status, scheduled_at, starts_at, ends_at, external_ref, booked_via, meeting_mode, ' +
            'cancellation_reason, reminder_sent_at, join_url, duration_minutes, household_id, contact_id, ' +
            'review_id, opportunity_id, appointment_types:appointment_type_id(name), ' +
            'contacts:contact_id(full_name, email, phone), households:household_id(primary_name)',
        )
        .eq('id', id)
        .maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const a = res.data
  if (!a) notFound()

  // Timeline authorization is server-enforced: reads are RLS-scoped and redaction is derived from
  // the viewer's session roles (bodies / recipients / provider ids), never from the client.
  const session = await getServerSession()
  const timeline = await loadCommTimeline('appointment', a.id, session?.roles ?? [])

  const contact = unwrapOne(a.contacts)
  const household = unwrapOne(a.households)
  const typeName = unwrapOne(a.appointment_types)?.name ?? null
  const personName = contact?.full_name ?? household?.primary_name ?? 'Appointment'
  const whenIso = a.starts_at ?? a.scheduled_at
  const s = STATUS_MAP[a.status] ?? { key: 'draft' as const, label: a.status }

  const rail = (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Appointment details</p>
      <dl className="space-y-1.5">
        <Row label="When" value={fmt(whenIso)} />
        <Row label="Ends" value={fmt(a.ends_at)} />
        {a.duration_minutes ? <Row label="Duration" value={`${a.duration_minutes} min`} /> : null}
        <Row label="Type" value={typeName} />
        <Row label="Format" value={a.meeting_mode ? meetingModeLabel(a.meeting_mode) : null} />
        <Row label="Booked via" value={a.booked_via} />
        <Row label="Reminder sent" value={a.reminder_sent_at ? fmt(a.reminder_sent_at) : 'Not yet'} />
        {a.external_ref ? <Row label="Calendar ref" value={a.external_ref} mono /> : null}
      </dl>
      {contact?.phone || contact?.email ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Contact</p>
          <dl className="space-y-1.5">
            <Row label="Phone" value={contact?.phone ?? null} mono />
            <Row label="Email" value={contact?.email ?? null} />
          </dl>
        </div>
      ) : null}
      <ul className="space-y-1.5 pt-1">
        {a.contact_id ? <li><Link href={`/app/contacts/${a.contact_id}`} className="text-primary hover:underline">Open contact</Link></li> : null}
        {a.household_id ? <li><Link href={`/app/households/${a.household_id}`} className="text-primary hover:underline">Open household</Link></li> : null}
        {a.review_id ? <li><Link href={`/app/reviews/${a.review_id}`} className="text-primary hover:underline">Open review</Link></li> : null}
        {a.opportunity_id ? <li><Link href={`/app/opportunities/${a.opportunity_id}`} className="text-primary hover:underline">Open opportunity</Link></li> : null}
        {a.meeting_mode === 'video' && a.join_url ? (
          <li><a href={a.join_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Join link</a></li>
        ) : null}
      </ul>
    </div>
  )

  return (
    <DetailShell
      title={personName}
      description={[typeName ?? 'Appointment', fmt(whenIso)].filter(Boolean).join(' · ')}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Calendar', href: '/app/calendar' }, { label: personName }]}
      status={<StatusBadge status={s.key} label={s.label} />}
      actions={a.status === 'scheduled' ? <AppointmentStatusControls appointmentId={a.id} /> : undefined}
      rail={rail}
    >
      <div className="space-y-6">
        {a.status === 'cancelled' && a.cancellation_reason ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="font-medium">Cancellation reason</p>
            <p className="mt-1 text-muted-foreground">{a.cancellation_reason}</p>
          </div>
        ) : null}

        <Section title="Actions" description="Log an internal note or queue a follow-up task. Neither contacts the client.">
          <AppointmentActions appointmentId={a.id} />
        </Section>

        <Section
          title="Activity"
          description="Messages, delivery events, and record changes for this appointment — newest first."
        >
          <CommTimeline
            entries={timeline}
            emptyHint="No messages or changes recorded yet. Reminders and status changes will appear here."
          />
        </Section>
      </div>
    </DetailShell>
  )
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>{value || '—'}</dd>
    </div>
  )
}
