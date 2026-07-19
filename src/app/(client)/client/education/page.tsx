import { ListShell, EmptyState } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-5 Education (A2). Assigned neutral educational materials. Permanent-life education
// permitted; NO product recommendation.
export default async function ClientEducationPage() {
  const templates = await load<{ id: string; name: string; body: string }[]>(
    (db) => db.from('comm_templates').select('id, name, body').eq('approval_status', 'approved').eq('category', 'educational').is('archived_at', null).limit(50),
    [],
  )
  const list = templates.ok ? templates.data : []
  return (
    <ListShell title="Education" description="Neutral educational materials. Nothing here is a recommendation." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Education' }]}>
      {list.length === 0 ? <EmptyState title="No materials yet" description="Your FSA assigns educational materials here." /> : (
        <div className="grid gap-4 sm:grid-cols-2">{list.map((t) => (<Card key={t.id}><CardHeader><CardTitle className="text-base">{t.name}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-5">{t.body}</p></CardContent></Card>))}</div>
      )}
    </ListShell>
  )
}
