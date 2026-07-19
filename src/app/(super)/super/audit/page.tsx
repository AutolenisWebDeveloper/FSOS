import { ScrollText } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

interface AuditRow {
  id: string
  at: string
  actor: string
  action: string
  entity: string
  entity_id: string | null
}

// Super · Audit (A2). Recent rows from the append-only audit_log, newest first.
export default async function SuperAuditPage() {
  const events = await load<AuditRow[]>(
    (db) => db.from('audit_log').select('id, at, actor, action, entity, entity_id').order('at', { ascending: false }).limit(200),
    [],
  )

  let body: React.ReactNode
  if (!events.ok) {
    body =
      events.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load the audit log." />
      ) : (
        <ErrorState description={events.message} />
      )
  } else if (events.data.length === 0) {
    body = <EmptyState icon={ScrollText} title="No audit events yet" description="Mutations, sends, and AI actions are recorded here." />
  } else {
    body = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Entity ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.data.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground"><Numeric>{new Date(e.at).toLocaleString('en-US')}</Numeric></TableCell>
                <TableCell><Numeric className="text-xs">{e.actor}</Numeric></TableCell>
                <TableCell className="font-medium">{e.action}</TableCell>
                <TableCell className="text-muted-foreground">{e.entity}</TableCell>
                <TableCell className="text-muted-foreground"><Numeric className="text-xs">{e.entity_id ?? '—'}</Numeric></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <ListShell
      title="Audit Log"
      description="Append-only, tamper-evident record of platform activity (most recent 200)."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Audit' }]}
    >
      {body}
    </ListShell>
  )
}
