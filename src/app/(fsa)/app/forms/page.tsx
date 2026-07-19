import Link from 'next/link'
import { Inbox, ExternalLink, ClipboardList } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { MonoLabel } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface TemplateRow {
  id: string
  slug: string
  name: string
  description: string | null
  active: boolean
}
interface ResponseRow {
  id: string
  template_id: string
  status: string
  submitter_name: string | null
  submitter_email: string | null
  submitted_at: string | null
  household_id: string | null
}

const STATUS_MAP: Record<string, StatusKey> = {
  pending: 'pending',
  submitted: 'active',
  attached: 'won',
  archived: 'draft',
}

const FILTERS = [
  { key: 'open', label: 'Needs action' },
  { key: 'attached', label: 'Attached' },
  { key: 'all', label: 'All' },
] as const

// Client Forms directory (docs/legacy-port.md §2.3) — A2. Form templates catalog +
// the intake responses queue. A submitted response is attached to a household from
// its detail page; consent captured on the public form is recorded there.
export default async function FormsPage(props: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = await props.searchParams;
  await requireRole('fsa', '/app/forms')
  const filter = FILTERS.find((f) => f.key === searchParams.status)?.key ?? 'open'

  const [templates, responses] = await Promise.all([
    load<TemplateRow[]>(
      (db) => db.from('form_templates').select('id, slug, name, description, active').order('name', { ascending: true }),
      [],
    ),
    load<ResponseRow[]>(
      (db) => {
        let q = db
          .from('form_responses')
          .select('id, template_id, status, submitter_name, submitter_email, submitted_at, household_id')
          .is('deleted_at', null)
          .order('submitted_at', { ascending: false, nullsFirst: false })
        if (filter === 'open') q = q.in('status', ['pending', 'submitted'])
        else if (filter === 'attached') q = q.eq('status', 'attached')
        return q
      },
      [],
    ),
  ])

  const templateName = new Map(
    (templates.ok ? templates.data : []).map((t) => [t.id, t.name] as const),
  )
  const pendingCount = responses.ok ? responses.data.filter((r) => r.status === 'submitted' || r.status === 'pending').length : 0

  let body: React.ReactNode
  if (!responses.ok) {
    body =
      responses.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load form responses." />
      ) : (
        <ErrorState description={responses.message} />
      )
  } else if (responses.data.length === 0) {
    body = (
      <EmptyState
        icon={Inbox}
        title={filter === 'open' ? 'No responses need action' : 'No responses yet'}
        description="Send a client form or share a public form link. Submissions land here to be attached to a household."
      />
    )
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Submitter</TableHead>
            <TableHead>Form</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {responses.data.map((r) => (
            <TableRow key={r.id} className="cursor-pointer">
              <TableCell>
                <Link href={`/app/forms/${r.id}`} className="block font-medium hover:underline">
                  {r.submitter_name ?? 'Unnamed'}
                </Link>
                <span className="text-xs text-muted-foreground">{r.submitter_email ?? '—'}</span>
              </TableCell>
              <TableCell>{templateName.get(r.template_id) ?? '—'}</TableCell>
              <TableCell>
                <StatusBadge status={STATUS_MAP[r.status] ?? 'draft'} label={r.status} />
              </TableCell>
              <TableCell className="numeric text-muted-foreground">
                {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Response filter">
      {FILTERS.map((f) => (
        <Link
          key={f.key}
          href={`/app/forms?status=${f.key}`}
          role="tab"
          aria-selected={filter === f.key}
          className={
            filter === f.key
              ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
              : 'rounded-md border px-3 py-1.5 text-sm hover:bg-muted'
          }
        >
          {f.label}
        </Link>
      ))}
    </div>
  )

  return (
    <ListShell
      title="Client Forms"
      description="Intake forms and the responses queue. Attach a submission to a household to record it and its consent."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Forms' }]}
      toolbar={toolbar}
    >
      <div className="space-y-6">
        {/* Templates catalog */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-base">Form Templates</CardTitle>
            </div>
            <MonoLabel>{pendingCount} awaiting</MonoLabel>
          </CardHeader>
          <CardContent>
            {templates.ok && templates.data.length > 0 ? (
              <ul className="divide-y">
                {templates.data.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        {!t.active ? <StatusBadge status="draft" label="inactive" /> : null}
                      </div>
                      {t.description ? <p className="text-xs text-muted-foreground">{t.description}</p> : null}
                    </div>
                    <a
                      href={`/forms/${t.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <span className="numeric">/forms/{t.slug}</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No form templates configured.</p>
            )}
          </CardContent>
        </Card>

        {/* Responses queue */}
        <div>
          <MonoLabel className="mb-2 block">Responses</MonoLabel>
          {body}
        </div>
      </div>
    </ListShell>
  )
}
