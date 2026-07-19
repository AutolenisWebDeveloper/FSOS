#!/usr/bin/env node
// FSOS — load the Compliance Intelligence seed knowledge corpus.
//
// Reads data/seed_corpus.json (20 authority-tagged, citation-referenced rule
// chunks) and loads it into compliance_documents + compliance_chunks (migration
// 036). Grouping: one compliance_documents row per (source_org + section_ref)
// source doc; one compliance_chunks row per chunk. Idempotent — chunks upsert by
// chunk_key, so re-running updates in place rather than duplicating.
//
// Embeddings: the retrieval path is Postgres full-text search (search_tsv,
// maintained by a DB trigger), so NO embedding provider is required — chunks load
// and are immediately searchable. The optional pgvector `embedding` column is left
// NULL for future semantic back-fill.
//
// Usage:  npm run load:corpus
// Env:    NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL  and
//         SUPABASE_SERVICE_KEY     | SUPABASE_SERVICE_ROLE_KEY
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const path = join(root, '.env.local')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

async function main() {
  loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    fail(
      'Supabase env not set. Provide NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and ' +
        'SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY).',
    )
  }

  const corpusPath = join(root, 'data', 'seed_corpus.json')
  if (!existsSync(corpusPath)) fail(`Corpus not found at ${corpusPath}`)
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
  const chunks = Array.isArray(corpus.chunks) ? corpus.chunks : []
  if (!chunks.length) fail('Corpus has no chunks[].')

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  // 1) Group chunks into source documents by (source_org|section-doc|authority).
  //    section_ref like "Rule 2330(b)(1)(A)" → doc key "Rule 2330" so all 2330
  //    sub-parts share one document row.
  const docKeyOf = (c) => {
    const base = (c.section_ref || c.title || c.chunk_id || 'doc')
      .replace(/\([^)]*\)/g, '')
      .trim()
    return `${c.authority_type}::${c.source_org || ''}::${base}`
  }

  const docs = new Map()
  for (const c of chunks) {
    const k = docKeyOf(c)
    if (!docs.has(k)) {
      const base = (c.section_ref || c.title || 'Document').replace(/\([^)]*\)/g, '').trim()
      docs.set(k, {
        title: base,
        authority_type: c.authority_type,
        source_org: c.source_org || null,
        section_ref: base,
        product_scope: c.product_scope || [],
        state_scope: c.state_scope || [],
        verbatim: !!c.verbatim,
        source: 'seed',
        members: [],
      })
    }
    docs.get(k).members.push(c)
  }

  let docCount = 0
  let chunkCount = 0
  for (const [, doc] of docs) {
    // Upsert the document (match on title+authority_type to stay idempotent).
    const { data: existing } = await db
      .from('compliance_documents')
      .select('id')
      .eq('title', doc.title)
      .eq('authority_type', doc.authority_type)
      .maybeSingle()

    let documentId = existing?.id
    if (!documentId) {
      const { data: created, error } = await db
        .from('compliance_documents')
        .insert({
          title: doc.title,
          authority_type: doc.authority_type,
          source_org: doc.source_org,
          section_ref: doc.section_ref,
          product_scope: doc.product_scope,
          state_scope: doc.state_scope,
          verbatim: doc.verbatim,
          source: 'seed',
          created_by: 'seed',
          updated_by: 'seed',
        })
        .select('id')
        .single()
      if (error) fail(`Insert document "${doc.title}" failed: ${error.message}`)
      documentId = created.id
    }
    docCount++

    // Upsert each chunk by chunk_key (the corpus chunk_id) for idempotency.
    for (let i = 0; i < doc.members.length; i++) {
      const c = doc.members[i]
      const row = {
        document_id: documentId,
        chunk_key: c.chunk_id,
        seq: i,
        authority_type: c.authority_type,
        section_ref: c.section_ref || null,
        title: c.title || null,
        chunk_text: c.chunk_text || '',
        product_scope: c.product_scope || [],
        state_scope: c.state_scope || [],
        governs_patterns: c.governs_nigo_patterns || [],
        verbatim: !!c.verbatim,
      }
      const { error } = await db.from('compliance_chunks').upsert(row, { onConflict: 'chunk_key' })
      if (error) fail(`Upsert chunk "${c.chunk_id}" failed: ${error.message}`)
      chunkCount++
    }
  }

  console.log(`\n✓ Loaded ${chunkCount} chunks across ${docCount} documents.`)
  console.log('  Retrieval is full-text (search_tsv) — no embedding step required.')
  console.log('  Next: upload your FFS_PROCEDURE + CARRIER_REQUIREMENT docs via the Knowledge Library tab.')
  console.log('  Verify FINRA/SEC/state chunks against primary sources, then set verbatim=true before external use.\n')
}

main().catch((e) => fail(e?.message || String(e)))
