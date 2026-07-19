// src/lib/import/pdf.ts
// PDF import support for the file-based importers (Contacts, Cross-Sell, District
// Book). Farmers/Salesforce "printable view" exports are tabular PDFs whose rows
// wrap across several physical text lines, so a naive text dump scrambles the
// columns. This module reconstructs the table from positioned text:
//
//   1. extract every glyph run with its (x, y, advance) via pdf2json (pure JS —
//      safe in the Node serverless runtime, no native deps / no worker);
//   2. locate the header row and segment it at the GLYPH level against a set of
//      known column labels, so adjacent headers ("…Phone" / "…Email") are split
//      into separate columns even when a whitespace heuristic can't tell them
//      apart;
//   3. auto-derive the per-record anchor (the value the right-most column repeats
//      once per record, e.g. a "Confidential" classification) and group each
//      record's wrapped lines between anchors;
//   4. emit the same header-keyed table (ParsedContactTable) the CSV/XLSX path
//      produces, so mapping / validation / dedupe are all format-agnostic.
//
// If no header/anchor can be found it falls back to one-record-per-line so a
// simple tabular PDF still imports. Nothing here is securities data.

import type { ParsedContactTable } from '@/lib/contacts/parseFile'

interface Glyph { x: number; y: number; end: number; s: string }
export interface PdfPage { width: number; height: number; glyphs: Glyph[] }

// pdf2json reports each glyph's advance width in text units; grid position
// advances by width/GRID. Only used to estimate a glyph's right edge for spacing.
const GRID = 30

// Column labels we recognize across the Farmers/Salesforce exports (squashed to
// letters, longest matched first). Used only to LOCATE and name columns — never
// to gate which files import.
const LABELS = [
  'preferredhouseholdphone', 'preferredhouseholdemail', 'securityclassification', 'accountname',
  'activelob', 'policynumber', 'firstname', 'lastname', 'fullname', 'classification', 'address',
  'street', 'state', 'city', 'zip', 'phone', 'email', 'product', 'owner', 'agent', 'name', 'lob',
].sort((a, b) => b.length - a.length)

// How the detected label maps into a header the downstream recognizers accept.
const LABEL_HEADER: Record<string, string> = {
  accountname: 'Account Name', fullname: 'Full Name', firstname: 'First Name', lastname: 'Last Name',
  activelob: 'Active LOB', lob: 'Active LOB', street: 'Street', address: 'Street', city: 'City',
  state: 'State', zip: 'Zip', preferredhouseholdphone: 'Preferred Household Phone', phone: 'Preferred Household Phone',
  preferredhouseholdemail: 'Preferred Household Email', email: 'Preferred Household Email',
  securityclassification: 'Security Classification', classification: 'Security Classification',
  policynumber: 'Policy Number', product: 'Product', owner: 'Owner', agent: 'Agent', name: 'Account Name',
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Stray page furniture (footer URL, copyright, page numbers) that can fall inside
// a record band and must never be merged into a cell.
const FURNITURE = /^https?:|salesforce\.com|Copyright|©|rights reserved|rpp_sticky|rowsperpage|fcf=|^\d{1,2}\/\d{1,2}$|^00BK/i

/** Extract positioned glyph runs from every page of a PDF. */
export async function extractPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  // Dynamic import keeps pdf2json out of the edge/client bundle; this route is nodejs.
  const mod = await import('pdf2json')
  const PDFParser = (mod.default ?? mod) as unknown as new () => PdfParserLike
  const parser = new PDFParser()
  return await new Promise<PdfPage[]>((resolve, reject) => {
    parser.on('pdfParser_dataError', (e: { parserError?: Error }) => reject(e?.parserError ?? new Error('PDF parse failed')))
    parser.on('pdfParser_dataReady', (data: PdfData) => {
      try {
        resolve((data.Pages || []).map((pg) => ({
          width: pg.Width,
          height: pg.Height,
          glyphs: (pg.Texts || [])
            .map((t) => {
              const s = decodeRuns(t.R)
              return { x: t.x, y: t.y, end: t.x + (t.w || 0) / GRID, s }
            })
            .filter((g) => g.s.trim() !== ''),
        })))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    parser.parseBuffer(buffer)
  })
}

function decodeRuns(R: Array<{ T: string }>): string {
  try {
    return R.map((r) => decodeURIComponent(r.T)).join('')
  } catch {
    return R.map((r) => r.T).join('')
  }
}

interface Column { header: string; label: string; x0: number; x1: number }

// Cluster glyphs into text lines by y (rounded), each left-to-right.
function groupByLine(glyphs: Glyph[]): Glyph[][] {
  const map = new Map<string, Glyph[]>()
  for (const g of glyphs) {
    const key = g.y.toFixed(2)
    const arr = map.get(key)
    if (arr) arr.push(g)
    else map.set(key, [g])
  }
  return Array.from(map.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, arr]) => arr.sort((a, b) => a.x - b.x))
}

// Segment one text line at the glyph level into (x, label) column starts by
// matching known labels as non-overlapping substrings of the squashed line.
function segmentHeaderLine(line: Glyph[]): Array<{ x: number; label: string }> {
  let str = ''
  const xs: number[] = []
  for (const g of line.slice().sort((a, b) => a.x - b.x)) {
    const sq = squash(g.s)
    for (let k = 0; k < sq.length; k++) { str += sq[k]; xs.push(g.x) }
  }
  const cols: Array<{ x: number; label: string }> = []
  let i = 0
  while (i < str.length) {
    const lab = LABELS.find((l) => str.startsWith(l, i))
    if (lab) { cols.push({ x: xs[i], label: lab }); i += lab.length }
    else i++
  }
  return cols
}

// Find the header row (line whose segmentation yields the most columns) and turn
// its column starts into ordered x-bands. Null when < 3 columns are found.
function detectColumns(page: PdfPage): Column[] | null {
  let best: Array<{ x: number; label: string }> = []
  for (const line of groupByLine(page.glyphs)) {
    const cols = segmentHeaderLine(line)
    if (cols.length > best.length) best = cols
  }
  if (best.length < 3) return null
  best.sort((a, b) => a.x - b.x)
  // Values left-align under their header and extend rightward toward the next
  // column, so a band runs from just left of its header to just left of the
  // next header — NOT the midpoint, which would clip long values (zips, streets).
  const PAD = 0.3
  return best.map((c, i) => ({
    header: LABEL_HEADER[c.label] ?? c.label,
    label: c.label,
    x0: i === 0 ? -Infinity : c.x - PAD,
    x1: i === best.length - 1 ? Infinity : best[i + 1].x - PAD,
  }))
}

function colOf(cols: Column[], x: number): number {
  for (let i = 0; i < cols.length; i++) if (x >= cols[i].x0 && x < cols[i].x1) return i
  return -1
}

// Join glyphs of one cell into text: sorted top-to-bottom then left-to-right, a
// space inserted between glyphs separated by a real gap or a line break.
function joinCell(glyphs: Glyph[]): string {
  const sorted = glyphs.slice().sort((a, b) => (Math.abs(a.y - b.y) > 0.12 ? a.y - b.y : a.x - b.x))
  let out = ''
  let prev: Glyph | null = null
  for (const g of sorted) {
    if (prev) {
      const sameLine = Math.abs(g.y - prev.y) <= 0.12
      if (!sameLine || g.x - prev.end > 0.12) out += ' '
    }
    out += g.s
    prev = g
  }
  return out.replace(/\s+/g, ' ').trim()
}

// Auto-derive the record anchor: the first token the right-most column repeats
// once per record (e.g. "Confidential"). Null if none dominates.
function detectAnchorWord(pages: PdfPage[], cols: Column[]): string | null {
  const last = cols.length - 1
  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const line of groupByLine(page.glyphs)) {
      const cell = joinCell(line.filter((g) => colOf(cols, g.x) === last))
      const first = cell.split(/\s+/)[0]
      if (first && first.length >= 4 && /^[A-Za-z]/.test(first)) counts.set(first, (counts.get(first) || 0) + 1)
    }
  }
  let word: string | null = null
  let n = 0
  for (const [w, c] of Array.from(counts.entries())) if (c > n) { word = w; n = c }
  return n >= 3 ? word : null
}

/**
 * Reconstruct a Farmers/Salesforce printable-view PDF into a header-keyed table.
 * Falls back to one-record-per-line when the layout can't be detected.
 */
export function pdfPagesToTable(pages: PdfPage[]): ParsedContactTable {
  const cols = pages.length ? detectColumns(pages[0]) : null
  if (!cols) return lineFallback(pages)
  const anchorWord = detectAnchorWord(pages, cols)
  const last = cols.length - 1
  const rows: Array<Record<string, string>> = []

  for (const page of pages) {
    const lines = groupByLine(page.glyphs)
    const anchors: number[] = []
    for (const line of lines) {
      const cell = joinCell(line.filter((g) => colOf(cols, g.x) === last))
      if (anchorWord ? cell.startsWith(anchorWord) : cell.length > 0) anchors.push(line[0].y)
    }
    if (!anchors.length) continue

    const gaps = anchors.slice(1).map((y, i) => y - anchors[i]).sort((a, b) => a - b)
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1.2
    const first = anchors[0]
    const lastY = anchors[anchors.length - 1]
    const bounds = anchors.map((y, i): [number, number] => [
      i === 0 ? first - 0.35 : (anchors[i - 1] + y) / 2,
      i === anchors.length - 1 ? lastY + 0.9 * gap : (y + anchors[i + 1]) / 2,
    ])
    const buckets: Glyph[][][] = anchors.map(() => cols.map(() => []))
    for (const g of page.glyphs) {
      if (g.y < first - 0.35 || g.y > lastY + 0.9 * gap) continue // page title / footer
      if (FURNITURE.test(g.s.trim())) continue
      const ci = colOf(cols, g.x)
      if (ci < 0) continue
      for (let i = 0; i < bounds.length; i++) {
        if (g.y >= bounds[i][0] && g.y < bounds[i][1]) { buckets[i][ci].push(g); break }
      }
    }
    for (const rec of buckets) {
      const row: Record<string, string> = {}
      cols.forEach((c, ci) => { row[c.header] = joinCell(rec[ci]) })
      rows.push(row)
    }
  }

  return { headers: cols.map((c) => c.header), rows, kind: 'pdf' }
}

// No detectable header: treat each text line as a record row.
function lineFallback(pages: PdfPage[]): ParsedContactTable {
  const rows: Array<Record<string, string>> = []
  for (const page of pages) {
    for (const line of groupByLine(page.glyphs)) {
      const cells = line.map((g) => g.s.trim()).filter(Boolean)
      if (!cells.length) continue
      const row: Record<string, string> = {}
      cells.forEach((c, i) => { row[`col${i + 1}`] = c })
      rows.push(row)
    }
  }
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  return { headers, rows, kind: 'pdf' }
}

export async function parsePdfFile(buffer: Buffer): Promise<ParsedContactTable> {
  const pages = await extractPdfPages(buffer)
  if (!pages.length) throw new Error('The PDF has no readable pages.')
  return pdfPagesToTable(pages)
}

// ── pdf2json shapes (minimal) ────────────────────────────────────────────────
interface PdfText { x: number; y: number; w: number; R: Array<{ T: string }> }
interface PdfPageRaw { Width: number; Height: number; Texts: PdfText[] }
interface PdfData { Pages: PdfPageRaw[] }
interface PdfParserLike {
  on(event: 'pdfParser_dataError', cb: (e: { parserError?: Error }) => void): void
  on(event: 'pdfParser_dataReady', cb: (data: PdfData) => void): void
  parseBuffer(buffer: Buffer): void
}
