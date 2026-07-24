// Social PostgREST select-string safety (ADR-026 regression).
//
// The accounts page 500'd because a loader embedded a raw SQL expression in a
// PostgREST select string — `(secret_enc is not null) as has_credential`. PostgREST
// does not support SQL expressions in `select`, and supabase-js strips the whitespace
// first, so the server got `(secret_encisnotnull)ashas_credential` and failed to parse.
//
// The unit suite passed anyway because nothing exercised the actual select string.
// This test parses the EXACT select strings the loaders pass — the real exported
// constants (CHANNEL_COLUMNS, SCHEDULE_CHANNEL_SELECT) plus every social select
// literal — with a parser modeled on PostgREST's grammar, and asserts the old buggy
// form is rejected. It would have failed before the fix.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-select-'))
execSync(
  `npx tsc src/lib/social/channel-view.ts src/lib/social/adapters/index.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const view = require(join(out, 'lib/social/channel-view.js'))
const { CHANNEL_COLUMNS, SCHEDULE_CHANNEL_SELECT } = view

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// ── A parser faithful to how PostgREST parses `select` ───────────────────────
// supabase-js strips whitespace before sending; PostgREST then parses comma-separated
// items, each a column, an aliased column (alias:column), or an embedded resource
// relation[:alias][!hint](subselect). Anything else — a bare parenthesised expression,
// an operator, an "as" alias — is a parse error (exactly the failure we hit).
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function splitTopLevel(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') { depth++; cur += ch }
    else if (ch === ')') { depth--; if (depth < 0) throw new Error('unbalanced )'); cur += ch }
    else if (ch === ',' && depth === 0) { out.push(cur); cur = '' }
    else cur += ch
  }
  if (depth !== 0) throw new Error('unbalanced (')
  out.push(cur)
  return out
}

function parseItem(item) {
  if (item.length === 0) throw new Error('empty select item')
  const paren = item.indexOf('(')
  if (paren !== -1) {
    if (!item.endsWith(')')) throw new Error(`invalid select item (stray expression): ${item}`)
    const head = item.slice(0, paren)
    const inner = item.slice(paren + 1, -1)
    const rel = head.split(/[:!]/)[0]
    if (!IDENT.test(rel)) throw new Error(`invalid embedded relation: ${item}`)
    for (const sub of splitTopLevel(inner)) parseItem(sub)
    return
  }
  const parts = item.split(':')
  if (parts.length > 2) throw new Error(`invalid select item: ${item}`)
  for (const p of parts) if (!IDENT.test(p)) throw new Error(`invalid identifier in select: "${p}" in ${item}`)
}

function parsePostgrestSelect(select) {
  const s = String(select).replace(/\s+/g, '') // supabase-js strips whitespace
  if (!s) throw new Error('empty select')
  const items = splitTopLevel(s)
  const cols = []
  for (const item of items) {
    parseItem(item)
    cols.push(item.split('(')[0].split(':').pop())
  }
  return cols
}

// ── The exact constants the loaders pass ─────────────────────────────────────
t('CHANNEL_COLUMNS parses as valid PostgREST and exposes has_credential, not secret_enc', () => {
  const cols = parsePostgrestSelect(CHANNEL_COLUMNS)
  assert.ok(cols.includes('has_credential'), 'has_credential must be selectable')
  assert.ok(!CHANNEL_COLUMNS.includes('secret_enc'), 'secret_enc must never be selected')
})

t('SCHEDULE_CHANNEL_SELECT (publish path) parses as valid PostgREST', () => {
  const cols = parsePostgrestSelect(SCHEDULE_CHANNEL_SELECT)
  assert.ok(cols.includes('has_credential'))
  assert.ok(!SCHEDULE_CHANNEL_SELECT.includes('secret_enc'))
})

// ── Regression: the OLD buggy form must be rejected ──────────────────────────
t('the old computed-expression select is rejected (reproduces the 500 cause)', () => {
  const buggy =
    'id, platform, external_account_id, status, token_expires_at, (secret_enc is not null) as has_credential'
  assert.throws(() => parsePostgrestSelect(buggy), /invalid|expression/i)
})

// ── Audit: every social select string across the loaders parses cleanly ──────
// Mirrors the loaders enumerated in the fix audit — any future computed-expression
// select added to a social loader must also be added here and will fail this gate.
const SOCIAL_SELECTS = [
  CHANNEL_COLUMNS,
  SCHEDULE_CHANNEL_SELECT,
  'id, scheduled_at, status, channel_id, social_channels(platform, display_name)',
  'id, scheduled_at, status, social_channels(platform)',
  'id, platform, display_name, status',
  'id, title, body, platforms, status, campaign_tag, link, author_kind, current_version_id, is_security',
  'id, version_no, status, snapshot, created_by, created_at',
  'id, title, body, platforms, status, campaign_tag, author_kind, updated_at',
  'platform, metrics, captured_at',
  'id, classification, linked_opportunity_id, linked_task_id',
  'id, content_id, snapshot, status',
  'id, version_id, channel_id, scheduled_at, attempts, next_attempt_at',
  'id, resolved_contact_id',
  'id, household_id, owner_scope',
]

t('every enumerated social select string is PostgREST-safe', () => {
  for (const sel of SOCIAL_SELECTS) {
    assert.doesNotThrow(() => parsePostgrestSelect(sel), `should parse: ${sel}`)
  }
})

console.log(`\nSocial Select safety: ${passed} assertions passed.`)
