import Link from 'next/link'
import { SettingsShell, SettingsSection, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-06 Review Types config (A10). Agenda templates + default cadences.
export default async function ReviewTypesPage() {
  const types = await load<{ id: string; key: string; label: string; cadence_days: number | null; is_assumption: boolean; agenda: string[] | null; active: boolean }[]>(
    (db) => db.from('review_types').select('*').order('label'),
    [],
  )

  return (
    <SettingsShell title="Review Types" description="Agenda templates and default cadences. Farmers-specific values are labeled config defaults.">
      {!types.ok ? (
        <ErrorState description={types.kind === 'not_configured' ? 'Database not configured.' : types.message} />
      ) : (
        <SettingsSection title="Configured types" description="Editable in Super Admin config. These drive the review agenda + due detection.">
          <div className="space-y-3">
            {types.data.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{t.label}</p>
                  <span className="flex items-center gap-2">
                    {t.cadence_days ? <Badge variant="outline">{t.cadence_days}d cadence</Badge> : null}
                    {t.is_assumption ? <AssumptionBadge /> : null}
                    {!t.active ? <Badge variant="outline">inactive</Badge> : null}
                  </span>
                </div>
                {Array.isArray(t.agenda) && t.agenda.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{t.agenda.map((a, i) => (<li key={i}>{a}</li>))}</ul>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Manage these in <Link href="/super/product-config" className="text-primary hover:underline">Super Admin</Link> or Admin config.</p>
        </SettingsSection>
      )}
    </SettingsShell>
  )
}
