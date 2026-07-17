import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { DetailShell, ErrorState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { MonoLabel } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/supabase/client'
import { WorkshopStatusControl } from '@/components/app/WorkshopStatusControl'
import { WorkshopRegistrations, type Registration } from '@/components/app/WorkshopRegistrations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_MAP: Record<string, StatusKey> = {
  draft: 'draft',
  published: 'active',
  completed: 'won',
  cancelled: 'lost',
}

interface Workshop {
  workshop_id: string
  title: string
  topic: string
  status: string
  description: string | null
  scheduled_at: string | null
  location: string | null
  max_attendees: number | null
}

// Workshop detail (docs/legacy-port.md §2.5) — A3. Registrations, attendance, and
// convert-attendee-to-referral. Public registration opens when published.
export default async function WorkshopDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireRole('fsa', `/app/workshops/${params.id}`)

  let workshop: Workshop | null = null
  let registrations: Registration[] = []
  try {
    const db = getDb()
    const { data: w } = await db
      .from('workshops')
      .select('workshop_id, title, topic, status, description, scheduled_at, location, max_attendees')
      .eq('workshop_id', params.id)
      .maybeSingle()
    workshop = (w as Workshop) ?? null
    if (workshop) {
      const { data: regs } = await db
        .from('workshop_registrations')
        .select('reg_id, name, email, phone, status, attended, referral_id, consent_channels')
        .eq('workshop_id', params.id)
        .order('registered_at', { ascending: false, nullsFirst: false })
      registrations = (regs as Registration[]) ?? []
    }
  } catch (e) {
    return (
      <div className="space-y-6">
        <ErrorState description={e instanceof Error ? e.message : 'Failed to load workshop'} />
      </div>
    )
  }
  if (!workshop) notFound()

  const registered = registrations.length
  const attended = registrations.filter((r) => r.attended).length

  return (
    <DetailShell
      title={workshop.title}
      description={`${workshop.topic} · ${workshop.scheduled_at ? new Date(workshop.scheduled_at).toLocaleString() : 'TBA'}`}
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Workshops', href: '/app/workshops' },
        { label: workshop.title },
      ]}
      status={<StatusBadge status={STATUS_MAP[workshop.status] ?? 'draft'} label={workshop.status} />}
      actions={<WorkshopStatusControl workshopId={workshop.workshop_id} status={workshop.status} />}
      rail={
        <div className="space-y-4">
          <section className="space-y-2">
            <MonoLabel>Details</MonoLabel>
            <dl className="space-y-2 text-sm">
              <Row label="Location" value={workshop.location ?? 'TBA'} />
              <Row label="Capacity" value={workshop.max_attendees ? String(workshop.max_attendees) : 'Unlimited'} />
              <Row label="Registered" value={String(registered)} />
              <Row label="Attended" value={String(attended)} />
            </dl>
          </section>
          {workshop.status === 'published' ? (
            <section className="space-y-2">
              <MonoLabel>Public registration</MonoLabel>
              <a
                href={`/events/${workshop.workshop_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <span className="numeric">/events/{workshop.workshop_id.slice(0, 8)}…</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </section>
          ) : (
            <p className="text-xs text-muted-foreground">Publish this workshop to open public registration.</p>
          )}
        </div>
      }
    >
      {workshop.description ? <p className="text-sm text-muted-foreground">{workshop.description}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrations</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkshopRegistrations registrations={registrations} />
        </CardContent>
      </Card>
    </DetailShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  )
}
