// src/lib/compliance/extract.ts
// Server-side document extraction. Turns an uploaded file's BYTES into per-page UTF-8
// text so a caller never has to ask the user to copy-and-paste. Nothing here calls a
// model or the DB — pure, testable functions. The model-vision fallback (scanned PDFs)
// is driven by ./pipeline via the AI gateway; this module decides WHEN that fallback
// is needed.
//
// Consumed by the AI Knowledge Library upload path (src/lib/knowledge/uploads.ts and
// src/app/api/knowledge/upload). The RightBridge structured-report half of this module
// was removed with the Compliance Intelligence excision; extraction itself is shared
// infrastructure and stays.
//
// GUARDRAILS honored here:
//   • Preserve page numbers — every page's text is captured with its 1-based number
//     so a downstream fact can always be traced back to its source page.
//   • Never treat uncertain extraction as verified — a low-yield native extraction
//     is flagged low_confidence so the route routes it to model-vision / human review
//     rather than silently trusting a near-empty page dump.
//   • No invention — this module only reports what the bytes contain; it never fills
//     in a field it could not read.

import { createHash } from 'node:crypto'
import { extractPdfPages, type PdfPage } from '@/lib/import/pdf'

/**
 * Bump when the extraction algorithm changes.
 *
 * RETAINED DELIBERATELY (Compliance Intelligence excision, Phase B): this value was
 * stamped into `compliance_uploads.parser_version` and `rightbridge_reports.parser_version`,
 * and those rows are retained under the owner's retain-in-place decision. No code writes
 * or reads those columns any more, so this constant has no live caller — but it is the
 * only in-repo record of what the persisted `parser_version` strings mean. Removing it
 * would leave retained data uninterpretable. See docs/adr/ADR-040.
 */
export const PARSER_VERSION = 'fsos-doc-extract-1'

// ─── Format support ───────────────────────────────────────────────────────────

/** Max upload size accepted by the pipeline (large multi-page RightBridge PDFs). */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024 // 30 MB

/** Extensions the pipeline can secure + extract. */
export const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'txt',
  'md',
  'csv',
  'text',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
])

export type ExtractionMethod = 'native_pdf' | 'claude_pdf' | 'text' | 'image' | 'none'

/** Coarse family used to pick an extraction path. */
export function fileFamily(ext: string): 'pdf' | 'text' | 'image' | 'unsupported' {
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'pdf'
  if (e === 'txt' || e === 'md' || e === 'csv' || e === 'text') return 'text'
  if (e === 'png' || e === 'jpg' || e === 'jpeg' || e === 'webp' || e === 'gif') return 'image'
  return 'unsupported'
}

/** Lowercased extension of a filename (without the dot); '' when none. */
export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase()
}

/** MIME type for an image extension (for the model-vision content block). */
export function imageMediaType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/jpeg'
  }
}

// ─── Identity / dedup ─────────────────────────────────────────────────────────

/** SHA-256 hex of the raw bytes — the duplicate-detection key. */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

// ─── Extraction result shape ──────────────────────────────────────────────────

export interface ExtractedPage {
  page_number: number
  text: string
  char_count: number
  low_confidence: boolean
}

export interface ExtractionResult {
  method: ExtractionMethod
  pages: ExtractedPage[]
  page_count: number
  char_count: number
  /** 0..1 heuristic confidence in the extracted text. */
  confidence: number
  /** True when the extraction is too thin to trust without model-vision / human review. */
  low_confidence: boolean
}

// A native PDF page with fewer than this many characters is likely scanned/imaged
// rather than digitally-generated text → flag it for the model-vision fallback.
const MIN_CHARS_PER_PAGE = 80
// Chars-per-page at/above which we treat native extraction as fully confident.
const CHARS_PER_PAGE_FULL = 400

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Confidence from character density; low_confidence when pages are near-empty. */
export function densityConfidence(charCount: number, pageCount: number): { confidence: number; low: boolean } {
  const pages = Math.max(pageCount, 1)
  const perPage = charCount / pages
  const confidence = clamp(perPage / CHARS_PER_PAGE_FULL, 0.15, 0.99)
  return { confidence: Number(confidence.toFixed(3)), low: perPage < MIN_CHARS_PER_PAGE }
}

// ─── Native PDF text reconstruction (positioned glyphs → reading order) ───────

/**
 * Reconstruct a single PDF page's text from its positioned glyph runs: cluster by
 * line (rounded y), order each line left-to-right, insert a space at real gaps, and
 * separate lines with newlines. Mirrors the join heuristic in lib/import/pdf.ts but
 * for the WHOLE page (that module reconstructs table cells; here we want prose).
 */
export function reconstructPageText(page: PdfPage): string {
  const byLine = new Map<string, PdfPage['glyphs']>()
  for (const g of page.glyphs) {
    const key = g.y.toFixed(2)
    const arr = byLine.get(key)
    if (arr) arr.push(g)
    else byLine.set(key, [g])
  }
  const lines = Array.from(byLine.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, arr]) => {
      const sorted = arr.slice().sort((a, b) => a.x - b.x)
      let out = ''
      let prev: (typeof sorted)[number] | null = null
      for (const g of sorted) {
        if (prev && g.x - prev.end > 0.12) out += ' '
        out += g.s
        prev = g
      }
      return out.replace(/[ \t]+/g, ' ').trim()
    })
    .filter(Boolean)
  return lines.join('\n')
}

/**
 * Extract per-page text from a PDF using the pure-JS positioned-glyph parser. Returns
 * every page (even near-empty ones) with a page-level low_confidence flag, plus an
 * overall confidence. A whole-document low_confidence signals the caller to fall back
 * to model-vision extraction (the OCR path) for scanned/image PDFs.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractionResult> {
  const rawPages = await extractPdfPages(buffer)
  const pages: ExtractedPage[] = rawPages.map((p, i) => {
    const text = reconstructPageText(p)
    return {
      page_number: i + 1,
      text,
      char_count: text.length,
      low_confidence: text.length < MIN_CHARS_PER_PAGE,
    }
  })
  const charCount = pages.reduce((sum, p) => sum + p.char_count, 0)
  const { confidence, low } = densityConfidence(charCount, pages.length)
  return {
    method: 'native_pdf',
    pages,
    page_count: pages.length,
    char_count: charCount,
    confidence,
    low_confidence: low || pages.length === 0,
  }
}

/** Extract text from a plain-text / markdown / CSV file (single logical page). */
export function extractPlainText(buffer: Buffer): ExtractionResult {
  const text = buffer.toString('utf8').replace(/\r\n/g, '\n')
  return {
    method: 'text',
    pages: [{ page_number: 1, text, char_count: text.length, low_confidence: text.length === 0 }],
    page_count: 1,
    char_count: text.length,
    confidence: text.length > 0 ? 0.99 : 0,
    low_confidence: text.length === 0,
  }
}

/** Split a model-vision plain-text extraction (page-marked) back into pages. */
export function pagesFromModelText(fullText: string): ExtractedPage[] {
  const clean = (fullText || '').replace(/\r\n/g, '\n')
  // The model is asked to delimit pages with a "===== PAGE n =====" marker.
  const parts = clean.split(/\n?=+\s*PAGE\s+(\d+)\s*=+\n?/i)
  if (parts.length <= 1) {
    const text = clean.trim()
    return [{ page_number: 1, text, char_count: text.length, low_confidence: text.length === 0 }]
  }
  const pages: ExtractedPage[] = []
  // parts = [pre, "1", body1, "2", body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const pageNumber = Number(parts[i]) || pages.length + 1
    const text = (parts[i + 1] ?? '').trim()
    pages.push({ page_number: pageNumber, text, char_count: text.length, low_confidence: text.length === 0 })
  }
  return pages.length ? pages : [{ page_number: 1, text: clean.trim(), char_count: clean.length, low_confidence: false }]
}

// ─── Page rendering for retrieval / model context ─────────────────────────────

/** Plain concatenation of page text (for engines that only need the words). */
export function joinPageText(pages: { text: string }[]): string {
  return pages
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n\n')
}
