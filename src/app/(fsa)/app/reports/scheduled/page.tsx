import { ListShell, EmptyState, ErrorState } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { ScheduledReportForm } from '@/components/app/ReportBuilder'

export const dynamic = 'force-dynamic'

type ScheduledReportRow = {
  id: string
  report_key: string
  name: string
  cadence: 'daily' | 'weekly' | 'monthly'
  format: 'csv' | 'pdf'
  recipients: string[] | null
  enabled: boolean
  next_run_at: string | null
}

const BREADCRUMB = [{ label: 'FSA', href: '/app' }, { label: 'Reports', href: '/app/reports' }, { label: 'Scheduled' }]

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// A2 — Scheduled reports. Delivery runs via Vercel Cron; recipients receive the exported file.
export default async function ScheduledReportsPage() {
  const res = await load<ScheduledReportRow[]>(
    (db) => db.from('scheduled_reports').select('id, report_key, name, cadence, format, recipients, enabled, next_run_at').order('created_at', { ascending: false }),
    [],
  )

  return (
    <ListShell
      title="Scheduled reports"
      description="Automated deliveries. Each schedule runs via Vercel Cron and emails the exported file to its recipients."
      breadcrumb={BREADCRUMB}
    >
      <div className="space-y-6">
      {!res.ok ? (
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      ) : res.data.length === 0 ? (
        <EmptyState title="No scheduled reports" description="Create a schedule below to deliver a report automatically." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Report</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Next run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.report_key}</TableCell>
                  <TableCell><Badge variant="secondary">{r.cadence}</Badge></TableCell>
                  <TableCell className="uppercase">{r.format}</TableCell>
                  <TableCell className="text-right tabular-nums">{(r.recipients ?? []).length}</TableCell>
                  <TableCell><Badge variant={r.enabled ? 'active' : 'draft'}>{r.enabled ? 'enabled' : 'disabled'}</Badge></TableCell>
                  <TableCell>{fmtDate(r.next_run_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Schedule a report</CardTitle></CardHeader>
        <CardContent>
          <ScheduledReportForm />
        </CardContent>
      </Card>
      </div>
    </ListShell>
  )
}
