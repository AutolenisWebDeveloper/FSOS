import { DashboardShell, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS Compliance overview (A1). Each tile links to its list; every count is loaded
// independently (default 0) so one failing table never breaks the whole page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(build: (db: any) => PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const res = await load<number>(
    (db) => build(db).then((r) => ({ data: r.count ?? 0, error: r.error })),
    0,
  )
  return res.ok ? res.data : 0
}

export default async function CompliancePage() {
  const [firewall, consents, licenses, dnc] = await Promise.all([
    count((db) => db.from('compliance_events').select('*', { count: 'exact', head: true }).in('kind', ['firewall', 'comms_blocked'])),
    count((db) => db.from('consents').select('*', { count: 'exact', head: true })),
    count((db) => db.from('licenses').select('*', { count: 'exact', head: true })),
    count((db) => db.from('dnc_entries').select('*', { count: 'exact', head: true })),
  ])

  return (
    <DashboardShell title="Compliance" description="Firewall, consent, licensing, and do-not-contact status.">
      <StatTile label="Firewall events" value={firewall} href="/app/compliance/firewall" hint="Securities firewall & comms blocks" />
      <StatTile label="Consent records" value={consents} href="/app/compliance/consent" hint="Channel consent on file" />
      <StatTile label="Licenses" value={licenses} href="/app/compliance/licenses" hint="Licensing status" />
      <StatTile label="DNC entries" value={dnc} href="/app/compliance/dnc" hint="Do-not-contact list" />
    </DashboardShell>
  )
}
