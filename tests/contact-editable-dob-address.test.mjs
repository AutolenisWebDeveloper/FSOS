// Contact DOB + street address are EDITABLE and CLEARABLE (ContactCreateSchema /
// ContactPatchSchema in src/lib/validation/schemas.ts). Proves the three things the
// route depends on: an emptied field becomes NULL rather than '' (Postgres `date`
// rejects ''), an implausible or impossible birth date is a field error rather than
// a 500 at the date cast, and an absent field stays absent so a partial PATCH never
// blanks a column it wasn't given.
// Run: node tests/contact-editable-dob-address.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Emit INSIDE the project so the compiled schemas.js can resolve `zod` from node_modules.
const out = mkdtempSync(join(process.cwd(), '.contact-fields-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(
  `npx tsc src/lib/validation/schemas.ts src/lib/auth/rbac.ts src/lib/comms/purpose.ts src/lib/comms/claims.ts ` +
    `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const S = require(join(out, 'lib/validation/schemas.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

/** A create payload that satisfies the "at least a name/email/phone" refine. */
const create = (over = {}) => S.ContactCreateSchema.safeParse({ first_name: 'Dee', ...over })
const patch = (over = {}) => S.ContactPatchSchema.safeParse(over)

const errFor = (res, field) => res.error.flatten().fieldErrors[field]?.[0]

// ─── dobPlausible ─────────────────────────────────────────────────────────────

t('dobPlausible accepts a real, past, in-living-memory date', () => {
  assert.equal(S.dobPlausible('1972-03-14'), true)
  assert.equal(S.dobPlausible('2000-02-29'), true) // real leap day
})

t('dobPlausible treats an absent or cleared DOB as fine', () => {
  assert.equal(S.dobPlausible(undefined), true)
  assert.equal(S.dobPlausible(null), true)
  assert.equal(S.dobPlausible(''), true)
})

t('dobPlausible rejects a date that is not a real calendar day', () => {
  assert.equal(S.dobPlausible('2001-02-31'), false) // Feb 31 rolls over
  assert.equal(S.dobPlausible('1999-02-29'), false) // not a leap year
  assert.equal(S.dobPlausible('1990-13-01'), false) // month 13
  assert.equal(S.dobPlausible('1990-00-10'), false) // month 0
  assert.equal(S.dobPlausible('1990-06-00'), false) // day 0
})

t('dobPlausible rejects the future and the absurd past', () => {
  const nextYear = new Date().getUTCFullYear() + 1
  assert.equal(S.dobPlausible(`${nextYear}-01-01`), false)
  assert.equal(S.dobPlausible('0197-03-14'), false) // fat-fingered year
  assert.equal(S.dobPlausible('1850-01-01'), false)
})

t('dobPlausible rejects a malformed string outright', () => {
  assert.equal(S.dobPlausible('03/14/1972'), false)
  assert.equal(S.dobPlausible('nineteen seventy two'), false)
})

t("dobPlausible's 130-year bound agrees with the record view's age ceiling", () => {
  // ageFromDob (lib/contacts/record-view) returns null at age >= 130, so anything
  // that SAVES must also render an age. Same year, one on each side of the bound.
  const y = new Date().getUTCFullYear()
  assert.equal(S.dobPlausible(`${y - 129}-06-15`), true)
  assert.equal(S.dobPlausible(`${y - 131}-06-15`), false)
})

// ─── Create ───────────────────────────────────────────────────────────────────

t('create accepts and keeps a DOB and a street address', () => {
  const res = create({ dob: '1972-03-14', address: '4820 Custer Road, Suite 210' })
  assert.equal(res.success, true)
  assert.equal(res.data.dob, '1972-03-14')
  assert.equal(res.data.address, '4820 Custer Road, Suite 210')
})

t('create trims a padded street rather than storing the padding', () => {
  const res = create({ address: '  4820 Custer Road  ' })
  assert.equal(res.success, true)
  assert.equal(res.data.address, '4820 Custer Road')
})

t('create turns an empty DOB or street into null, never an empty string', () => {
  const res = create({ dob: '', address: '' })
  assert.equal(res.success, true)
  assert.equal(res.data.dob, null, "'' must clear to null — `date` rejects ''")
  assert.equal(res.data.address, null)
})

t('create rejects an implausible DOB as a FIELD error on dob', () => {
  const res = create({ dob: '2001-02-31' })
  assert.equal(res.success, false)
  assert.match(errFor(res, 'dob'), /real date of birth/i)
})

t('create rejects a malformed DOB with the shared YYYY-MM-DD message', () => {
  const res = create({ dob: '03/14/1972' })
  assert.equal(res.success, false)
  assert.match(errFor(res, 'dob'), /YYYY-MM-DD/)
})

t('create still enforces the street length cap', () => {
  const res = create({ address: 'x'.repeat(301) })
  assert.equal(res.success, false)
  assert.ok(errFor(res, 'address'))
})

t('create without either field leaves both undefined, not null', () => {
  const res = create()
  assert.equal(res.success, true)
  assert.equal('dob' in res.data && res.data.dob !== undefined, false)
  assert.equal('address' in res.data && res.data.address !== undefined, false)
})

// ─── Patch ────────────────────────────────────────────────────────────────────

t('patch accepts a DOB and a street on their own', () => {
  const res = patch({ dob: '1988-11-02', address: '12 Elm St' })
  assert.equal(res.success, true)
  assert.equal(res.data.dob, '1988-11-02')
  assert.equal(res.data.address, '12 Elm St')
})

t('patch clears a wrong DOB or street from an import', () => {
  const res = patch({ dob: '', address: '   ' })
  assert.equal(res.success, true)
  assert.equal(res.data.dob, null)
  assert.equal(res.data.address, null)
})

t('patch accepts an explicit null as a clear', () => {
  const res = patch({ dob: null, address: null })
  assert.equal(res.success, true)
  assert.equal(res.data.dob, null)
  assert.equal(res.data.address, null)
})

t('patch rejects an implausible DOB', () => {
  for (const bad of ['0197-03-14', '2099-01-01', '1999-02-29']) {
    const res = patch({ dob: bad })
    assert.equal(res.success, false, bad)
    assert.match(errFor(res, 'dob'), /real date of birth/i)
  }
})

t('a partial patch omits the fields it was not given, so nothing else is blanked', () => {
  const res = patch({ city: 'McKinney' })
  assert.equal(res.success, true)
  // The route allowlist writes a key only when it is !== undefined.
  assert.equal(res.data.dob, undefined)
  assert.equal(res.data.address, undefined)
  assert.deepEqual(Object.keys(res.data), ['city'])
})

t('an empty patch is still rejected — clearing requires naming the field', () => {
  assert.equal(patch({}).success, false)
})

t('the patch shape stays compatible with the route allowlist', () => {
  // The PATCH route copies these keys straight onto the update. If a rename ever
  // drifts, this catches it before a field silently stops saving.
  const res = patch({
    first_name: 'A', last_name: 'B', company: 'C', title: 'D', contact_type: 'client',
    tags: ['x'], dob: '1972-03-14', address: '1 Main St', city: 'E', state: 'TX',
    zip: '75070', notes: 'n',
  })
  assert.equal(res.success, true)
  for (const k of ['first_name', 'last_name', 'company', 'title', 'contact_type', 'tags', 'dob', 'address', 'city', 'state', 'zip', 'notes']) {
    assert.ok(k in res.data, `route allowlist key missing from parsed patch: ${k}`)
  }
})

console.log(`\n${passed} assertion groups passed`)
