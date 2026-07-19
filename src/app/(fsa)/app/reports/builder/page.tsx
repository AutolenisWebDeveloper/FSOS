import Link from 'next/link'
import { FormShell, ErrorState } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { ReportBuilder } from '@/components/app/ReportBuilder'

export const dynamic = 'force-dynamic'

type ReportDefinitionRow = {
  id: string
  name: string
  description: string | null
  source_key: string
  columns: string[] | null
  created_at: string
}

const BREADCRUMB = [{ label: 'FSA', href: '/app' }, { label: 'Reports', href: '/app/reports' }, { label: 'Builder' }]

// A5/A11 — Reports builder. Define a saved report over a DB-derived view (no drift).
export default async function ReportBuilderPage() {
  const res = await load<ReportDefinitionRow[]>(
    (db) => db.from('report_definitions').select('id, name, description, source_key, columns, created_at').order('created_at', { ascending: false }).limit(50),
    [],
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {res.ok && res.data.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Saved reports</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {res.data.map((d) => (
              <Link key={d.id} href={`/app/reports/${d.source_key}`} className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:border-primary/40">
                <span>
                  <span className="font-medium">{d.name}</span>
                  {d.description ? <span className="ml-2 text-muted-foreground">{d.description}</span> : null}
                </span>
                <Badge variant="secondary">{d.source_key}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {!res.ok ? <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} /> : null}
      <FormShell
        title="Report builder"
        description="Name a report and pick the source view. Every report is derived from the data — no drift."
        breadcrumb={BREADCRUMB}
        onSubmitNote="Validated by ReportDefinitionSchema (Zod) on both the client and the server."
      >
        <ReportBuilder />
      </FormShell>
    </div>
  )
}
