import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { TaskActions } from '@/components/app/TaskActions'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

interface Task {
  id: string
  title: string
  entity_type: string | null
  entity_id: string | null
  assignee: string | null
  source: string
  due_at: string | null
  completed: boolean
  owner_scope: string | null
  created_at: string | null
  updated_at: string | null
}

const SOURCE_LABEL: Record<string, string> = {
  agency_partnership: 'Agency partnership',
  referral: 'Referral',
  household: 'Household',
  opportunity: 'Opportunity',
  policy: 'Policy',
}

function sourceHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null
  switch (entityType) {
    case 'agency_partnership':
      return `/app/agencies/${entityId}`
    case 'referral':
      return `/app/referrals/${entityId}`
    case 'household':
      return `/app/households/${entityId}`
    case 'opportunity':
      return `/app/opportunities/${entityId}`
    case 'policy':
      return `/app/policies/${entityId}`
    default:
      return null
  }
}

function fmt(s: string | null) {
  return s ? new Date(s).toLocaleString('en-US') : '—'
}

export default async function TaskDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<Task | null>(
    (db) => db.from('work_tasks').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const t = res.data
  if (!t) notFound()

  const href = sourceHref(t.entity_type, t.entity_id)

  return (
    <DetailShell
      title={t.title}
      description={`${t.source === 'manual' ? 'Manual task' : `Auto-generated (${t.source})`}${t.due_at ? ` · due ${new Date(t.due_at).toLocaleDateString('en-US')}` : ''}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Tasks', href: '/app/tasks' }, { label: t.title }]}
      status={
        <span className="flex items-center gap-2">
          <StatusBadge status={t.completed ? 'won' : 'pending'} label={t.completed ? 'completed' : 'open'} />
          {t.source !== 'manual' ? <Badge variant="draft">{t.source}</Badge> : null}
        </span>
      }
      actions={<TaskActions taskId={t.id} completed={t.completed} dueAt={t.due_at} />}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            {href ? (
              <li>
                <Link href={href} className="text-primary hover:underline">
                  {SOURCE_LABEL[t.entity_type ?? ''] ?? 'Source record'}
                </Link>
              </li>
            ) : (
              <li className="text-muted-foreground">No linked record</li>
            )}
            <li>
              <Link href="/app/tasks" className="text-primary hover:underline">
                All tasks
              </Link>
            </li>
            <li>
              <Link href="/app/calendar" className="text-primary hover:underline">
                Calendar
              </Link>
            </li>
          </ul>
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Status" value={t.completed ? 'Completed' : 'Open'} />
          <Row label="Source" value={t.source} />
          <Row label="Due" value={t.due_at ? <Numeric>{new Date(t.due_at).toLocaleDateString('en-US')}</Numeric> : 'No due date'} />
          <Row label="Assignee" value={t.assignee ?? '—'} />
          <Row label="Linked record" value={t.entity_type ? SOURCE_LABEL[t.entity_type] ?? t.entity_type : '—'} />
          <Row label="Created" value={<Numeric>{fmt(t.created_at)}</Numeric>} />
          <Row label="Updated" value={<Numeric>{fmt(t.updated_at)}</Numeric>} />
        </CardContent>
      </Card>
    </DetailShell>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
