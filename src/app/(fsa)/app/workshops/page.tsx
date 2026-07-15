import Link from 'next/link'
import { Plus, GraduationCap } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface WorkshopRow {
  workshop_id: string
  title: string
  topic: string
  status: string
  scheduled_at: string | null
  location: string | null
  max_attendees: number | null
}

const STATUS_MAP: Record<string, StatusKey> = {
  draft: 'draft',
  published: 'active',
  completed: 'won',
  cancelled: 'lost',
}

// Workshops directory (docs/legacy-port.md §2.5) — A2. Educational events only; no
// product pitch in automated invites. Publish a workshop to open public registration.
export default async function WorkshopsPage() {
  await requireRole('fsa', '/app/workshops')

  const [workshops, regs] = await Promise.all([
    load<WorkshopRow[]>(
      (db) =>
        db
          .from('workshops')
          .select('workshop_id, title, topic, status, scheduled_at, location, max_attendees')
          .order('scheduled_at', { ascending: false, nullsFirst: false }),
      [],
    ),
    load<{ workshop_id: string }[]>((db) => db.from('workshop_registrations').select('workshop_id'), []),
  ])

  const regCount = new Map<string, number>()
  if (regs.ok) for (const r of regs.data) regCount.set(r.workshop_id, (regCount.get(r.workshop_id) ?? 0) + 1)

  const actions = (
    <Button asChild>
      <Link href="/app/workshops/new">
        <Plus className="h-4 w-4" /> New workshop
      </Link>
    </Button>
  )

  let body: React.ReactNode
  if (!workshops.ok) {
    body =
      workshops.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load workshops." />
      ) : (
        <ErrorState description={workshops.message} />
      )
  } else if (workshops.data.length === 0) {
    body = (
      <EmptyState
        icon={GraduationCap}
        title="No workshops yet"
        description="Create an educational workshop, publish it, and share the registration link."
        action={
          <Button asChild>
            <Link href="/app/workshops/new">
              <Plus className="h-4 w-4" /> New workshop
            </Link>
          </Button>
        }
      />
    )
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workshop</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Registered</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workshops.data.map((w) => (
            <TableRow key={w.workshop_id}>
              <TableCell>
                <Link href={`/app/workshops/${w.workshop_id}`} className="block font-medium hover:underline">
                  {w.title}
                </Link>
                <span className="text-xs capitalize text-muted-foreground">{w.topic}</span>
              </TableCell>
              <TableCell className="numeric text-muted-foreground">
                {w.scheduled_at ? new Date(w.scheduled_at).toLocaleString() : 'TBA'}
              </TableCell>
              <TableCell>
                <StatusBadge status={STATUS_MAP[w.status] ?? 'draft'} label={w.status} />
              </TableCell>
              <TableCell className="numeric text-right">
                {regCount.get(w.workshop_id) ?? 0}
                {w.max_attendees ? <span className="text-muted-foreground"> / {w.max_attendees}</span> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <ListShell
      title="Workshops"
      description="Educational seminars and their registrations. Invitations run through the comms gate — event content only."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Workshops' }]}
      actions={actions}
    >
      {body}
    </ListShell>
  )
}
