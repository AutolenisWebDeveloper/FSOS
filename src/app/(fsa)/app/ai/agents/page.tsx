import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { AGENT_ROSTER } from '@/lib/ai/roster'

export const dynamic = 'force-dynamic'

// OS-15 Agent Directory (A2). Green-zone roster; no NIGO agent; no "recommend" tool.
export default async function AgentsPage() {
  const agents = await load<{ id: string; key: string; name: string; enabled: boolean; is_guardrail: boolean }[]>(
    (db) => db.from('ai_agents').select('id, key, name, enabled, is_guardrail').order('name'),
    [],
  )

  return (
    <ListShell title="AI Agents" description="Green-zone roster. Every agent's tools are green-zone only — none can recommend a product." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI', href: '/app/ai' }, { label: 'Agents' }]}>
      {!agents.ok ? (
        <ErrorState description={agents.kind === 'not_configured' ? 'Database not configured.' : agents.message} />
      ) : agents.data.length === 0 ? (
        <EmptyState title="No agents configured" description="The agent roster seeds with the migration." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Mission</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {agents.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell><Link href={`/app/ai/agents/${a.key}`} className="font-medium text-primary hover:underline">{a.name}</Link>{a.is_guardrail ? <Badge variant="blocked" className="ml-2">guardrail</Badge> : null}</TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">{AGENT_ROSTER[a.key]?.mission ?? '—'}</TableCell>
                  <TableCell><Badge variant={a.enabled ? 'won' : 'lost'}>{a.enabled ? 'enabled' : 'disabled'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
