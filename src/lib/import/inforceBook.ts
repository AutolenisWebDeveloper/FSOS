// src/lib/import/inforceBook.ts
// Parser + mapper for an FNWL "Review of in-force business" export. Finds the
// real header row (the export prefixes a confidentiality notice), then maps each
// policy row onto App B's aggregate-root shape: a serving agent, an owner
// (household + members), and a policy. Status is normalized to the
// household_policies enum; variable products are flagged is_security (§2.1).

import ExcelJS from 'exceljs'

export type PolicyStatus = 'active' | 'lapsed' | 'cancelled' | 'non_renewed' | 'renewed'

export interface InforcePolicy {
  policy_number: string
  product_name: string
  status_raw: string
  status: PolicyStatus
  is_security: boolean
  face_amount: number | null
  accumulation_value: number | null
  issue_date: string | null
  conversion_date: string | null
  insured_name: string | null
  owner_name: string
  owner_email: string | null
  owner_dob: string | null
  owner_address: string | null
  owner_city: string | null
  owner_state: string | null
  owner_zip: string | null
  owner_phone: string | null
  joint_owner_name: string | null
  joint_owner_address: string | null
  joint_owner_city: string | null
  joint_owner_state: string | null
  joint_owner_zip: string | null
  joint_owner_phone: string | null
  joint_owner_key: string | null
  serving_agent_name: string | null
  serving_agent_no: string | null
  series_code: string | null
  book_owner_key: string
  source_data: Record<string, string>
}

export interface ParsedBook {
  headerRow: number
  headers: string[]
  policies: InforcePolicy[]
  skipped: number // rows without a policy number or owner
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellStr(v: any): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    if (typeof v.text === 'string') return v.text
    if (typeof v.result !== 'undefined') return String(v.result)
    if (typeof v.hyperlink === 'string') return v.hyperlink
  }
  return String(v).trim()
}

function toIsoDate(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function toNum(s: string): number | null {
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) && s.trim() !== '' ? n : null
}

// FNWL status text → household_policies.status enum (migration 009).
export function mapStatus(raw: string): PolicyStatus {
  const t = raw.toLowerCase()
  if (t.includes('lapse')) return 'lapsed'
  if (t.includes('surrender') || t.includes('cancel') || t.includes('terminat') || t.includes('delete')) return 'cancelled'
  if (t.includes('conversion')) return 'renewed'
  if (t.includes('death') || t.includes('matured') || t.includes('expired')) return 'non_renewed'
  // in-force forms: Active (inforce), Reduced Paid Up, Paid-Up, Extended Term,
  // Under Disability, Lapse Pending (still in force pending) → active.
  return 'active'
}

// Variable products are securities-registered → firewall-flagged.
export function isSecurityProduct(productName: string): boolean {
  return /variable/i.test(productName)
}

function ownerKey(name: string, zip: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ')
  const z = (zip || '').replace(/\D/g, '').slice(0, 5)
  return `${n}|${z}`
}

export async function parseInforceBook(buffer: Buffer): Promise<ParsedBook> {
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)
  const ws = wb.worksheets.find((w) => w.rowCount > 0) || wb.worksheets[0]
  if (!ws) throw new Error('The workbook has no worksheets.')

  // Build a full 1-based matrix (preserve column alignment).
  const matrix: string[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellStr(cell.value)
    })
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    matrix.push(cells)
  })

  // Locate the header row (the one with "Policy Number").
  let headerRow = -1
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    if (matrix[r].some((c) => c.trim().toLowerCase() === 'policy number')) {
      headerRow = r
      break
    }
  }
  if (headerRow === -1) throw new Error('Could not find the "Policy Number" header row — is this an FNWL in-force review export?')

  const headers = matrix[headerRow].map((h) => h.trim())
  const col = (name: string): number => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const c = {
    policy: col('Policy Number'),
    product: col('Product Name'),
    status: col('Policy Status'),
    face: col('Face Amount'),
    accum: col('Accumulation Value'),
    convDate: col('Conversion Date'),
    issue: col('Policy Issue Date'),
    insured: col('Insured Name'),
    ownerName: col('Owner Name'),
    ownerEmail: col('Owner Email') >= 0 ? col('Owner Email') : col('Email'),
    ownerDob: col('Owner DOB') >= 0 ? col('Owner DOB') : col('Date of Birth') >= 0 ? col('Date of Birth') : col('DOB'),
    ownerAddr: col('Owner Address'),
    ownerCity: col('Owner City'),
    ownerState: col('Owner State'),
    ownerZip: col('Owner Zip'),
    ownerPhone: col('Owner Phone Number'),
    jointName: col('Joint Owner Name'),
    jointAddr: col('Joint Owner Address'),
    jointCity: col('Joint Owner City'),
    jointState: col('Joint Owner State'),
    jointZip: col('Joint Owner ZIP'),
    jointPhone: col('Joint Owner Phone'),
    agentName: col('Serving Agent Name'),
    agentNo: col('Serving Agent Number'),
    series: col('Series Code'),
  }

  const at = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '')
  const policies: InforcePolicy[] = []
  let skipped = 0

  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r]
    const policyNumber = at(row, c.policy)
    const ownerName = at(row, c.ownerName)
    if (!policyNumber || !ownerName) {
      skipped++
      continue
    }
    const productName = at(row, c.product)
    const statusRaw = at(row, c.status)
    const ownerZip = at(row, c.ownerZip)
    const jointName = at(row, c.jointName)
    const sourceData: Record<string, string> = {}
    headers.forEach((h, i) => {
      if (h) sourceData[h] = (row[i] ?? '').trim()
    })

    policies.push({
      policy_number: policyNumber,
      product_name: productName,
      status_raw: statusRaw,
      status: mapStatus(statusRaw),
      is_security: isSecurityProduct(productName),
      face_amount: toNum(at(row, c.face)),
      accumulation_value: toNum(at(row, c.accum)),
      issue_date: toIsoDate(at(row, c.issue)),
      conversion_date: toIsoDate(at(row, c.convDate)),
      insured_name: at(row, c.insured) || null,
      owner_name: ownerName,
      owner_email: at(row, c.ownerEmail) || null,
      owner_dob: toIsoDate(at(row, c.ownerDob)) || null,
      owner_address: at(row, c.ownerAddr) || null,
      owner_city: at(row, c.ownerCity) || null,
      owner_state: at(row, c.ownerState) || null,
      owner_zip: ownerZip || null,
      owner_phone: at(row, c.ownerPhone) || null,
      joint_owner_name: jointName || null,
      joint_owner_address: at(row, c.jointAddr) || null,
      joint_owner_city: at(row, c.jointCity) || null,
      joint_owner_state: at(row, c.jointState) || null,
      joint_owner_zip: at(row, c.jointZip) || null,
      joint_owner_phone: at(row, c.jointPhone) || null,
      joint_owner_key: jointName ? ownerKey(jointName, at(row, c.jointZip)) : null,
      serving_agent_name: at(row, c.agentName) || null,
      serving_agent_no: at(row, c.agentNo) || null,
      series_code: at(row, c.series) || null,
      book_owner_key: ownerKey(ownerName, ownerZip),
      source_data: sourceData,
    })
  }

  return { headerRow, headers, policies, skipped }
}

export interface BookSummary {
  policies: number
  skipped: number
  serving_agents: number
  households: number
  securities: number
  by_status: Record<string, number>
  active: number
  term_products: number
}

export function summarizeBook(parsed: ParsedBook): BookSummary {
  const agents = new Set<string>()
  const households = new Set<string>()
  const by_status: Record<string, number> = {}
  let securities = 0
  let active = 0
  let term = 0
  for (const p of parsed.policies) {
    if (p.serving_agent_no) agents.add(p.serving_agent_no)
    households.add(p.book_owner_key)
    by_status[p.status] = (by_status[p.status] || 0) + 1
    if (p.is_security) securities++
    if (p.status === 'active') active++
    if (/term/i.test(p.product_name)) term++
  }
  return {
    policies: parsed.policies.length,
    skipped: parsed.skipped,
    serving_agents: agents.size,
    households: households.size,
    securities,
    by_status,
    active,
    term_products: term,
  }
}
