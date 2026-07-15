import Link from 'next/link'
import { FormShell, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { CaseCreateButton } from '@/components/app/CaseControls'

export const dynamic = 'force-dynamic'

// OS-10 Open Case (A5). A case is created FROM an opportunity (carries firewall).
export default async function NewCasePage() {
  const [opps, households] = await Promise.all([
    load<{ id: string; household_id: string | null; stage: string; is_security: boolean }[]>(
      (db) => db.from('opportunities').select('id, household_id, stage, is_security').is('deleted_at', null).in('stage', ['application', 'underwriting_suitability', 'quoted_proposed']).order('created_at', { ascending: false }),
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])
  const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))
  const list = opps.ok ? opps.data : []

  return (
    <FormShell title="Open a Case" description="A case is opened from an opportunity that reached application." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cases', href: '/app/cases' }, { label: 'New' }]}>
      {list.length === 0 ? (
        <EmptyState title="No eligible opportunities" description="Advance an opportunity to the application stage first." action={<Button asChild><Link href="/app/opportunities/board">Open pipeline</Link></Button>} />
      ) : (
        <div className="space-y-2">
          {list.map((o) => (
            <Card key={o.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <p className="font-medium">{o.household_id ? hhMap.get(o.household_id) ?? 'Opportunity' : 'Opportunity'}</p>
                  <p className="text-xs text-muted-foreground capitalize">{o.stage.replace(/_/g, ' ')}{o.is_security ? '' : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {o.is_security ? <Badge variant="blocked">securities</Badge> : null}
                  <CaseCreateButton opportunityId={o.id} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </FormShell>
  )
}
