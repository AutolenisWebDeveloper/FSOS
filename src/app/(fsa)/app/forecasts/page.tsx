import { ReportShell, ErrorState, EmptyState, StatTile } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import {
  weightedPipeline,
  runRate,
  normalizeProbabilities,
  stageLabel,
  type OpenOpp,
  type ForecastStage,
  type MonthPoint,
} from '@/lib/analytics/forecast'
import { ForecastSettings } from '@/components/app/ForecastSettings'
import { ForecastExport, type ForecastCsvRow } from '@/components/app/ForecastExport'

export const dynamic = 'force-dynamic'

const OPEN_STAGE_FILTER = '("placed_issued","lost")'

interface SettingsRow {
  probabilities: unknown
  horizon_months: number | null
  is_assumption: boolean
}
interface MonthlyRow {
  month: string
  is_security: boolean
  fsa_amount: number | null
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

// OS-01 Advanced forecasting (A11, P3). Two projections from live data:
//   • Weighted pipeline — open opportunities' expected commission weighted by
//     stage close-probability (editable config ASSUMPTIONS, guardrail §2.3).
//   • Run-rate — trailing reconciled FSA commission projected forward.
// Securities-flagged production is tracked for the FSA's own forecast (firewall
// permits stage + expected/actual commission) but surfaced SEPARATELY so it is
// never conflated with an automated or client-facing surface.
export default async function ForecastsPage() {
  const [settingsRes, oppsRes, monthlyRes] = await Promise.all([
    load<SettingsRow | null>(
      (db) => db.from('forecast_settings').select('probabilities, horizon_months, is_assumption').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      null,
    ),
    load<OpenOpp[]>(
      (db) => db.from('opportunities').select('stage, expected_commission, is_security').is('deleted_at', null).not('stage', 'in', OPEN_STAGE_FILTER),
      [],
    ),
    load<MonthlyRow[]>(
      (db) => db.from('v_commission_monthly').select('month, is_security, fsa_amount').order('month', { ascending: true }),
      [],
    ),
  ])

  if (!oppsRes.ok) {
    return (
      <ReportShell title="Forecasts" description="Advanced forecasting.">
        <ErrorState description={oppsRes.kind === 'not_configured' ? 'Database not configured.' : oppsRes.message} />
      </ReportShell>
    )
  }

  const probabilities = normalizeProbabilities(settingsRes.ok && settingsRes.data ? settingsRes.data.probabilities : undefined)
  const horizon = Math.min(24, Math.max(1, (settingsRes.ok && settingsRes.data?.horizon_months) || 3))

  const pipeline = weightedPipeline(oppsRes.data, probabilities)

  // Roll monthly view rows (split by is_security) up to a single production series.
  const byMonth = new Map<string, { total: number; securities: number }>()
  if (monthlyRes.ok) {
    for (const r of monthlyRes.data) {
      const cur = byMonth.get(r.month) || { total: 0, securities: 0 }
      const amt = Number(r.fsa_amount) || 0
      cur.total += amt
      if (r.is_security) cur.securities += amt
      byMonth.set(r.month, cur)
    }
  }
  const history: MonthPoint[] = Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, v]) => ({ month, fsa_amount: v.total }))
    .slice(-12)
  const rr = runRate(history, horizon)

  const hasData = pipeline.rows.some((r) => r.open_count > 0) || history.length > 0
  const maxBar = Math.max(1, ...history.map((h) => h.fsa_amount), ...rr.projection.map((p) => p.fsa_amount))

  // Build the export payload from exactly what the page shows.
  const csvRows: ForecastCsvRow[] = [
    { section: 'summary', label: 'Weighted pipeline forecast', value: Math.round(pipeline.total_weighted) },
    { section: 'summary', label: 'Un-weighted expected (open)', value: Math.round(pipeline.total_expected) },
    { section: 'summary', label: `Run-rate projected (${horizon} mo)`, value: rr.projected_total },
    { section: 'summary', label: 'Securities-tracked (weighted)', value: Math.round(pipeline.securities_weighted) },
    ...pipeline.rows.map((r) => ({ section: 'stage', label: stageLabel(r.stage), value: Math.round(r.weighted) })),
    ...history.map((h) => ({ section: 'history', label: h.month, value: h.fsa_amount })),
    ...rr.projection.map((p) => ({ section: 'projection', label: p.month, value: p.fsa_amount })),
  ]

  return (
    <ReportShell
      title="Forecasts"
      description="Weighted pipeline and run-rate projections from live data."
      actions={<ForecastExport rows={csvRows} />}
    >
      {!hasData ? (
        <EmptyState
          title="Not enough data to forecast yet"
          description="Forecasts appear once you have open opportunities with expected commission or reconciled commission history."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Weighted pipeline" value={money(pipeline.total_weighted)} href="/app/opportunities/board" hint="Expected × stage probability" />
            <StatTile label="Un-weighted expected" value={money(pipeline.total_expected)} href="/app/opportunities" hint="All open expected commission" />
            <StatTile label={`Run-rate (${horizon} mo)`} value={money(rr.projected_total)} href="/app/commissions" hint="Projected from trailing actuals" />
            <StatTile label="Securities (tracked)" value={money(pipeline.securities_weighted)} href="/app/opportunities" hint="Production tracking only — via FFS" />
          </div>

          {/* Securities firewall note */}
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Securities-flagged opportunities are included in this forecast for the FSA&apos;s own production tracking only — never in any automated or client-facing surface. Any securities activity is handled through the FFS-supervised system.
          </p>

          {/* Stage breakdown — weighted pipeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weighted pipeline by stage</CardTitle>
              <div className="pt-1">
                <ForecastSettings probabilities={probabilities} horizonMonths={horizon} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Probability</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Weighted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pipeline.rows.map((r) => (
                      <TableRow key={r.stage}>
                        <TableCell className="capitalize">{stageLabel(r.stage)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Math.round(r.probability * 100)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{r.open_count}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.expected)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.weighted)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>Total</TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums">{pipeline.rows.reduce((a, r) => a + r.open_count, 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(pipeline.total_expected)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(pipeline.total_weighted)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Run-rate — history + projection (chart + data-table fallback for a11y) */}
          <Card>
            <CardHeader><CardTitle className="text-base">FSA commission — trailing actuals &amp; projection</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Simple bar chart; the table below is the accessible data fallback. */}
              <div className="flex items-end gap-1 overflow-x-auto pb-2" aria-hidden>
                {history.map((h) => (
                  <div key={h.month} className="flex w-10 shrink-0 flex-col items-center gap-1">
                    <div className="w-6 rounded-t bg-primary/70" style={{ height: `${Math.round((h.fsa_amount / maxBar) * 96) + 2}px` }} title={`${h.month}: ${money(h.fsa_amount)}`} />
                    <span className="text-[10px] text-muted-foreground">{h.month.slice(2)}</span>
                  </div>
                ))}
                {rr.projection.map((p) => (
                  <div key={p.month} className="flex w-10 shrink-0 flex-col items-center gap-1">
                    <div className="w-6 rounded-t border border-dashed border-primary bg-primary/20" style={{ height: `${Math.round((p.fsa_amount / maxBar) * 96) + 2}px` }} title={`${p.month} (projected): ${money(p.fsa_amount)}`} />
                    <span className="text-[10px] text-primary">{p.month.slice(2)}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border">
                <Table>
                  <caption className="sr-only">Trailing FSA commission actuals and projected values by month.</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">FSA commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.month}>
                        <TableCell>{h.month}</TableCell>
                        <TableCell className="text-muted-foreground">actual</TableCell>
                        <TableCell className="text-right tabular-nums">{money(h.fsa_amount)}</TableCell>
                      </TableRow>
                    ))}
                    {rr.projection.map((p) => (
                      <TableRow key={p.month}>
                        <TableCell>{p.month}</TableCell>
                        <TableCell className="text-primary">projected</TableCell>
                        <TableCell className="text-right tabular-nums">{money(p.fsa_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Run-rate blends the trailing {rr.history.length}-month average ({money(rr.avg_monthly)}/mo) with its linear trend. Projections are estimates, not guarantees.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </ReportShell>
  )
}
