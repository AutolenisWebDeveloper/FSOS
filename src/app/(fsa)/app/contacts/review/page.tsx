import { ListShell, EmptyState, ErrorState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { ReviewQueue, type ReviewItem } from '@/components/app/ReviewQueue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RecordRow {
  id: string
  raw: Record<string, unknown>
  decision: { confidence?: string; matchedBy?: string[]; conflict?: boolean; candidateIds?: string[]; incoming?: Record<string, unknown> }
  confidence: string
  created_at: string
  batch_id: string
}

// Import Review — records the resolution engine could not auto-match with
// confidence. The FSA merges each into the right existing contact or creates a
// new one; nothing was written to the book until they decide.
export default async function ImportReviewPage() {
  const res = await load<RecordRow[]>(
    (db) => db.from('import_records').select('id, raw, decision, confidence, created_at, batch_id').eq('review_status', 'needs_review').order('created_at', { ascending: false }).limit(300),
    [],
  )
  const batches = await load<{ id: string; source: string; filename: string | null }[]>(
    (db) => db.from('import_batches').select('id, source, filename'),
    [],
  )

  if (!res.ok) {
    return (
      <ListShell title="Import Review" description="Records that need a human decision." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: 'Review' }]}>
        {res.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars." /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  const rows = res.data
  // Resolve candidate contact names for context.
  const candidateIds = Array.from(new Set(rows.flatMap((r) => r.decision?.candidateIds ?? [])))
  const contactsRes = candidateIds.length
    ? await load<{ id: string; full_name: string; email: string | null; phone: string | null; contact_type: string }[]>(
        (db) => db.from('contacts').select('id, full_name, email, phone, contact_type').in('id', candidateIds).is('deleted_at', null),
        [],
      )
    : { ok: true as const, data: [] }
  const contactById = new Map((contactsRes.ok ? contactsRes.data : []).map((c) => [c.id, c]))
  const batchById = new Map((batches.ok ? batches.data : []).map((b) => [b.id, b]))

  const items: ReviewItem[] = rows.map((r) => ({
    id: r.id,
    confidence: r.confidence,
    conflict: !!r.decision?.conflict,
    matchedBy: r.decision?.matchedBy ?? [],
    incoming: r.decision?.incoming ?? {},
    raw: r.raw,
    source: batchById.get(r.batch_id)?.source ?? 'import',
    filename: batchById.get(r.batch_id)?.filename ?? null,
    candidates: (r.decision?.candidateIds ?? []).map((id) => contactById.get(id)).filter(Boolean).map((c) => ({
      id: c!.id, full_name: c!.full_name, email: c!.email, phone: c!.phone, contact_type: c!.contact_type,
    })),
  }))

  return (
    <ListShell
      title="Import Review"
      description="Records the matcher couldn't confidently place. Merge each into the right contact or create a new one — nothing is written until you decide."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: 'Review' }]}
    >
      {items.length === 0 ? (
        <EmptyState title="Nothing to review" description="Every imported record was matched or created automatically. Uncertain matches will appear here." />
      ) : (
        <ReviewQueue items={items} />
      )}
    </ListShell>
  )
}
