import Link from 'next/link'
import { Plus, GraduationCap, CalendarDays, Users, Percent, UserX, CalendarCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import {
  DashboardShell,
  StatTile,
  Section,
  ErrorState,
  EmptyState,
  StatusBadge,
  AssumptionBadge,
  type StatusKey,
} from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { getDb } from '@/lib/supabase/client'
import { loadWorkshopsForYear, buildWorkshopAnalytics } from '@/lib/workshops/analytics-server'
import { computeDashboardTiles, pct, type AttendanceStats, type ConsultConversion } from '@/lib/workshops/attendance'
import { WorkshopFilters, type FilterOption } from '@/components/app/WorkshopFilters'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_MAP: Record<string, StatusKey> = {
  draft: 'draft',
  pending_review: 'pending',
  compliance_approved: 'active',
  published: 'active',
  completed: 'won',
  cancelled: 'lost',
}
const STATUS_OPTIONS: FilterOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'compliance_approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]
const DELIVERY_OPTIONS: FilterOption[] = [
  { value: 'in_person', label: 'In-person' },
  { value: 'virtual', label: 'Virtual' },
  { value: 'hybrid', label: 'Hybrid' },
]

// Workshop Ops dashboard (spec §3.3, §5) — A1. Across ALL workshops for the year:
// top-line StatTiles + a filterable table (status, delivery, presenter/fund-family, year).
export default async function WorkshopsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('fsa', '/app/workshops')
  const sp = await props.searchParams

  const nowIso = new Date().toISOString()
  const year = Number(sp.year) || new Date().getFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1)).toISOString()
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1)).toISOString()
  const fStatus = sp.status ?? 'all'
  const fDelivery = sp.delivery ?? 'all'
  const fPresenter = sp.presenter ?? 'all'

  let body: React.ReactNode = null
  let tiles = { upcoming: 0, totalRegistrations: 0, avgAttendanceRate: 0, avgNoShowRate: 0, consultsBooked: 0 }
  let presenterOptions: FilterOption[] = []

  try {
    const db = getDb()
    const allWorkshops = await loadWorkshopsForYear(db, yearStart, yearEnd)
    const analytics = await buildWorkshopAnalytics(db, allWorkshops)

    // Presenter/fund-family filter options (deduped across the year).
    const optMap = new Map<string, string>()
    for (const a of analytics.values()) for (const g of a.groups) optMap.set(g.key, g.label)
    presenterOptions = [...optMap.entries()].map(([value, label]) => ({ value, label })).sort((x, y) => x.label.localeCompare(y.label))

    // Apply filters.
    const filtered = allWorkshops.filter((w) => {
      if (fStatus !== 'all' && (w.status ?? 'draft') !== fStatus) return false
      if (fDelivery !== 'all' && (w.delivery_mode ?? 'in_person') !== fDelivery) return false
      if (fPresenter !== 'all') {
        const groups = analytics.get(w.workshop_id)?.groups ?? []
        if (!groups.some((g) => g.key === fPresenter)) return false
      }
      return true
    })

    // Tiles reflect the filtered set (default: all for the year).
    const statsMap = new Map<string, AttendanceStats>()
    const consultsMap = new Map<string, ConsultConversion>()
    for (const w of filtered) {
      const a = analytics.get(w.workshop_id)
      if (a) {
        statsMap.set(w.workshop_id, a.stats)
        consultsMap.set(w.workshop_id, a.consults)
      }
    }
    tiles = computeDashboardTiles(filtered, statsMap, consultsMap, nowIso)

    if (allWorkshops.length === 0) {
      body = (
        <EmptyState
          icon={GraduationCap}
          title={`No workshops in ${year}`}
          description="Create an educational workshop, get it approved, publish it, and share the registration link."
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
              <TableHead>Format</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Reg</TableHead>
              <TableHead className="text-right">Attend</TableHead>
              <TableHead className="text-right">Consults</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((w) => {
              const a = analytics.get(w.workshop_id)
              const stats = a?.stats
              const consults = a?.consults
              return (
                <TableRow key={w.workshop_id}>
                  <TableCell>
                    <Link href={`/app/workshops/${w.workshop_id}`} className="block font-medium hover:underline">
                      {w.title}
                    </Link>
                    <span className="text-xs capitalize text-muted-foreground">{w.topic ?? '—'}</span>
                  </TableCell>
                  <TableCell className="numeric text-muted-foreground">
                    <Numeric>{w.scheduled_at ? new Date(w.scheduled_at).toLocaleDateString() : 'TBA'}</Numeric>
                  </TableCell>
                  <TableCell className="text-sm capitalize text-muted-foreground">{(w.delivery_mode ?? 'in_person').replace('_', '-')}</TableCell>
                  <TableCell>
                    <StatusBadge status={STATUS_MAP[w.status ?? 'draft'] ?? 'draft'} label={(w.status ?? 'draft').replace('_', ' ')} />
                  </TableCell>
                  <TableCell className="numeric text-right">{stats?.registrations ?? 0}</TableCell>
                  <TableCell className="numeric text-right">{stats ? pct(stats.attendanceRate) : '—'}</TableCell>
                  <TableCell className="numeric text-right">{consults?.consultsBooked ?? 0}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )
    }
  } catch (e) {
    body = <ErrorState description={e instanceof Error ? e.message : 'Failed to load workshops'} />
  }

  const actions = (
    <Button asChild>
      <Link href="/app/workshops/new">
        <Plus className="h-4 w-4" /> New workshop
      </Link>
    </Button>
  )

  return (
    <div className="space-y-6">
      <DashboardShell
        title="Workshops"
        description="Seminar lead engine — attendance, conversion, and presenter performance across the year."
        actions={actions}
      >
        <StatTile label="Upcoming" value={tiles.upcoming} icon={CalendarDays} tone="brand" hint={`${year} scheduled`} />
        <StatTile label="Registrations" value={tiles.totalRegistrations} icon={Users} hint="total across shown workshops" />
        <StatTile label="Avg attendance" value={pct(tiles.avgAttendanceRate)} icon={Percent} tone="brand" hint="mean per-workshop rate" />
        <StatTile label="Avg no-show" value={pct(tiles.avgNoShowRate)} icon={UserX} tone="attention" hint="mean per-workshop rate" />
        <StatTile label="Consults booked" value={tiles.consultsBooked} icon={CalendarCheck} tone="brand" hint="attendees → consult/lead" />
      </DashboardShell>

      <Section
        title="All workshops"
        description="Benchmark targets shown elsewhere are planning ranges, not Farmers-published figures."
        action={<AssumptionBadge label="benchmarks are config defaults" />}
      >
        <WorkshopFilters
          statuses={STATUS_OPTIONS}
          deliveryModes={DELIVERY_OPTIONS}
          presenters={presenterOptions}
          current={{ status: fStatus, delivery: fDelivery, presenter: fPresenter, year: String(year) }}
        />
        <div className="mt-3 overflow-x-auto">{body}</div>
      </Section>
    </div>
  )
}
