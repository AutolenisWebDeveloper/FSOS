import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { OutreachActions } from '@/components/app/OutreachActions'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-08 Cross-Sell Opportunity Detail (A3). [id] = household id. Invite + educate only.
export default async function CrossSellDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gap = await load<{ household_id: string; primary_name: string; next_best_line: string | null; gap_count: number; has_life: boolean; families_held: string[] | null; score: number } | null>(
    (db) => db.from('v_cross_sell_gaps').select('*').eq('household_id', params.id).maybeSingle(),
    null,
  )
  if (!gap.ok) return <ErrorState description={gap.kind === 'not_configured' ? 'Database not configured.' : gap.message} />
  const g = gap.data
  const hh = await load<{ primary_name: string; do_not_contact: boolean } | null>((db) => db.from('households').select('primary_name, do_not_contact').eq('id', params.id).maybeSingle(), null)
  const name = (hh.ok ? hh.data?.primary_name : null) ?? g?.primary_name ?? null
  if (!hh.ok || !hh.data) notFound()
  const dnc = hh.data.do_not_contact

  const activities = await load<{ id: string; kind: string | null; note: string | null; created_at: string }[]>(
    (db) => db.from('activities').select('id, kind, note, created_at').eq('entity_type', 'household').eq('entity_id', params.id).like('kind', 'crosssell_%').order('created_at', { ascending: false }).limit(20),
    [],
  )

  return (
    <DetailShell
      title={`Cross-Sell — ${name ?? 'household'}`}
      description="Coverage-gap review invitation. Identify and invite — never recommend."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cross-Sell', href: '/app/cross-sell' }, { label: name ?? 'Household' }]}
      status={dnc ? <Badge variant="blocked">do-not-contact</Badge> : <Badge variant="active">eligible</Badge>}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            <li><Link href={`/app/households/${params.id}`} className="text-primary hover:underline">Household</Link></li>
            <li><Link href={`/app/reviews/new?household=${params.id}&type=coverage`} className="text-primary hover:underline">Schedule coverage review</Link></li>
          </ul>
        </div>
      }
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Green-zone actions</CardTitle></CardHeader>
        <CardContent><OutreachActions endpoint={`/api/cross-sell/${params.id}`} isSecurity={dnc} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Coverage gap analysis</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {g ? (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">Lines held</span><span className="capitalize">{(g.families_held ?? []).join(', ') || 'none with us'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Next coverage gap</span><span className="capitalize font-medium">{g.next_best_line ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Gap count</span><span>{g.gap_count}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Score</span><span>{g.score}</span></div>
              <p className="pt-2 text-xs text-muted-foreground">A gap is a coverage opportunity to discuss in a review — not a product recommendation.</p>
            </>
          ) : (
            <p className="text-muted-foreground">No open gaps — household is multi-line or opted out.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Outreach log</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {activities.ok && activities.data.length > 0 ? activities.data.map((a) => (
            <div key={a.id} className="border-b py-1 last:border-0"><Numeric className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('en-US')}</Numeric><p className="capitalize">{(a.kind ?? '').replace('crosssell_', '').replace(/_/g, ' ')} — {a.note}</p></div>
          )) : <p className="text-muted-foreground">No outreach logged yet.</p>}
        </CardContent>
      </Card>
    </DetailShell>
  );
}
