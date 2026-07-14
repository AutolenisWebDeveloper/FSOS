import { ListShell, ErrorState, EmptyState, IntegrationShell } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { CalendarView, type AppointmentRow } from '@/components/app/CalendarView'

export const dynamic = 'force-dynamic'

// P0 Calendar (A2 agenda + A12 labeled manual fallback). FSOS never invents an
// unavailable Google Calendar API — appointments are entered manually until a
// verified integration is configured.
export default async function CalendarPage() {
  const res = await load<AppointmentRow[]>(
    (db) =>
      db
        .from('appointments')
        .select('id, household_id, review_id, scheduled_at, status, external_ref')
        .order('scheduled_at', { ascending: true, nullsFirst: false }),
    [],
  )

  let body: React.ReactNode
  if (!res.ok) {
    body =
      res.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load appointments." />
      ) : (
        <ErrorState description={res.message} />
      )
  } else {
    body = <CalendarView rows={res.data} />
  }

  return (
    <ListShell
      title="Calendar"
      description="Upcoming appointments and reviews."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Calendar' }]}
    >
      <div className="space-y-6">
        {body}
        <IntegrationShell
          name="Google Calendar"
          status="disconnected"
          fallbackNote="No verified Google Calendar connection — appointments are entered manually until an integration is configured. FSOS never invents an unavailable API."
        />
      </div>
    </ListShell>
  )
}
