import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface AuditRow {
  actor: string
  action: string
  entity: string
  entity_id: string | null
  diff: Record<string, unknown> | null
  at: string
}

const FNA_ENTITIES = ['fna_plan', 'fna_version', 'fna_scenario', 'fna_recommendation']

// Cross-plan audit trail (build instruction §8/§13.9). Every FNA event across all
// plans — attributable, timestamped, append-only. Roles: fsa, licensed_staff.
export default async function FnaAuditPage() {
  await requireRole('fsa', '/app/fna/audit')

  const res = await load<AuditRow[]>(
    (db) => db.from('audit_log').select('actor, action, entity, entity_id, diff, at').in('entity', FNA_ENTITIES).order('at', { ascending: false }).limit(200),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Audit' }]

  if (!res.ok) {
    return (
      <ListShell title="Cross-plan audit" breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  return (
    <ListShell
      title="Cross-plan audit"
      description="Every FNA event across all plans — who did what, when. Append-only and tamper-evident."
      breadcrumb={breadcrumb}
    >
      {res.data.length === 0 ? (
        <EmptyState
          title="No FNA audit events yet"
          description="Creating, calculating, approving, or recommending on any plan records an event here."
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
              {res.data.map((r, i) => {
                const event = (r.diff?.event as string) ?? r.action
                return (
                  <li key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{event}</p>
                      <p className="text-xs text-muted-foreground">{r.actor}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{r.entity.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(r.at).toLocaleString('en-US')}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </ListShell>
  )
}
