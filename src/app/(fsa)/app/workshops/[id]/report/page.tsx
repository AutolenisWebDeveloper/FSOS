import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ReportShell, ErrorState, AssumptionBadge, StatusBadge, SecuritiesChip, type StatusKey } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Numeric, MonoLabel } from '@/components/ui/typography'
import { getDb } from '@/lib/supabase/client'
import { loadWorkshop, loadWorkshopsForYear, buildWorkshopAnalytics } from '@/lib/workshops/analytics-server'
import { costPerLead, rollupByGroup, pct, type WorkshopRollupInput } from '@/lib/workshops/attendance'

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

// Per-workshop report (spec §5) — A11 ReportShell. Attendance split in-person/virtual,
// no-show rate, consult-conversion funnel, lead-source attribution, and the year-wide
// per-presenter / per-fund-family performance rollup (which wholesaler converts). Every
// benchmark/planning figure and cost-per-lead carries the gold assumption badge.
export default async function WorkshopReportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/workshops/${params.id}/report`)

  try {
    const db = getDb()
    const workshop = await loadWorkshop(db, params.id)
    if (!workshop) notFound()

    const single = await buildWorkshopAnalytics(db, [workshop])
    const a = single.get(params.id)
    if (!a) notFound()
    const { stats, consults, leadSources } = a

    // Year-wide rollup context (per-presenter / per-fund-family).
    const year = workshop.scheduled_at ? new Date(workshop.scheduled_at).getUTCFullYear() : new Date().getFullYear()
    const yearStart = new Date(Date.UTC(year, 0, 1)).toISOString()
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1)).toISOString()
    const yearWorkshops = await loadWorkshopsForYear(db, yearStart, yearEnd)
    const yearAnalytics = await buildWorkshopAnalytics(db, yearWorkshops)
    const rollupInputs: WorkshopRollupInput[] = [...yearAnalytics.values()].map((x) => ({
      workshop_id: x.workshop.workshop_id,
      groups: x.groups.map((g) => ({ key: g.key, label: g.label })),
      stats: x.stats,
      consults: x.consults,
    }))
    const presenterRollup = rollupByGroup(rollupInputs)

    const cpl = costPerLead(workshop.budget_spend, consults.consultsBooked)

    return (
      <ReportShell
        title={`Report — ${workshop.title}`}
        description="Funnel, attendance split, and presenter performance."
        actions={
          <Link href={`/app/workshops/${params.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Link>
        }
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={STATUS_MAP[workshop.status ?? 'draft'] ?? 'draft'} label={(workshop.status ?? 'draft').replace('_', ' ')} />
            {workshop.is_security ? <SecuritiesChip /> : null}
            <span className="text-sm text-muted-foreground">
              {workshop.scheduled_at ? new Date(workshop.scheduled_at).toLocaleDateString() : 'TBA'} · {(workshop.delivery_mode ?? 'in_person').replace('_', '-')}
            </span>
          </div>
        }
      >
        {/* Headline metrics. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Registrations" value={String(stats.registrations)} />
          <Metric label="Attendance rate" value={pct(stats.attendanceRate)} hint={`${stats.attended + stats.leftEarly} showed`} />
          <Metric label="No-show rate" value={pct(stats.noShowRate)} hint={`${stats.noShow} no-shows`} />
          <Metric
            label="Cost / lead"
            value={cpl != null ? `$${cpl.toFixed(0)}` : '—'}
            hint={cpl != null ? undefined : 'enter event spend to compute'}
            badge={cpl != null}
          />
        </div>

        {/* Attendance split in-person vs virtual. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance split</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Delivery</TableHead>
                    <TableHead className="text-right">Registered</TableHead>
                    <TableHead className="text-right">Attended</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <SplitRow label="In-person" reg={stats.inPerson.registrations} att={stats.inPerson.attended} rate={stats.inPerson.attendanceRate} />
                  <SplitRow label="Virtual" reg={stats.virtual.registrations} att={stats.virtual.attended} rate={stats.virtual.attendanceRate} />
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Consult-conversion funnel. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consult conversion</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Metric label="Registrations" value={String(consults.registrations)} />
            <Metric label="Consults booked" value={String(consults.consultsBooked)} hint={`${pct(consults.bookedRate)} of registrations`} />
            <Metric label="Consults showed" value={String(consults.consultsShowed)} hint={`${pct(consults.showRate)} of booked`} />
          </CardContent>
        </Card>

        {/* Lead-source attribution. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead-source attribution</CardTitle>
          </CardHeader>
          <CardContent>
            {leadSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No registrations yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source (agency slug / campaign / UTM)</TableHead>
                      <TableHead className="text-right">Registrations</TableHead>
                      <TableHead className="text-right">Attended</TableHead>
                      <TableHead className="text-right">Converted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leadSources.map((s) => (
                      <TableRow key={s.source}>
                        <TableCell className="numeric">{s.source}</TableCell>
                        <TableCell className="numeric text-right">{s.registrations}</TableCell>
                        <TableCell className="numeric text-right">{s.attended}</TableCell>
                        <TableCell className="numeric text-right">{s.converted}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Year-wide per-presenter / per-fund-family rollup. */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Presenter / fund-family performance · {year}</CardTitle>
              <AssumptionBadge label="benchmark targets are config defaults" />
            </div>
          </CardHeader>
          <CardContent>
            {presenterRollup.length === 0 ? (
              <p className="text-sm text-muted-foreground">No presenter-attributed workshops this year yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Presenter / fund family</TableHead>
                      <TableHead className="text-right">Workshops</TableHead>
                      <TableHead className="text-right">Registrations</TableHead>
                      <TableHead className="text-right">Attendance</TableHead>
                      <TableHead className="text-right">Consults</TableHead>
                      <TableHead className="text-right">Conversion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {presenterRollup.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="numeric text-right">{r.workshops}</TableCell>
                        <TableCell className="numeric text-right">{r.registrations}</TableCell>
                        <TableCell className="numeric text-right">{pct(r.attendanceRate)}</TableCell>
                        <TableCell className="numeric text-right">{r.consultsBooked}</TableCell>
                        <TableCell className="numeric text-right">{pct(r.conversionRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </ReportShell>
    )
  } catch (e) {
    return <ErrorState description={e instanceof Error ? e.message : 'Failed to load report'} />
  }
}

function Metric({ label, value, hint, badge }: { label: string; value: string; hint?: string; badge?: boolean }) {
  return (
    <Card className="p-4">
      <MonoLabel>{label}</MonoLabel>
      <Numeric as="div" className="mt-1.5 text-2xl font-semibold leading-none tracking-tight">
        {value}
      </Numeric>
      {badge ? (
        <div className="mt-2">
          <AssumptionBadge />
        </div>
      ) : null}
      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  )
}

function SplitRow({ label, reg, att, rate }: { label: string; reg: number; att: number; rate: number }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="numeric text-right">{reg}</TableCell>
      <TableCell className="numeric text-right">{att}</TableCell>
      <TableCell className="numeric text-right">{pct(rate)}</TableCell>
    </TableRow>
  )
}
