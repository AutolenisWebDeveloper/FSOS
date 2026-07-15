import Link from 'next/link'
import { BoardShell, BoardColumn, ErrorState } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { CASE_STATUS } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'

// OS-10 Case Board (A4).
export default async function CaseBoardPage() {
  const [cases, households] = await Promise.all([
    load<{ id: string; household_id: string | null; status: string; is_security: boolean }[]>((db) => db.from('cases').select('id, household_id, status, is_security').is('archived_at', null), []),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])
  if (!cases.ok) return <ErrorState description={cases.kind === 'not_configured' ? 'Database not configured.' : cases.message} />
  const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))

  return (
    <BoardShell title="Case Board" description="Application lifecycle. Requirements-outstanding links to the requirements list." actions={<Button asChild variant="outline"><Link href="/app/cases">List</Link></Button>}>
      {CASE_STATUS.map((status) => {
        const items = cases.data.filter((c) => c.status === status)
        return (
          <BoardColumn key={status} title={status.replace(/_/g, ' ')} count={items.length}>
            {items.map((c) => (
              <Link key={c.id} href={status === 'requirements_outstanding' ? `/app/cases/${c.id}/checklist` : `/app/cases/${c.id}`}>
                <Card className="transition-colors hover:border-primary/40"><CardContent className="space-y-1 p-3"><p className="text-sm font-medium">{c.household_id ? hhMap.get(c.household_id) ?? 'Case' : 'Case'}</p>{c.is_security ? <Badge variant="blocked">securities</Badge> : null}</CardContent></Card>
              </Link>
            ))}
            {items.length === 0 ? <p className="px-1 text-xs text-muted-foreground">Empty</p> : null}
          </BoardColumn>
        )
      })}
    </BoardShell>
  )
}
