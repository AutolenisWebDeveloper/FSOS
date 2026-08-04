// Contact Import — Field Recognition & Mapping Model (design spec v2.1).
// Proves the pure engine against the five real Farmers district export shapes:
//   §1 template auto-detection by header signature
//   §2 auto-recognition dictionary (source header → FSOS field), exact + fuzzy
//   §3 composite/derived split (AOR with Series Code → aor_code + series_code)
//   §4/§5 plan builder: template + per-header memory + custom + unrecognized,
//         DOB imports as a plain field with NO gating.
// Pure, deterministic — no DB, no clock. Run: npx tsx tests/import-mapping-model.test.mts
import assert from 'node:assert/strict'
import {
  recognizeHeader,
  detectTemplate,
  signatureHash,
  compositeRuleFor,
  splitComposite,
  buildMappingPlan,
  buildCommitPlan,
  extractRowExtras,
  parseDobToIso,
  getTargetField,
  DEFAULT_COMPOSITE_DELIMITER,
  type HeaderDecision,
} from '@/lib/import/mapping'

let passed = 0
const t = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// ── §2 auto-recognition dictionary (exact) ─────────────────────────────────
t('exact dictionary maps the spec §2 household/member/policy/agency headers', () => {
  const expect: Record<string, string> = {
    'Account Name': 'household.household_name',
    'Owner Address': 'household.street',
    'Mailing State': 'household.state',
    'Preferred Household Phone': 'household.preferred_phone',
    'Preferred Email Address': 'household.preferred_email',
    'Active LOB': 'household.active_lob',
    'Inactive Agency LOB': 'household.inactive_lob',
    'Policy Owner': 'member.full_name',
    'Insured Name': 'member.full_name',
    'Insured Birthday': 'member.dob',
    'Joint Owner Name': 'member.joint_full_name',
    'Joint Owner ZIP': 'member.joint_zip',
    'Policy Number': 'policy.policy_number',
    'Convertible Amount': 'policy.convertible_amount',
    'Conversion Expiring Date': 'policy.conversion_expiring_date',
    'Series Code': 'policy.series_code',
    'Agent of Record': 'agency.agent_of_record',
    'AOR Code': 'agency.aor_code',
    'Agency AOR': 'agency.aor_code',
  }
  for (const [header, fieldId] of Object.entries(expect)) {
    const m = recognizeHeader(header)
    assert.ok(m, `no match for "${header}"`)
    assert.equal(m!.fieldId, fieldId, `"${header}" → ${m!.fieldId}, expected ${fieldId}`)
    assert.equal(m!.confidence, 'high', `"${header}" should be a high-confidence exact match`)
  }
})

t('recognition is case / spacing / punctuation insensitive', () => {
  for (const variant of ['policy_number', 'POLICY NUMBER', 'Policy-Number', ' policy number ']) {
    assert.equal(recognizeHeader(variant)?.fieldId, 'policy.policy_number', variant)
  }
})

t('DOB is a plain recognized field — no gating, no special-casing', () => {
  const m = recognizeHeader('Insured Birthday')
  assert.equal(m?.fieldId, 'member.dob')
  assert.equal(getTargetField('member.dob')?.type, 'date')
})

t('fuzzy pass catches a near-miss header at lower confidence', () => {
  // Not an exact alias, but token-overlaps "policy number".
  const m = recognizeHeader('Policy No.')
  assert.ok(m, 'expected a fuzzy match for "Policy No."')
  assert.notEqual(m!.confidence, 'high')
})

t('a truly unknown header does not match', () => {
  assert.equal(recognizeHeader('Favorite Color'), null)
  assert.equal(recognizeHeader('   '), null)
})

// ── §3 composite / derived split ───────────────────────────────────────────
t('AOR with Series Code is a known composite → aor_code + series_code', () => {
  const rule = compositeRuleFor('AOR with Series Code')
  assert.ok(rule)
  assert.deepEqual(rule!.targets, ['agency.aor_code', 'policy.series_code'])
  assert.equal(rule!.isAssumption, true, 'default delimiter is a labeled config assumption (§4.3)')
})

t('composite split does not break on the hyphens inside an AOR code', () => {
  const rule = compositeRuleFor('AOR with Series Code')!
  const out = splitComposite('19-41-319 / A1B2', rule)
  assert.equal(out['agency.aor_code'], '19-41-319')
  assert.equal(out['policy.series_code'], 'A1B2')
  // Whitespace-delimited variant.
  const out2 = splitComposite('19-41-594  200', rule)
  assert.equal(out2['agency.aor_code'], '19-41-594')
  assert.equal(out2['policy.series_code'], '200')
})

t('composite split returns {} for a blank value', () => {
  const rule = compositeRuleFor('AOR with Series Code')!
  assert.deepEqual(splitComposite('   ', rule), {})
})

t('DEFAULT_COMPOSITE_DELIMITER never splits on a hyphen', () => {
  assert.ok(!new RegExp(DEFAULT_COMPOSITE_DELIMITER).test('-'))
})

// ── §1 template detection by header signature ──────────────────────────────
const TEMPLATE_HEADERS: Record<string, string[]> = {
  life_conversion_policy_detail: ['Insured Name', 'Owner Name', 'Joint Owner Name', 'Series Code', 'Policy Number', 'Face Amount'],
  district_life_conversion: ['Conversion Expiring Date', 'Policy Holder Name', 'AOR Code', 'Primary Insured Name', 'Coverage Amount'],
  life_conversion_convertible: ['Conversion Expiry Date', 'Policy Owner', 'Insured Birthday', 'Convertible Amount', 'AOR with Series Code'],
  district_win_back_life: ['Inactive Agency LOB', 'Account Name', 'Mailing State', 'Preferred Phone'],
  district_cross_sell_life: ['Active LOB', 'Preferred Household Phone', 'Agency AOR', 'Account Name'],
}

t('each of the five district exports auto-detects its template', () => {
  for (const [key, headers] of Object.entries(TEMPLATE_HEADERS)) {
    const detected = detectTemplate(headers)
    assert.ok(detected, `no template detected for ${key}`)
    assert.equal(detected!.key, key, `${key} misdetected as ${detected!.key}`)
  }
})

t('template detection tolerates extra + reordered columns', () => {
  const headers = ['ZZ Extra', 'Series Code', 'Joint Owner Name', 'Owner Name', 'Insured Name', 'Another Extra']
  assert.equal(detectTemplate(headers)?.key, 'life_conversion_policy_detail')
})

t('a non-district file detects no template', () => {
  assert.equal(detectTemplate(['First Name', 'Last Name', 'Email', 'Phone']), null)
})

t('signatureHash is stable + order-independent', () => {
  const a = signatureHash(['Owner Name', 'Series Code', 'Insured Name'])
  const b = signatureHash(['insured name', 'series code', 'owner name'])
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{8}$/)
  assert.notEqual(a, signatureHash(['Totally', 'Different']))
})

// ── §4/§5 plan builder ─────────────────────────────────────────────────────
t('plan auto-maps a Convertible file end-to-end (incl. composite + DOB)', () => {
  const headers = TEMPLATE_HEADERS.life_conversion_convertible
  const rows = [{ 'Conversion Expiry Date': '2026-07-28', 'Policy Owner': 'ORNELAS, DELFINO', 'Insured Birthday': '1980-05-15', 'Convertible Amount': '150000', 'AOR with Series Code': '19-41-319 A1' }]
  const plan = buildMappingPlan({ headers, rows })
  assert.equal(plan.template?.key, 'life_conversion_convertible')
  const bySource = Object.fromEntries(plan.entries.map((e) => [e.source, e.decision]))
  assert.equal((bySource['Insured Birthday'] as any).fieldId, 'member.dob')
  assert.equal((bySource['Policy Owner'] as any).fieldId, 'member.full_name')
  const split = bySource['AOR with Series Code'] as Extract<HeaderDecision, { kind: 'split' }>
  assert.equal(split.kind, 'split')
  assert.deepEqual(split.rule.targets, ['agency.aor_code', 'policy.series_code'])
  assert.equal(plan.unrecognized.length, 0, 'a known district file has no unrecognized headers')
  // Sample values are captured for the preview.
  const dobEntry = plan.entries.find((e) => e.source === 'Insured Birthday')!
  assert.deepEqual(dobEntry.sampleValues, ['1980-05-15'])
})

t('unrecognized headers are surfaced for the operator to map once (§4)', () => {
  const plan = buildMappingPlan({ headers: ['Owner Name', 'Widget Score', 'Email'], rows: [{ 'Owner Name': 'A B', 'Widget Score': '7', Email: 'a@b.com' }] })
  assert.deepEqual(plan.unrecognized, ['Widget Score'])
  const entry = plan.entries.find((e) => e.source === 'Widget Score')!
  assert.equal(entry.decision.kind, 'unrecognized')
  assert.equal(entry.confidence, 'none')
})

t('saved template header_map wins over the dictionary + marks remembered (§5)', () => {
  // Operator once mapped "Widget Score" to a custom member field; it is remembered.
  const savedHeaderMap: Record<string, HeaderDecision> = {
    widgetscore: { kind: 'custom', customKey: 'widget_score', entity: 'member', fieldType: 'number', label: 'Widget Score' },
    // Force an override that the dictionary would map differently, to prove precedence.
    ownername: { kind: 'ignore' },
  }
  const plan = buildMappingPlan({ headers: ['Owner Name', 'Widget Score'], rows: [{}], savedHeaderMap })
  const owner = plan.entries.find((e) => e.source === 'Owner Name')!
  assert.equal(owner.decision.kind, 'ignore')
  assert.equal(owner.method, 'template')
  assert.equal(owner.remembered, true)
  const widget = plan.entries.find((e) => e.source === 'Widget Score')!
  assert.equal(widget.decision.kind, 'custom')
  assert.equal(widget.entity, 'member')
  assert.equal(plan.unrecognized.length, 0)
})

t('per-header global memory applies across files when no template is present (§5)', () => {
  const headerMemory: Record<string, HeaderDecision> = {
    widgetscore: { kind: 'custom', customKey: 'widget_score', entity: 'member', fieldType: 'number' },
  }
  const plan = buildMappingPlan({ headers: ['Widget Score'], rows: [{}], headerMemory })
  const e = plan.entries[0]
  assert.equal(e.decision.kind, 'custom')
  assert.equal(e.method, 'memory')
  assert.equal(e.remembered, true)
})

t('two headers claiming the same field are flagged as a conflict (not silently merged)', () => {
  const plan = buildMappingPlan({ headers: ['Email', 'Email Address'], rows: [{}] })
  const second = plan.entries[1]
  assert.equal(second.conflict, true)
})

// ── commit translation (confirmed mapping → contact pipeline + extras) ──────
function decisionsFor(headers: string[]): Record<string, HeaderDecision> {
  // Simulate a confirmed plan by auto-recognizing each header.
  const out: Record<string, HeaderDecision> = {}
  const plan = buildMappingPlan({ headers, rows: [{}] })
  for (const e of plan.entries) out[e.squashed] = e.decision
  return out
}

t('buildCommitPlan routes core fields to the legacy mapper and extras to their slots', () => {
  const headers = ['Owner Name', 'Preferred Email', 'Preferred Household Phone', 'Owner Address', 'Owner City', 'Owner State', 'Owner Zip', 'Insured Birthday', 'Active LOB', 'AOR with Series Code', 'Policy Number']
  const cp = buildCommitPlan(headers, decisionsFor(headers))
  assert.equal(cp.colMap['Owner Name'], 'full_name')
  assert.equal(cp.colMap['Preferred Email'], 'email')
  assert.equal(cp.colMap['Preferred Household Phone'], 'phone')
  assert.equal(cp.address.street, 'Owner Address')
  assert.equal(cp.address.city, 'Owner City')
  assert.equal(cp.address.state, 'Owner State')
  assert.equal(cp.address.zip, 'Owner Zip')
  assert.equal(cp.dobHeader, 'Insured Birthday')
  assert.deepEqual(cp.lobHeaders, ['Active LOB'])
  assert.equal(cp.splitHeaders.length, 1)
  assert.ok(cp.customHeaders.some((c) => c.key === 'policy.policy_number'))
})

t('extractRowExtras produces address, plain DOB, LOB tags, split + policy custom values', () => {
  const headers = ['Owner Address', 'Owner State', 'Insured Birthday', 'Active LOB', 'AOR with Series Code', 'Policy Number']
  const cp = buildCommitPlan(headers, decisionsFor(headers))
  const row = { 'Owner Address': '100 Main St', 'Owner State': 'TX', 'Insured Birthday': '05/15/1980', 'Active LOB': 'Auto;Home', 'AOR with Series Code': '19-41-319 A1', 'Policy Number': '7814352' }
  const x = extractRowExtras(row, cp)
  assert.equal(x.address, '100 Main St')
  assert.equal(x.state, 'TX')
  assert.equal(x.dob, '1980-05-15', 'MM/DD/YYYY DOB normalizes to ISO, no gating')
  assert.deepEqual(x.extraTags.sort(), ['Auto', 'Home'])
  assert.equal(x.custom['agency.aor_code'], '19-41-319')
  assert.equal(x.custom['policy.series_code'], 'A1')
  assert.equal(x.custom['policy.policy_number'], '7814352')
})

t('joint owner is captured as a distinct person on the same row (spec §6)', () => {
  const headers = ['Owner Name', 'Joint Owner Name', 'Joint Owner Phone']
  const cp = buildCommitPlan(headers, decisionsFor(headers))
  const x = extractRowExtras({ 'Owner Name': 'A B', 'Joint Owner Name': 'C B', 'Joint Owner Phone': '512-555-0100' }, cp)
  assert.ok(x.joint)
  assert.equal(x.joint!.full_name, 'C B')
  assert.equal(x.joint!.phone, '512-555-0100')
})

t('a custom decision yields a required custom-field definition', () => {
  const headerMap: Record<string, HeaderDecision> = {
    widgetscore: { kind: 'custom', customKey: 'widget_score', entity: 'member', fieldType: 'number', label: 'Widget Score' },
  }
  const cp = buildCommitPlan(['Widget Score'], headerMap)
  assert.equal(cp.requiredCustomFields.length, 1)
  assert.equal(cp.requiredCustomFields[0].key, 'widget_score')
  assert.equal(cp.customHeaders[0].key, 'member.widget_score')
})

t('parseDobToIso handles ISO + MDY and rejects junk without throwing', () => {
  assert.equal(parseDobToIso('1980-05-15'), '1980-05-15')
  assert.equal(parseDobToIso('5/1/1990'), '1990-05-01')
  assert.equal(parseDobToIso('not a date'), null)
  assert.equal(parseDobToIso(''), null)
})

t('an operator-supplied mapping never pollutes Object.prototype', () => {
  // Custom keys are entity-prefixed harmless own-properties; the isSafeCustomKey
  // guard additionally drops any bare reserved key. Neither can touch the prototype.
  const headerMap: Record<string, HeaderDecision> = {
    evil: { kind: 'custom', customKey: '__proto__', entity: 'member', fieldType: 'text' },
  }
  const cp = buildCommitPlan(['Evil'], headerMap)
  const x = extractRowExtras({ Evil: 'polluted' }, cp)
  assert.equal(Object.getPrototypeOf(x.custom), Object.prototype, 'prototype intact')
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'no global pollution')
  assert.equal(x.custom['member.__proto__'], 'polluted', 'stored as a safe dotted own-property')
})

console.log(`\nAll ${passed} mapping-model assertions passed.`)
