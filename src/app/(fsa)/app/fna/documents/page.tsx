import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState, Section } from '@/components/archetypes'
import { load, unwrapOne } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface DqRow {
  id: string
  plan_id: string
  kind: string
  severity: string
  section: string | null
  key: string | null
  detail: string | null
  fna_plans: { households: { primary_name: string } | { primary_name: string }[] | null } | { households: { primary_name: string } | { primary_name: string }[] | null }[] | null
}
interface DocRow {
  id: string
  title: string
  entity_id: string
  created_at: string
}

const SEV_TONE: Record<string, 'destructive' | 'draft' | 'outline'> = { error: 'destructive', warning: 'draft', info: 'outline' }

// Documents & data quality (build instruction §8). Surfaces the structured
// data-quality exceptions (missing / stale / conflicting / unverified) and the FNA
// documents saved to Document OS. Document-intelligence extraction (upload → mapped
// suggestions) deepens here as it lands. Roles: fsa.
export default async function FnaDocumentsPage() {
  await requireRole('fsa', '/app/fna/documents')

  const [dq, docs] = await Promise.all([
    load<DqRow[]>(
      (db) =>
        db
          .from('fna_data_quality_exceptions')
          .select('id, plan_id, kind, severity, section, key, detail, fna_plans(households(primary_name))')
          .eq('resolved', false)
          .order('severity', { ascending: true })
          .limit(100),
      [],
    ),
    load<DocRow[]>((db) => db.from('documents').select('id, title, entity_id, created_at').eq('classification', 'fna_report').order('created_at', { ascending: false }).limit(50), []),
  ])

  const header = (
    <PageHeader
      title="Documents & data quality"
      description="Imported documents, extracted data, and the exceptions that limit an analysis — missing, stale, conflicting, or unverified inputs."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Documents' }]}
    />
  )

  if (!dq.ok) {
    return (
      <div className="space-y-6">
        {header}
        {dq.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={dq.message} />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <Section title="Data quality" description="Unresolved exceptions across plans. Warnings never block an analysis — they lower its confidence.">
        {dq.data.length === 0 ? (
          <EmptyState
            title="No open data-quality exceptions"
            description="Conflicting or missing inputs surface here as plans capture data."
            action={
              <Button asChild variant="outline">
                <Link href="/app/fna/plans">View plans</Link>
              </Button>
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {dq.data.map((r) => {
                  const plan = unwrapOne(r.fna_plans)
                  const hh = plan ? unwrapOne(plan.households) : null
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {r.kind}
                          {r.section && r.key ? <span className="font-normal text-muted-foreground"> — {r.section}.{r.key}</span> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">{r.detail}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={SEV_TONE[r.severity] ?? 'outline'}>{r.severity}</Badge>
                        <Link href={`/app/fna/plans/${r.plan_id}/inputs`} className="text-xs text-primary hover:underline">
                          {hh?.primary_name ?? 'Resolve'}
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </Section>

      <Section title="FNA documents" description="Saved to Document OS from the narrative generator.">
        {!docs.ok || docs.data.length === 0 ? (
          <EmptyState
            title="No FNA documents yet"
            description="Generate a narrative FNA and save it to Document OS to see it here."
            action={
              <Button asChild variant="outline">
                <Link href="/app/fna/generate">Generate narrative</Link>
              </Button>
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {docs.data.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <p className="truncate font-medium">{d.title}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(d.created_at).toLocaleDateString('en-US')}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </Section>
    </div>
  )
}
