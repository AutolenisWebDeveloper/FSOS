import { notFound } from 'next/navigation'
import { SettingsShell, SettingsSection, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
const SECTIONS = ['tags', 'statuses', 'loss_reasons', 'appointment_types', 'review_types']
// P-2 Operational Config (A10). Config drives dropdowns app-wide; Farmers values badged.
export default async function AdminConfigPage(props: { params: Promise<{ section: string }> }) {
  const params = await props.params;
  const section = params.section
  if (!SECTIONS.includes(section)) notFound()
  const rows = await load<{ id: string; key: string; label: string; is_assumption: boolean; active: boolean }[]>(
    (db) => db.from('ops_config').select('*').eq('section', section).order('sort'),
    [],
  )
  return (
    <SettingsShell title={`Config — ${section.replace(/_/g, ' ')}`} description="These values drive dropdowns across the app.">
      <SettingsSection title="Entries" description="Farmers-specific values are labeled config defaults.">
        {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <p className="text-sm text-muted-foreground">No entries for this section.</p> : (
          <div className="space-y-2">{rows.data.map((r) => (<div key={r.id} className="flex items-center justify-between rounded-md border p-2 text-sm"><span>{r.label}</span><span className="flex items-center gap-2">{r.is_assumption ? <AssumptionBadge /> : null}{!r.active ? <Badge variant="outline">inactive</Badge> : null}</span></div>))}</div>
        )}
      </SettingsSection>
    </SettingsShell>
  );
}
