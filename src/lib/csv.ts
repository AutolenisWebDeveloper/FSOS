// src/lib/csv.ts
// ─────────────────────────────────────────────────────────────────────────
// Dependency-free CSV parser (RFC 4180). Handles quoted fields, embedded
// commas / newlines / escaped quotes ("" → "), CRLF or LF line endings, and a
// leading UTF-8 BOM. Used by the GoHighLevel contact-upload workflow so the
// platform never pulls a heavyweight CSV dependency into the serverless bundle.
// ─────────────────────────────────────────────────────────────────────────

/** Parse raw CSV text into a matrix of string cells. Blank trailing line ignored. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input // strip BOM
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      // swallow CRLF as one break
      if (text[i + 1] === '\n') i++
      pushRow()
      i++
      continue
    }
    if (ch === '\n') {
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }

  // flush final field/row unless the input ended exactly on a newline
  if (field.length > 0 || row.length > 0) pushRow()

  // Drop rows that are entirely empty (e.g. a trailing blank line).
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export interface CsvTable {
  headers: string[]
  rows: Array<Record<string, string>>
}

/**
 * Parse CSV into header-keyed records. Header cells are trimmed; duplicate
 * headers get a numeric suffix so no column is silently lost.
 */
export function parseCsvRecords(input: string): CsvTable {
  const matrix = parseCsv(input)
  if (matrix.length === 0) return { headers: [], rows: [] }

  const seen = new Map<string, number>()
  const headers = matrix[0].map((h) => {
    const base = h.trim()
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}_${n}`
  })

  const rows = matrix.slice(1).map((cells) => {
    const rec: Record<string, string> = {}
    headers.forEach((h, idx) => {
      rec[h] = (cells[idx] ?? '').trim()
    })
    return rec
  })

  return { headers, rows }
}
