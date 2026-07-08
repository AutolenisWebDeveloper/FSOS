// Standalone test harness (no test-runner dep) for the CSV → GHL mapping layer.
// Run: node tests/ghlUpload.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-test-'))
execSync(
  `npx tsc src/lib/csv.ts src/lib/ghlContacts.ts src/lib/ghl.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { parseCsv, parseCsvRecords } = require(join(out, 'csv.js'))
const { detectColumnMap, mapAndValidateRow, normalizeEmail, normalizePhone } = require(join(out, 'ghlContacts.js'))
const { withGhlRetry } = require(join(out, 'ghl.js'))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

console.log('CSV parser')
await t('parses simple rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']])
})
await t('handles quoted commas and newlines', () => {
  const m = parseCsv('name,note\n"Doe, John","line1\nline2"')
  assert.deepEqual(m[1], ['Doe, John', 'line1\nline2'])
})
await t('handles escaped quotes, CRLF and BOM', () => {
  const m = parseCsv('﻿a,b\r\n"He said ""hi""",x\r\n')
  assert.deepEqual(m, [['a', 'b'], ['He said "hi"', 'x']])
})
await t('drops fully blank lines', () => {
  assert.equal(parseCsv('a,b\n1,2\n\n\n3,4').length, 3)
})
await t('records keyed by trimmed header', () => {
  const { headers, rows } = parseCsvRecords(' Email , Phone \nA@B.COM , 555 ')
  assert.deepEqual(headers, ['Email', 'Phone'])
  assert.equal(rows[0].Email, 'A@B.COM')
})

console.log('Normalizers')
await t('email validation', () => {
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com')
  assert.equal(normalizeEmail('not-an-email'), null)
})
await t('phone normalization to E.164', () => {
  assert.equal(normalizePhone('(512) 555-1234'), '+15125551234')
  assert.equal(normalizePhone('1-512-555-1234'), '+15125551234')
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958')
  assert.equal(normalizePhone('123'), null)
})

console.log('Column detection + mapping')
await t('detects aliased headers', () => {
  const map = detectColumnMap(['First Name', 'LAST_NAME', 'E-Mail', 'Cell Phone', 'Tags'])
  assert.equal(map['First Name'], 'first_name')
  assert.equal(map['LAST_NAME'], 'last_name')
  assert.equal(map['E-Mail'], 'email')
  assert.equal(map['Cell Phone'], 'phone')
  assert.equal(map['Tags'], 'tags')
})
await t('maps a valid row with defaults + tag merge', () => {
  const map = detectColumnMap(['first name', 'last name', 'email', 'phone', 'tags'])
  const { contact, errors } = mapAndValidateRow(
    { 'first name': 'Jane', 'last name': 'Doe', email: 'JANE@X.com', phone: '512-555-0000', tags: 'vip;warm' },
    map, { tags: ['import'], source: 'apex' })
  assert.equal(errors.length, 0)
  assert.equal(contact.email, 'jane@x.com')
  assert.equal(contact.phone, '+15125550000')
  assert.deepEqual(contact.tags.sort(), ['import', 'vip', 'warm'])
  assert.equal(contact.source, 'apex')
  assert.equal(contact.dedupeKey, 'jane@x.com')
})
await t('splits a full-name column when no first/last', () => {
  const map = detectColumnMap(['name', 'email'])
  const { contact } = mapAndValidateRow({ name: 'John Q Public', email: 'a@b.co' }, map, {})
  assert.equal(contact.firstName, 'John')
  assert.equal(contact.lastName, 'Q Public')
})
await t('maps an Agency Owner column into the referring_agency_owner custom field', () => {
  const map = detectColumnMap(['name', 'email', 'Agency Owner'])
  assert.equal(map['Agency Owner'], 'agency_owner')
  const { contact } = mapAndValidateRow({ name: 'Jane Doe', email: 'a@b.co', 'Agency Owner': 'Markist Athelus' }, map, {})
  assert.equal(contact.customFields.referring_agency_owner, 'Markist Athelus')
})
await t('applies the batch agencyOwner default when a row has no owner column', () => {
  const map = detectColumnMap(['name', 'email'])
  const { contact } = mapAndValidateRow({ name: 'Jane Doe', email: 'a@b.co' }, map, { agencyOwner: 'Sarah Chen' })
  assert.equal(contact.customFields.referring_agency_owner, 'Sarah Chen')
})
await t('row-level Agency Owner overrides the batch default', () => {
  const map = detectColumnMap(['name', 'email', 'agency owner'])
  const { contact } = mapAndValidateRow({ name: 'Jane Doe', email: 'a@b.co', 'agency owner': 'Row Owner' }, map, { agencyOwner: 'Batch Owner' })
  assert.equal(contact.customFields.referring_agency_owner, 'Row Owner')
})
await t('rejects a row with no name', () => {
  const { contact, errors } = mapAndValidateRow({ email: 'a@b.co' }, detectColumnMap(['email']), {})
  assert.equal(contact, null)
  assert.ok(errors.some((e) => /name/i.test(e)))
})
await t('rejects a row with neither valid email nor phone', () => {
  const map = detectColumnMap(['name', 'email', 'phone'])
  const { contact, errors } = mapAndValidateRow({ name: 'X Y', email: 'bad', phone: '12' }, map, {})
  assert.equal(contact, null)
  assert.ok(errors.some((e) => /email or phone/i.test(e)))
})

console.log('Retry helper')
await t('retries transient failures then succeeds', async () => {
  let n = 0
  const res = await withGhlRetry(async () => {
    n++
    return n < 3 ? { ok: false, status: 500, error: 'boom' } : { ok: true, status: 200, data: { contact: { id: 'c1' } } }
  }, { sleep: async () => {} })
  assert.equal(res.ok, true)
  assert.equal(res.attempts, 3)
})
await t('does not retry 4xx client errors', async () => {
  let n = 0
  const res = await withGhlRetry(async () => { n++; return { ok: false, status: 422, error: 'invalid' } }, { sleep: async () => {} })
  assert.equal(res.ok, false)
  assert.equal(n, 1)
})
await t('stops after max attempts on persistent failure', async () => {
  let n = 0
  const res = await withGhlRetry(async () => { n++; return { ok: false, status: 503, error: 'down' } }, { attempts: 4, sleep: async () => {} })
  assert.equal(res.attempts, 4)
  assert.equal(n, 4)
})

console.log(`\nAll ${passed} assertions passed.`)
