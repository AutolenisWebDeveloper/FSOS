import { ListShell, EmptyState } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// P-4 Materials (A2). Approved-only content (approved templates as shareable material).
export default async function PartnerMaterialsPage() {
  const templates = await load<{ id: string; name: string; category: string | null; body: string }[]>(
    (db) => db.from('comm_templates').select('id, name, category, body').eq('approval_status', 'approved').is('archived_at', null).order('name'),
    [],
  )
  const list = templates.ok ? templates.data : []
  return (
    <ListShell title="Materials" description="Approved materials only. Nothing here is a product recommendation." breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'Materials' }]}>
      {list.length === 0 ? (
        <EmptyState title="No approved materials yet" description="Your FSA publishes approved materials here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map((t) => (
            <Card key={t.id}><CardHeader><CardTitle className="text-base">{t.name}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap">{t.body}</p></CardContent></Card>
          ))}
        </div>
      )}
    </ListShell>
  )
}
