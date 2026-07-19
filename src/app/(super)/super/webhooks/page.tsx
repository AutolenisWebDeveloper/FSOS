import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'
import { WebhookForm, WebhookControls } from '@/components/super/WebhookControls'

export const dynamic = 'force-dynamic'

interface WebhookRow {
  id: string
  name: string
  target_url: string
  events: string[]
  enabled: boolean
  created_at: string
}

interface DeliveryRow {
  id: string
  event: string
  status: string
  status_code: number | null
  attempts: number
  created_at: string
}

// P-2 Super — outbound webhooks. POST signed event payloads to a target URL;
// secrets are write-only.
export default async function SuperWebhooksPage() {
  const webhooks = await load<WebhookRow[]>(
    (db) =>
      db
        .from('webhooks')
        .select('id, name, target_url, events, enabled, created_at')
        .order('created_at', { ascending: false }),
    [],
  )
  const deliveries = await load<DeliveryRow[]>(
    (db) =>
      db
        .from('webhook_deliveries')
        .select('id, event, status, status_code, attempts, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
    [],
  )

  return (
    <ListShell
      title="Webhooks"
      description="Outbound webhooks POST signed event payloads to your endpoint. Signing secrets are write-only and never displayed after creation."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Webhooks' }]}
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Create webhook</CardTitle>
          </CardHeader>
          <CardContent>
            <WebhookForm />
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Endpoints</h2>
          {!webhooks.ok ? (
            <ErrorState description={webhooks.kind === 'not_configured' ? 'Database not configured.' : webhooks.message} />
          ) : webhooks.data.length === 0 ? (
            <EmptyState title="No webhooks yet" description="Create an endpoint above to receive signed event payloads." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {webhooks.data.map((w) => (
                <Card key={w.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{w.name}</CardTitle>
                      <p className="truncate text-xs text-muted-foreground">{w.target_url}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={w.enabled ? 'won' : 'draft'}>{w.enabled ? 'enabled' : 'disabled'}</Badge>
                      <WebhookControls id={w.id} enabled={w.enabled} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {w.events.map((ev) => (
                        <Badge key={ev} variant="outline">{ev}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Recent deliveries</h2>
          {!deliveries.ok ? (
            <ErrorState description={deliveries.kind === 'not_configured' ? 'Database not configured.' : deliveries.message} />
          ) : deliveries.data.length === 0 ? (
            <EmptyState title="No deliveries yet" description="Delivery attempts appear here once events fire." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Attempts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.data.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-muted-foreground"><Numeric>{new Date(d.created_at).toLocaleString('en-US')}</Numeric></TableCell>
                      <TableCell className="font-medium">{d.event}</TableCell>
                      <TableCell>
                        <Badge variant={d.status === 'delivered' ? 'won' : d.status === 'failed' ? 'lost' : 'pending'}>{d.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.status_code ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{d.attempts}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </ListShell>
  )
}
