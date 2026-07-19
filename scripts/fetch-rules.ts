#!/usr/bin/env -S npx tsx
// FSOS — automatic rule-fetcher for the Compliance Intelligence corpus.
//
// Reads data/rule_sources.json (the curated registry of exact governing-document
// URLs), fetches each unique page ONCE (robots-respecting, rate-limited 1 req/2s),
// extracts the section named by each entry's extract_hint, and REPLACES the
// paraphrased seed chunk_text in data/seed_corpus.json with the fetched verbatim
// text (verbatim=true). It then re-chunks the verbatim text (~500 tokens, 50
// overlap) and upserts into the DB (compliance_chunks — the module's chunk table,
// keyed by chunk_key = the corpus chunk_id) when Supabase env is configured.
//
// HARD GUARDRAILS (blueprint §5):
//   • NEVER invent or hallucinate rule text. If a URL is unreachable, blocked by
//     robots, a PDF we cannot parse, or the section cannot be located, the chunk is
//     SKIPPED and stays paraphrased (verbatim=false) with a logged reason.
//   • Only the URLs in rule_sources.json are fetched — never "all of FINRA".
//   • Every fetch is logged with URL, HTTP status, and character count.
//
// DB writes go through getDb() (the same lazy service-role client the app uses);
// when Supabase env is absent the DB step is skipped and only the corpus file is
// updated (run `npm run load:corpus` afterward to push it).
//
// Run:  npx tsx scripts/fetch-rules.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getDb, ConfigError } from '../src/lib/supabase/client'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const USER_AGENT = 'FSOS-ComplianceIntelligence-RuleFetcher/1.0 (internal compliance tooling; contact FSA)'
const RATE_MS = 2000
const FETCH_TIMEOUT_MS = 25_000
const MIN_SECTION_CHARS = 80
const MAX_SECTION_CHARS = 6000

// ── env (.env.local passthrough, matching the repo's other scripts) ───────────
function loadEnvLocal(): void {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── types ─────────────────────────────────────────────────────────────────────
interface Source {
  chunk_id: string
  source_org: string
  section_ref: string
  authority_type: string
  url: string
  extract_hint: string
}
interface CorpusChunk {
  chunk_id: string
  authority_type: string
  section_ref: string
  title?: string
  chunk_text: string
  verbatim: boolean
  product_scope?: string[]
  state_scope?: string[]
  governs_nigo_patterns?: string[]
  source_url?: string
  fetched_at?: string
  paraphrase_backup?: string
  [k: string]: unknown
}
interface FetchResult {
  ok: boolean
  status: number
  bytes: number
  text: string
  error?: string
  contentType?: string
}
interface ChunkOutcome {
  chunk_id: string
  url: string
  status: 'verbatim' | 'skipped'
  reason: string
  chars?: number
}

// ── HTTP + robots ─────────────────────────────────────────────────────────────
async function httpGet(url: string): Promise<FetchResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    })
    const contentType = res.headers.get('content-type') ?? ''
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, bytes: text.length, text, contentType }
  } catch (e) {
    return { ok: false, status: 0, bytes: 0, text: '', error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

const robotsCache = new Map<string, string | null>()
/** Minimal robots.txt check for User-agent: * — conservative, fail-open on error. */
async function robotsAllows(url: string): Promise<{ allowed: boolean; note: string }> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { allowed: false, note: 'invalid url' }
  }
  const origin = `${u.protocol}//${u.host}`
  if (!robotsCache.has(origin)) {
    const res = await httpGet(`${origin}/robots.txt`)
    robotsCache.set(origin, res.ok ? res.text : null)
    await sleep(RATE_MS)
  }
  const body = robotsCache.get(origin)
  if (!body) return { allowed: true, note: 'no robots.txt (allow)' }

  // Collect Disallow paths under the most permissive applicable group (User-agent: *).
  const lines = body.split('\n').map((l) => l.replace(/#.*$/, '').trim())
  let inStar = false
  const disallows: string[] = []
  for (const line of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const field = m[1].toLowerCase()
    const value = m[2].trim()
    if (field === 'user-agent') inStar = value === '*'
    else if (field === 'disallow' && inStar && value) disallows.push(value)
  }
  const path = u.pathname + (u.search || '')
  for (const dis of disallows) {
    if (dis === '/') return { allowed: false, note: 'robots disallows /' }
    if (path.startsWith(dis)) return { allowed: false, note: `robots disallows ${dis}` }
  }
  return { allowed: true, note: 'robots allows' }
}

// ── extraction ────────────────────────────────────────────────────────────────
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&sect;/g, '§')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Locate the section the hint names and return a bounded window of verbatim text.
 * Returns null when the hint is not found — which becomes a SKIP (never fabricate).
 */
function extractSection(text: string, hint: string): string | null {
  const hay = text.toLowerCase()
  const needle = hint.toLowerCase().trim()
  let idx = hay.indexOf(needle)
  if (idx === -1) {
    // Fall back to the hint's first distinctive token (e.g. "(b)(1)(A)").
    const token = needle.split(/\s+/)[0]
    if (token && token !== needle) idx = hay.indexOf(token)
  }
  if (idx === -1) return null
  // Start a little before the hint to capture the lead-in sentence.
  const start = Math.max(0, idx - 40)
  const slice = text.slice(start, start + MAX_SECTION_CHARS).trim()
  if (slice.length < MIN_SECTION_CHARS) return null
  return slice
}

const PDF_URL = (url: string, ct?: string) => url.toLowerCase().endsWith('.pdf') || (ct ?? '').includes('pdf')

// ── re-chunk (~500 tokens ≈ 2200 chars, 200 overlap) ──────────────────────────
function reChunk(text: string, size = 2200, overlap = 200): string[] {
  const clean = text.trim()
  if (clean.length <= size) return clean ? [clean] : []
  const out: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length)
    if (end < clean.length) {
      const brk = clean.slice(start, end).lastIndexOf('. ')
      if (brk > size * 0.5) end = start + brk + 1
    }
    out.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return out.filter(Boolean)
}

// ── DB upsert (getDb; skipped when unconfigured) ──────────────────────────────
type Db = ReturnType<typeof getDb>

async function findOrCreateDocument(
  db: Db,
  chunk: CorpusChunk,
): Promise<string | null> {
  // Prefer the document the seed loader already created for this chunk.
  const { data: existingChunk } = await db
    .from('compliance_chunks')
    .select('document_id')
    .eq('chunk_key', chunk.chunk_id)
    .maybeSingle()
  if (existingChunk?.document_id) return existingChunk.document_id as string

  const title = (chunk.section_ref || chunk.title || 'Document').replace(/\([^)]*\)/g, '').trim()
  const { data: existingDoc } = await db
    .from('compliance_documents')
    .select('id')
    .eq('title', title)
    .eq('authority_type', chunk.authority_type)
    .maybeSingle()
  if (existingDoc?.id) return existingDoc.id as string

  const { data: created, error } = await db
    .from('compliance_documents')
    .insert({
      title,
      authority_type: chunk.authority_type,
      source_org: (chunk.source_url ? new URL(chunk.source_url).host : null),
      section_ref: title,
      product_scope: chunk.product_scope ?? [],
      state_scope: chunk.state_scope ?? [],
      verbatim: true,
      source: 'import',
      created_by: 'rule-fetcher',
      updated_by: 'rule-fetcher',
    })
    .select('id')
    .single()
  if (error || !created) return null
  return created.id as string
}

async function upsertVerbatimChunks(db: Db, chunk: CorpusChunk, verbatimText: string): Promise<number> {
  const documentId = await findOrCreateDocument(db, chunk)
  if (!documentId) return 0
  const pieces = reChunk(verbatimText)
  let n = 0
  for (let i = 0; i < pieces.length; i++) {
    // The first piece keeps the canonical chunk_id; overflow pieces get #k suffixes.
    const chunk_key = i === 0 ? chunk.chunk_id : `${chunk.chunk_id}#${i + 1}`
    const row = {
      document_id: documentId,
      chunk_key,
      seq: i,
      authority_type: chunk.authority_type,
      section_ref: chunk.section_ref ?? null,
      title: chunk.title ?? null,
      chunk_text: pieces[i],
      product_scope: chunk.product_scope ?? [],
      state_scope: chunk.state_scope ?? [],
      governs_patterns: chunk.governs_nigo_patterns ?? [],
      verbatim: true,
    }
    const { error } = await db.from('compliance_chunks').upsert(row, { onConflict: 'chunk_key' })
    if (!error) n++
  }
  return n
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadEnvLocal()

  const registryPath = join(root, 'data', 'rule_sources.json')
  const corpusPath = join(root, 'data', 'seed_corpus.json')
  if (!existsSync(registryPath)) throw new Error(`Missing ${registryPath}`)
  if (!existsSync(corpusPath)) throw new Error(`Missing ${corpusPath}`)

  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { sources: Source[] }
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as { chunks: CorpusChunk[] }
  const sources = registry.sources ?? []
  const chunkById = new Map<string, CorpusChunk>(corpus.chunks.map((c) => [c.chunk_id, c]))

  // Optional DB.
  let db: Db | null = null
  try {
    db = getDb()
    console.log('• Supabase configured — verbatim chunks will be upserted into compliance_chunks.')
  } catch (e) {
    if (e instanceof ConfigError) {
      console.log('• Supabase NOT configured — updating data/seed_corpus.json only; run `npm run load:corpus` later.')
    } else {
      throw e
    }
  }

  // Group sources by URL so each page is fetched exactly once.
  const byUrl = new Map<string, Source[]>()
  for (const s of sources) {
    const arr = byUrl.get(s.url) ?? []
    arr.push(s)
    byUrl.set(s.url, arr)
  }

  const outcomes: ChunkOutcome[] = []
  const fetchLog: { url: string; status: number; bytes: number; contentType?: string; note: string }[] = []
  let corpusChanged = false

  console.log(`\nFetching ${byUrl.size} unique source page(s) for ${sources.length} chunk(s)…\n`)

  for (const [url, entries] of byUrl) {
    const robots = await robotsAllows(url)
    if (!robots.allowed) {
      fetchLog.push({ url, status: 0, bytes: 0, note: robots.note })
      console.log(`  ⤫ ${url}\n      SKIP — ${robots.note}`)
      for (const e of entries) outcomes.push({ chunk_id: e.chunk_id, url, status: 'skipped', reason: robots.note })
      continue
    }

    const res = await httpGet(url)
    fetchLog.push({ url, status: res.status, bytes: res.bytes, contentType: res.contentType, note: res.error ?? 'ok' })
    console.log(`  → ${url}\n      HTTP ${res.status} · ${res.bytes} chars${res.contentType ? ` · ${res.contentType.split(';')[0]}` : ''}${res.error ? ` · ${res.error}` : ''}`)

    await sleep(RATE_MS)

    if (!res.ok || !res.text) {
      const reason = res.error ? `fetch error: ${res.error}` : `HTTP ${res.status}`
      for (const e of entries) outcomes.push({ chunk_id: e.chunk_id, url, status: 'skipped', reason })
      continue
    }
    if (PDF_URL(url, res.contentType)) {
      const reason = 'PDF source — automatic extraction not supported; upload manually'
      for (const e of entries) outcomes.push({ chunk_id: e.chunk_id, url, status: 'skipped', reason })
      continue
    }

    const pageText = htmlToText(res.text)
    for (const e of entries) {
      const chunk = chunkById.get(e.chunk_id)
      if (!chunk) {
        outcomes.push({ chunk_id: e.chunk_id, url, status: 'skipped', reason: 'chunk_id not in seed corpus' })
        continue
      }
      const section = extractSection(pageText, e.extract_hint)
      if (!section) {
        outcomes.push({ chunk_id: e.chunk_id, url, status: 'skipped', reason: `extract_hint "${e.extract_hint}" not found on page` })
        continue
      }
      // Replace the paraphrase with verbatim text (keep a one-time backup).
      if (chunk.paraphrase_backup === undefined) chunk.paraphrase_backup = chunk.chunk_text
      chunk.chunk_text = section
      chunk.verbatim = true
      chunk.source_url = url
      chunk.fetched_at = new Date().toISOString()
      corpusChanged = true

      let dbNote = ''
      if (db) {
        const n = await upsertVerbatimChunks(db, chunk, section)
        dbNote = ` · db rows upserted: ${n}`
      }
      outcomes.push({ chunk_id: e.chunk_id, url, status: 'verbatim', reason: 'section extracted', chars: section.length })
      console.log(`      ✓ ${e.chunk_id} — verbatim ${section.length} chars${dbNote}`)
    }
  }

  // Persist the updated corpus ONLY when a chunk actually became verbatim — avoids
  // a spurious whole-file reformat when every source was skipped.
  if (corpusChanged) writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + '\n', 'utf8')

  // Persist an audit log.
  const logPath = join(root, 'data', 'rule_fetch_log.json')
  writeFileSync(
    logPath,
    JSON.stringify({ ran_at: new Date().toISOString(), fetches: fetchLog, outcomes }, null, 2) + '\n',
    'utf8',
  )

  // ── Summary ───────────────────────────────────────────────────────────────
  const verbatim = outcomes.filter((o) => o.status === 'verbatim')
  const skipped = outcomes.filter((o) => o.status === 'skipped')
  const manualOnly = corpus.chunks
    .filter((c) => !sources.some((s) => s.chunk_id === c.chunk_id))
    .map((c) => c.chunk_id)

  console.log('\n──────────────────────────── SUMMARY ────────────────────────────')
  console.log(`Now VERBATIM (${verbatim.length}):`)
  for (const o of verbatim) console.log(`  ✓ ${o.chunk_id}  (${o.chars} chars)  ${o.url}`)
  console.log(`\nSKIPPED — still paraphrased, verbatim=false (${skipped.length}):`)
  for (const o of skipped) console.log(`  ⤫ ${o.chunk_id}  — ${o.reason}`)
  console.log(`\nNever auto-fetched — require manual upload (${manualOnly.length}):`)
  for (const id of manualOnly) console.log(`  · ${id}`)
  console.log(`\nCorpus: ${corpusChanged ? 'updated data/seed_corpus.json (verbatim text written)' : 'unchanged (no chunk became verbatim)'}`)
  console.log('Audit log:      data/rule_fetch_log.json')
  if (!db) console.log('DB not updated (Supabase env absent). Run `npm run load:corpus` once configured.')
  console.log('──────────────────────────────────────────────────────────────────\n')
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
