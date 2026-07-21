// src/lib/compliance/extract.ts
// Server-side document extraction for the Compliance Intelligence pipeline
// (owner-authorized module; CLAUDE.md §5 authorized exception + docs/adr/ADR-012). Turns an uploaded file's BYTES into
// per-page UTF-8 text so the NIGO / RightBridge engines no longer require the user
// to copy-and-paste. Nothing here calls a model or the DB — pure, testable
// functions. The model-vision fallback (scanned PDFs) is driven by the route via
// the AI gateway; this module decides WHEN that fallback is needed.
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
import { z } from 'zod'
import { extractPdfPages, type PdfPage } from '@/lib/import/pdf'

/** Bump when the extraction algorithm changes (stored on every derived record). */
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

/** Join extracted pages into one page-marked blob so the model can cite page numbers. */
export function renderPagesWithMarkers(pages: ExtractedPage[]): string {
  return pages
    .map((p) => `===== PAGE ${p.page_number} =====\n${p.text}`)
    .join('\n\n')
}

/** Plain concatenation of page text (for engines that only need the words). */
export function joinPageText(pages: { text: string }[]): string {
  return pages
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n\n')
}

// ─── Document-kind heuristic (a hint; the model/route can override) ───────────

/** Guess the document kind from filename + a text sample (best-effort classifier). */
export function guessKind(filename: string, sampleText: string): string {
  const hay = `${filename}\n${sampleText}`.toLowerCase()
  if (/rightbridge|product profiler|life wizard|profiler score|suitability profiler/.test(hay)) return 'rightbridge'
  if (/not in good order|nigo|deficien|please provide|in order to process|correction (required|needed)/.test(hay))
    return 'nigo'
  if (/illustration|hypothetical/.test(hay)) return 'illustration'
  if (/disclosure|acknowledg/.test(hay)) return 'disclosure'
  if (/statement|account value|quarterly|annual statement/.test(hay)) return 'statement'
  if (/policy|contract|certificate of insurance/.test(hay)) return 'contract'
  if (/application|form \d|supplement|beneficiary designation/.test(hay)) return 'form'
  return 'other'
}

// ─── Structured RightBridge report schema (version-aware) ─────────────────────
// A report is NOT reduced to one text blob: it is sections → questions → answers,
// each carrying the source page + an extraction-confidence so a reviewer can inspect
// the original page beside the extracted value. The shape is deliberately generic so
// new RightBridge versions / product workflows map without a code rewrite.

export const StructuredQuestionSchema = z.object({
  number: z.string().trim().max(40).nullable().optional(),
  label: z.string().trim().max(2000),
  answer: z.string().trim().max(4000).nullable().optional(),
  explanation: z.string().trim().max(8000).nullable().optional(),
  page: z.number().int().nonnegative().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
})
export type StructuredQuestion = z.infer<typeof StructuredQuestionSchema>

export const StructuredSectionSchema = z.object({
  name: z.string().trim().max(300),
  page: z.number().int().nonnegative().nullable().optional(),
  questions: z.array(StructuredQuestionSchema).max(400).default([]),
})
export type StructuredSection = z.infer<typeof StructuredSectionSchema>

export const StructuredRightBridgeSchema = z.object({
  report_version: z.string().trim().max(120).nullable().optional(),
  sections: z.array(StructuredSectionSchema).max(80).default([]),
})
export type StructuredRightBridge = z.infer<typeof StructuredRightBridgeSchema>

/** Count questions across a structured report + how many were left blank. */
export function summarizeStructuredReport(r: StructuredRightBridge): {
  section_count: number
  question_count: number
  blank_count: number
} {
  let question_count = 0
  let blank_count = 0
  for (const s of r.sections ?? []) {
    for (const q of s.questions ?? []) {
      question_count++
      if (!q.answer || q.answer.trim() === '') blank_count++
    }
  }
  return { section_count: (r.sections ?? []).length, question_count, blank_count }
}
