import { notFound } from 'next/navigation'
import { DetailShell, ErrorState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-13 Document Detail (A3). Signed-URL access; scan status; retention.
export default async function DocumentDetailPage({ params }: { params: { id: string } }) {
  const res = await load<{ id: string; file_name: string | null; classification: string | null; entity_type: string | null; entity_id: string | null; scan_status: string; mime_type: string | null; retention_until: string | null; legal_hold: boolean; created_at: string } | null>(
    (db) => db.from('documents').select('*').eq('id', params.id).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const d = res.data
  if (!d) notFound()

  return (
    <DetailShell
      title={d.file_name ?? 'Document'}
      description={d.classification ?? d.entity_type ?? 'Unclassified'}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Documents', href: '/app/documents' }, { label: d.file_name ?? 'Document' }]}
      status={<span className="flex items-center gap-2"><Badge variant={d.scan_status === 'clean' ? 'won' : d.scan_status === 'infected' ? 'lost' : 'pending'}>{d.scan_status}</Badge>{d.legal_hold ? <Badge variant="blocked">legal hold</Badge> : null}</span>}
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{d.mime_type ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Classification</span><span>{d.classification ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Retention until</span><Numeric>{d.retention_until ?? '—'}</Numeric></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Uploaded</span><Numeric>{new Date(d.created_at).toLocaleString('en-US')}</Numeric></div>
          <p className="pt-2 text-xs text-muted-foreground">Access is via a short-lived signed URL. Only clean-scanned documents are downloadable.</p>
        </CardContent>
      </Card>
    </DetailShell>
  )
}
