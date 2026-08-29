// src/lib/compliance/pipeline.ts
// Document extraction orchestration. This is the layer that MAY call the AI gateway: it
// chooses the extraction path (native PDF text → model-vision OCR fallback for scanned/
// low-text PDFs and images). Pure byte→text helpers live in ./extract; DB + storage stay
// in the callers.
//
// Consumed by the AI Knowledge Library upload path (src/lib/knowledge/uploads.ts). The
// RightBridge report-structuring half of this module was removed with the Compliance
// Intelligence excision; extraction itself is shared infrastructure and stays.
//
// GUARDRAILS: the vision/OCR prompt transcribes ONLY what is on the page (no summary,
// no invented field, blanks stay blank), preserves page-number markers so every fact
// keeps its source page, and low-yield extractions are flagged for human review — the
// system never treats uncertain OCR as verified fact (CLAUDE.md §2.1/§2.3).

import { runGateway, type GatewayAttachment } from '@/lib/ai/gateway'
import {
  ExtractionResult,
  densityConfidence,
  extOf,
  extractPdfText,
  extractPlainText,
  fileFamily,
  imageMediaType,
  pagesFromModelText,
} from '@/lib/compliance/extract'

/** Model used for vision/OCR + structuring (kept in one place for migration). */
export const PIPELINE_MODEL = 'claude-sonnet-5'

const OCR_SYSTEM = [
  'You are a precise document transcription engine for a financial-services compliance file.',
  'Transcribe the attached document EXACTLY as written, page by page.',
  'Rules:',
  '- Begin each page with a line "===== PAGE n =====" using the real page number.',
  '- Preserve field labels, question numbers, selected answers, entered explanations, tables, and checkbox states as text.',
  '- If a field is blank/unanswered, transcribe it as blank — do NOT fill it in or guess.',
  '- Do NOT summarize, interpret, add commentary, or invent any text that is not visible.',
  '- Output ONLY the transcription.',
].join('\n')

/**
 * Extract text from an uploaded file. Path selection:
 *   • text/markdown/csv → decode bytes directly (full confidence).
 *   • pdf → native positioned-glyph text; if that is too thin (scanned/imaged), fall
 *     back to model-vision OCR (Claude reads the pages natively) and keep whichever
 *     yields more text — flagging low_confidence when even that is sparse.
 *   • image → model-vision OCR.
 * Never throws on a readable-but-empty file; throws only for an unsupported family or
 * a hard parser failure with no fallback.
 */
export async function extractDocument(
  buffer: Buffer,
  filename: string,
  _contentType?: string | null,
): Promise<ExtractionResult> {
  const ext = extOf(filename)
  const family = fileFamily(ext)

  if (family === 'text') return extractPlainText(buffer)

  if (family === 'pdf') {
    let native: ExtractionResult | null = null
    try {
      native = await extractPdfText(buffer)
    } catch {
      native = null
    }
    if (native && !native.low_confidence) return native

    // Scanned / low-text PDF → model-vision OCR fallback.
    try {
      const vision = await extractViaVision(buffer, 'pdf', 'application/pdf')
      // Prefer whichever recovered more text.
      if (!native || vision.char_count > native.char_count) return vision
    } catch {
      /* vision unavailable (kill switch / no key) → return whatever native gave */
    }
    if (native) return native
    // Nothing worked: an empty, still-recorded result so the upload lands in needs_review.
    return { method: 'none', pages: [], page_count: 0, char_count: 0, confidence: 0, low_confidence: true }
  }

  if (family === 'image') return extractViaVision(buffer, 'image', imageMediaType(ext))

  throw new Error(`Unsupported file type: .${ext || '(none)'}`)
}

/** Run model-vision transcription over a PDF or image and split it back into pages. */
async function extractViaVision(
  buffer: Buffer,
  kind: 'pdf' | 'image',
  mediaType: string,
): Promise<ExtractionResult> {
  const attachment: GatewayAttachment = { kind, media_type: mediaType, data: buffer.toString('base64') }
  const res = await runGateway({
    system: OCR_SYSTEM,
    model: PIPELINE_MODEL,
    maxTokens: 8000,
    messages: [{ role: 'user', content: 'Transcribe the attached document now, page by page.' }],
    attachments: [attachment],
  })
  const pages = pagesFromModelText(res.text)
  const charCount = pages.reduce((s, p) => s + p.char_count, 0)
  const { confidence, low } = densityConfidence(charCount, pages.length)
  return {
    method: kind === 'pdf' ? 'claude_pdf' : 'image',
    pages,
    page_count: pages.length,
    char_count: charCount,
    // Model-vision transcription is inherently less certain than native text.
    confidence: Number(Math.min(confidence, 0.9).toFixed(3)),
    low_confidence: low || charCount === 0,
  }
}
