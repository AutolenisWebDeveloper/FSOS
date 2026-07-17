// src/lib/import/auditWriter.ts
// Thin helpers every importer uses to record the audit trail the spec requires:
// one import_batches row per run, and one import_records row per imported record
// capturing the raw data, the resolution decision, the fields merged, and the
// values rejected. Also loads the existing Contact Center as a resolution index.

import type { CandidateContact } from '@/lib/import/resolution'

export interface BatchInput {
  source: string
  filename: string | null
  actor: string
  ownerScope?: string | null
  stats?: Record<string, unknown>
}

export interface RecordInput {
  batchId: string
  entityType?: 'contact' | 'policy'
  raw: Record<string, unknown>
  decision: Record<string, unknown>
  targetId?: string | null
  mergedFields?: string[]
  rejectedValues?: Array<{ field: string; existing: unknown; incoming: unknown }>
  confidence?: string
  reviewStatus?: 'auto' | 'needs_review' | 'resolved' | 'skipped'
  ownerScope?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createBatch(db: any, input: BatchInput): Promise<string | null> {
  const { data, error } = await db
    .from('import_batches')
    .insert({ source: input.source, filename: input.filename, actor: input.actor, owner_scope: input.ownerScope ?? null, stats: input.stats ?? {} })
    .select('id')
    .single()
  if (error) return null // audit is best-effort; never block an import on it
  return data?.id ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateBatchStats(db: any, batchId: string, stats: Record<string, unknown>): Promise<void> {
  await db.from('import_batches').update({ stats }).eq('id', batchId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeRecords(db: any, records: RecordInput[]): Promise<void> {
  if (!records.length) return
  const rows = records.map((r) => ({
    batch_id: r.batchId,
    entity_type: r.entityType ?? 'contact',
    raw: r.raw,
    decision: r.decision,
    target_id: r.targetId ?? null,
    merged_fields: r.mergedFields ?? [],
    rejected_values: r.rejectedValues ?? [],
    confidence: r.confidence ?? 'none',
    review_status: r.reviewStatus ?? 'auto',
    owner_scope: r.ownerScope ?? null,
  }))
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.from('import_records').insert(rows.slice(i, i + CHUNK))
  }
}

// Load the existing Contact Center as resolution candidates (index fields only).
// Paged so a large book is fully considered, not truncated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadContactCandidates(db: any): Promise<CandidateContact[]> {
  const cols = 'id, full_name, email_lc, phone_digits, zip, address, book_key, crosssell_key, winback_key'
  const out: CandidateContact[] = []
  const page = 1000
  for (let offset = 0; offset < 500000; offset += page) {
    const { data, error } = await db.from('contacts').select(cols).is('deleted_at', null).range(offset, offset + page - 1)
    if (error) break
    const rows = data || []
    for (const r of rows) {
      const provenanceKeys: string[] = []
      if (r.book_key) provenanceKeys.push(r.book_key)
      if (r.crosssell_key) provenanceKeys.push(r.crosssell_key)
      if (r.winback_key) provenanceKeys.push(r.winback_key)
      out.push({ id: r.id, full_name: r.full_name, email_lc: r.email_lc, phone_digits: r.phone_digits, zip: r.zip, street: r.address, provenanceKeys })
    }
    if (rows.length < page) break
  }
  return out
}
