import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { MonoLabel } from '@/components/ui/typography'
import { getDb } from '@/lib/supabase/client'
import { WorkshopApprovalForm, type DisclosureOption } from '@/components/app/WorkshopApprovalForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PendingWorkshop {
  workshop_id: string
  title: string
  topic: string
  delivery_mode: string | null
  is_security: boolean | null
  disclosure_config_id: string | null
  scheduled_at: string | null
  presenters: { name: string; firm: string | null; fund_family: string | null; is_third_party: boolean | null }[]
  material_count: number
}

// Owner approval queue (spec §8). The FSA/owner is the approving principal: this is where
// you review your own workshops (presenters incl. third-party/fund-family, materials, and
// the disclosure version) and self-approve. Approving here is the ONLY way to open the
// publish gate; the approval record is still written every time.
export default async function WorkshopReviewPage() {
  await requireRole('fsa', '/app/workshops/review')

  let workshops: PendingWorkshop[] = []
  let disclosures: DisclosureOption[] = []
  let loadError: string | null = null

  try {
    const db = getDb()
    const { data: ws } = await db
      .from('workshops')
      .select('workshop_id, title, topic, delivery_mode, is_security, disclosure_config_id, scheduled_at')
      .eq('status', 'pending_review')
      .order('updated_at', { ascending: false })

    const { data: disc } = await db
      .from('workshop_disclosure_configs')
      .select('id, kind, version, body, is_assumption')
      .order('kind', { ascending: true })
      .order('version', { ascending: false })
    disclosures = (disc as DisclosureOption[]) ?? []

    workshops = await Promise.all(
      ((ws as Omit<PendingWorkshop, 'presenters' | 'material_count'>[]) ?? []).map(async (w) => {
        const { data: pres } = await db
          .from('workshop_presenters')
          .select('display_order, presenters(name, firm, fund_family, is_third_party)')
          .eq('workshop_id', w.workshop_id)
          .order('display_order', { ascending: true })
        const { count } = await db
          .from('workshop_materials')
          .select('*', { count: 'exact', head: true })
          .eq('workshop_id', w.workshop_id)
        const presenters = ((pres as unknown as { presenters: PendingWorkshop['presenters'][number] | null }[]) ?? [])
          .map((r) => r.presenters)
          .filter((p): p is PendingWorkshop['presenters'][number] => !!p)
        return { ...w, presenters, material_count: count ?? 0 }
      }),
    )
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Failed to load the review queue'
  }

  return (
    <ListShell
      title="Workshop approvals"
      description="You are the approving principal. No workshop can publish without your approval + an approved disclosure version."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Workshops', href: '/app/workshops' }, { label: 'Approvals' }]}
    >
      {loadError ? (
        <ErrorState description={loadError} />
      ) : workshops.length === 0 ? (
        <EmptyState title="Nothing awaiting approval" description="Workshops you submit for review appear here for your sign-off." />
      ) : (
        <div className="space-y-6">
          {workshops.map((w) => (
            <section key={w.workshop_id} className="rounded-xl border border-border bg-card p-5 shadow-elev-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{w.title}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {w.topic} · {w.delivery_mode ?? 'in_person'} ·{' '}
                    {w.scheduled_at ? new Date(w.scheduled_at).toLocaleString('en-US') : 'Date TBA'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {w.is_security ? <Badge variant="security">Securities — FFS review</Badge> : null}
                  <Badge variant="outline">{w.material_count} materials</Badge>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <MonoLabel>Presenters</MonoLabel>
                {w.presenters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No presenters attached.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {w.presenters.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-foreground/90">
                        <span className="font-medium">{p.name}</span>
                        {p.firm ? <span className="text-muted-foreground">· {p.firm}</span> : null}
                        {p.fund_family ? <Badge variant="assumption">{p.fund_family}</Badge> : null}
                        {p.is_third_party ? <Badge variant="security">Third-party — REQUIRES-APPROVAL</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4">
                <MonoLabel>Your decision</MonoLabel>
                <div className="mt-2">
                  <WorkshopApprovalForm
                    workshopId={w.workshop_id}
                    disclosures={disclosures}
                    defaultDisclosureId={w.disclosure_config_id}
                  />
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </ListShell>
  )
}
