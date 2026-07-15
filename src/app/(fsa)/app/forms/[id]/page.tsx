import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { DetailShell, ErrorState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { MonoLabel } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { getDb } from '@/lib/supabase/client'
import { AttachResponse } from '@/components/app/AttachResponse'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_MAP: Record<string, StatusKey> = {
  pending: 'pending',
  submitted: 'active',
  attached: 'won',
  archived: 'draft',
}

interface ResponseDetail {
  id: string
  template_id: string
  status: string
  data: Record<string, unknown> | null
  submitter_name: string | null
  submitter_email: string | null
  submitter_phone: string | null
  consent_channels: string[] | null
  submitted_at: string | null
  household_id: string | null
}

// Client Form response detail (docs/legacy-port.md §2.3) — A3. Review the submitted
// answers + captured consent, then attach the response to a household. No securities
// data is ever collected here (guardrail §2.1).
export default async function FormResponsePage({ params }: { params: { id: string } }) {
  await requireRole('fsa', `/app/forms/${params.id}`)

  const db = getDb()
  let resp: ResponseDetail | null = null
  let templateName = '—'
  try {
    const { data } = await db
      .from('form_responses')
      .select(
        'id, template_id, status, data, submitter_name, submitter_email, submitter_phone, consent_channels, submitted_at, household_id',
      )
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    resp = (data as ResponseDetail) ?? null
    if (resp) {
      const { data: t } = await db.from('form_templates').select('name').eq('id', resp.template_id).maybeSingle()
      templateName = t?.name ?? '—'
    }
  } catch (e) {
    return (
      <div className="space-y-6">
        <ErrorState description={e instanceof Error ? e.message : 'Failed to load response'} />
      </div>
    )
  }
  if (!resp) notFound()

  const households = await load<{ id: string; primary_name: string }[]>(
    (d) => d.from('households').select('id, primary_name').is('deleted_at', null).order('primary_name', { ascending: true }),
    [],
  )

  const answers = resp.data && typeof resp.data === 'object' ? resp.data : {}
  const channels = Array.isArray(resp.consent_channels) ? resp.consent_channels : []

  return (
    <DetailShell
      title={resp.submitter_name ?? 'Form response'}
      description={`${templateName} · submitted ${resp.submitted_at ? new Date(resp.submitted_at).toLocaleString() : '—'}`}
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Forms', href: '/app/forms' },
        { label: resp.submitter_name ?? 'Response' },
      ]}
      status={<StatusBadge status={STATUS_MAP[resp.status] ?? 'draft'} label={resp.status} />}
      rail={
        <div className="space-y-4">
          <section className="space-y-2">
            <MonoLabel>Attach</MonoLabel>
            <AttachResponse
              responseId={resp.id}
              households={households.ok ? households.data : []}
              attachedHouseholdId={resp.household_id}
            />
          </section>
          <section className="space-y-2">
            <MonoLabel>Consent captured</MonoLabel>
            {channels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <Badge key={c} variant="active">
                    {c}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No channel consent captured — this contact cannot be messaged.
              </p>
            )}
          </section>
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submitted answers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" value={resp.submitter_name} />
            <Field label="Email" value={resp.submitter_email} mono />
            <Field label="Phone" value={resp.submitter_phone} mono />
          </dl>
          {Object.keys(answers).length > 0 ? (
            <div className="border-t pt-3">
              <dl className="grid gap-3 sm:grid-cols-2">
                {Object.entries(answers).map(([k, v]) => (
                  <Field key={k} label={k.replace(/_/g, ' ')} value={String(v ?? '—')} />
                ))}
              </dl>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No additional answers.</p>
          )}
        </CardContent>
      </Card>

      {resp.household_id ? (
        <p className="text-sm text-muted-foreground">
          Attached to{' '}
          <Link href={`/app/households/${resp.household_id}`} className="text-accent hover:underline">
            this household
          </Link>
          .
        </p>
      ) : null}
    </DetailShell>
  )
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <MonoLabel>{label}</MonoLabel>
      <dd className={mono ? 'numeric text-sm' : 'text-sm'}>{value || '—'}</dd>
    </div>
  )
}
