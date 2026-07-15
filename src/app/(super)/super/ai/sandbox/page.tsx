import { DetailShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { SandboxRunner } from '@/components/super/SandboxRunner'

export const dynamic = 'force-dynamic'

interface SandboxRunRow {
  id: string
  agent_key: string | null
  blocked: boolean
  guardrail_reason: string | null
  created_at: string
}

// P-2 Super — AI guardrail sandbox. Proves the green-zone / red-line boundary:
// a recommendation is HARD-BLOCKED and escalated to the human FSA — never sent.
export default async function SuperAiSandboxPage() {
  const rows = await load<SandboxRunRow[]>(
    (db) =>
      db
        .from('ai_sandbox_runs')
        .select('id, agent_key, blocked, guardrail_reason, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
    [],
  )

  return (
    <DetailShell
      title="AI guardrail sandbox"
      description="Test a draft client-facing message against the green-zone / red-line guardrail. A recommendation (or any failing rule) is HARD-BLOCKED and escalated to the human FSA — never sent. No live model is called."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'AI' }, { label: 'Sandbox' }]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Test a draft</CardTitle>
        </CardHeader>
        <CardContent>
          <SandboxRunner />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows.ok ? (
            <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
          ) : rows.data.length === 0 ? (
            <EmptyState title="No sandbox runs yet" description="Run a draft above to see how the guardrail evaluates it." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Reasons</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleString('en-US')}</TableCell>
                      <TableCell className="font-medium">{r.agent_key ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={r.blocked ? 'blocked' : 'won'}>{r.blocked ? 'blocked' : 'passed'}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">{r.guardrail_reason || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </DetailShell>
  )
}
