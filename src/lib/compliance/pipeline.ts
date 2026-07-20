// src/lib/compliance/pipeline.ts
// Orchestration for the Compliance Intelligence document pipeline (owner-authorized
// module; CLAUDE.md §3). This is the layer that MAY call the AI gateway: it chooses
// the extraction path (native PDF text → model-vision OCR fallback for scanned/low-
// text PDFs and images) and builds the version-aware structured RightBridge report.
// Pure byte→text helpers live in ./extract; DB + storage stay in the route handlers.
//
// GUARDRAILS: the vision/OCR prompt transcribes ONLY what is on the page (no summary,
// no invented field, blanks stay blank), preserves page-number markers so every fact
// keeps its source page, and low-yield extractions are flagged for human review — the
// system never treats uncertain OCR as verified fact (CLAUDE.md §2.1/§2.3).

import { runGateway, type GatewayAttachment } from '@/lib/ai/gateway'
import { runJson } from '@/lib/compliance/intelligence'
import {
  ExtractionResult,
  StructuredRightBridge,
  StructuredRightBridgeSchema,
  densityConfidence,
  extOf,
  extractPdfText,
  extractPlainText,
  fileFamily,
  imageMediaType,
  pagesFromModelText,
  renderPagesWithMarkers,
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

const STRUCTURE_SYSTEM = [
  'You convert an extracted RightBridge suitability report into a STRUCTURED representation.',
  'Work ONLY from the provided report text. Never invent a section, question, answer, or page number.',
  'For each answer, copy the value exactly as written; if a field is blank, set answer to null (do NOT guess).',
  'Use the "===== PAGE n =====" markers in the text to set each item\'s page number.',
  'Give each item a confidence in [0,1] reflecting how clearly the value was stated in the text.',
  'Output ONLY the requested JSON object. No prose, no markdown fences.',
].join(' ')

/**
 * Build the version-aware structured report (sections → questions → answers, each
 * with a source page + confidence) from extracted page text. Returns a schema-valid
 * object or null if the model could not produce one. Grounded strictly in the text
 * passed in — no field is fabricated.
 */
export async function structureRightBridge(
  pages: { page_number: number; text: string }[],
): Promise<StructuredRightBridge | null> {
  const marked = renderPagesWithMarkers(
    pages.map((p) => ({ page_number: p.page_number, text: p.text, char_count: p.text.length, low_confidence: false })),
  )
  if (!marked.trim()) return null

  const user = [
    'Structure this RightBridge report. Preserve section names, question numbers, labels, selected answers, entered explanations, and the page each appears on.',
    '',
    'REPORT TEXT (page-marked):',
    `"""${marked.slice(0, 120_000)}"""`,
    '',
    'Return ONLY this JSON:',
    '{',
    '  "report_version": "the report version/name if stated, else null",',
    '  "sections": [',
    '    { "name": "section name", "page": 1, "questions": [',
    '      { "number": "1a or null", "label": "question/field label", "answer": "value exactly as written or null if blank", "explanation": "entered free-text or null", "page": 1, "confidence": 0.0 }',
    '    ] }',
    '  ]',
    '}',
  ].join('\n')

  const out = await runJson<unknown>(STRUCTURE_SYSTEM, user, 4000)
  if (!out) return null
  const parsed = StructuredRightBridgeSchema.safeParse(out)
  return parsed.success ? parsed.data : null
}
