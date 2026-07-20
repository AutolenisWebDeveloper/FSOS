import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ErrorState } from '@/components/archetypes'
import { getDb } from '@/lib/supabase/client'
import { WorkshopCheckIn, type CheckInRow } from '@/components/app/WorkshopCheckIn'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Workshop {
  workshop_id: string
  title: string
  scheduled_at: string | null
  max_attendees: number | null
  delivery_mode: string | null
}

// Kiosk / mobile check-in (spec §3.3, §5). Tablet-first, staff-authed. Search or scan a
// registrant's join_token, one-tap check-in (idempotent), walk-in add. Large touch
// targets, minimal chrome, offline-tolerant client (optimistic + safe retry).
export default async function WorkshopCheckInPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/workshops/${params.id}/check-in`)

  let workshop: Workshop | null = null
  let rows: CheckInRow[] = []
  try {
    const db = getDb()
    const { data: w } = await db
      .from('workshops')
      .select('workshop_id, title, scheduled_at, max_attendees, delivery_mode')
      .eq('workshop_id', params.id)
      .maybeSingle()
    workshop = (w as Workshop) ?? null
    if (workshop) {
      const { data: regs } = await db
        .from('workshop_registrations')
        .select('reg_id, name, email, join_token, chosen_delivery, is_walk_in')
        .eq('workshop_id', params.id)
        .order('name', { ascending: true, nullsFirst: false })
      const regRows = (regs as Omit<CheckInRow, 'attendance_status'>[]) ?? []
      const attMap = new Map<string, string>()
      const ids = regRows.map((r) => r.reg_id)
      if (ids.length > 0) {
        const { data: att } = await db.from('workshop_attendance').select('registration_id, status').in('registration_id', ids)
        for (const a of (att as { registration_id: string; status: string }[]) ?? []) attMap.set(a.registration_id, a.status)
      }
      rows = regRows.map((r) => ({ ...r, attendance_status: (attMap.get(r.reg_id) as CheckInRow['attendance_status']) ?? 'registered' }))
    }
  } catch (e) {
    return <ErrorState description={e instanceof Error ? e.message : 'Failed to load check-in'} />
  }
  if (!workshop) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/app/workshops/${workshop.workshop_id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to workshop
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check-in</h1>
        <p className="text-sm text-muted-foreground">
          {workshop.title}
          {workshop.scheduled_at ? ` · ${new Date(workshop.scheduled_at).toLocaleString()}` : ''}
        </p>
      </div>
      <WorkshopCheckIn
        workshopId={workshop.workshop_id}
        capacity={workshop.max_attendees}
        deliveryMode={workshop.delivery_mode ?? 'in_person'}
        initialRows={rows}
      />
    </div>
  )
}
