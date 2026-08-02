import Link from 'next/link'
import { ListShell, EmptyState, ErrorState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { BulkGroupConsent, type TagOption } from '@/components/app/BulkGroupConsent'
import { listContactTags } from '@/lib/comms/bulk-consent-run'

export const dynamic = 'force-dynamic'

interface ConsentRow {
  id: string
  member_id: string | null
  household_id: string | null
  channel: string
  status: string
  source: string | null
  captured_at: string | null
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Compliance', href: '/app/compliance' },
  { label: 'Consent' },
]

const STATUS_MAP: Record<string, StatusKey> = { granted: 'won', revoked: 'lost' }

const TABS = [
  { key: 'records', label: 'Records' },
  { key: 'groups', label: 'Group Consents' },
] as const
type TabKey = (typeof TABS)[number]['key']

function TabNav({ active }: { active: TabKey }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b" role="tablist" aria-label="Consent views">
      {TABS.map((t) => {
        const on = t.key === active
        return (
          <Link
            key={t.key}
            href={`/app/compliance/consent?tab=${t.key}`}
            role="tab"
            aria-selected={on}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              on ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

// OS Compliance — channel consent ledger (records) + bulk Group Consents management.
export default async function ConsentPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await props.searchParams
  const active: TabKey = tab === 'groups' ? 'groups' : 'records'

  return (
    <ListShell title="Consent" description="Per-channel consent records driving comms eligibility." breadcrumb={breadcrumb}>
      <div className="space-y-6">
        <TabNav active={active} />
        {active === 'groups' ? <GroupsTab /> : <RecordsTab />}
      </div>
    </ListShell>
  )
}

async function RecordsTab() {
  const res = await load<ConsentRow[]>(
    (db) =>
      db
        .from('consents')
        .select('id, member_id, household_id, channel, status, source, captured_at')
        .order('captured_at', { ascending: false })
        .limit(500),
    [],
  )

  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  if (res.data.length === 0)
    return <EmptyState title="No consent records yet" description="Consent is captured as clients opt in to each channel, or via Group Consents." />

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Household</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Captured</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {res.data.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium capitalize">{c.channel}</TableCell>
              <TableCell><StatusBadge status={STATUS_MAP[c.status] ?? 'pending'} label={c.status} /></TableCell>
              <TableCell className="text-muted-foreground">{c.household_id ? <Numeric className="font-mono text-xs">{c.household_id}</Numeric> : '—'}</TableCell>
              <TableCell className="text-muted-foreground">{c.member_id ? <Numeric className="font-mono text-xs">{c.member_id}</Numeric> : '—'}</TableCell>
              <TableCell className="text-muted-foreground">{c.source ?? '—'}</TableCell>
              <TableCell className="text-muted-foreground">{c.captured_at ? <Numeric>{new Date(c.captured_at).toLocaleDateString('en-US')}</Numeric> : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

async function GroupsTab() {
  let tags: TagOption[] = []
  let capped = false
  let failed = false
  try {
    const cat = await listContactTags()
    tags = cat.tags
    capped = cat.capped
  } catch {
    failed = true
  }
  if (failed) return <ErrorState description="Couldn’t load contact groups. The database may not be configured." />

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Grant or revoke consent for every contact in one or more groups at once. Select the group(s), choose the channel(s)
        and direction, then <strong>Preview</strong> to see exactly what will change before you apply. Granting never
        re-consents anyone who opted out; every update is recorded to the audit log.
      </p>
      <BulkGroupConsent tags={tags} capped={capped} />
    </div>
  )
}
