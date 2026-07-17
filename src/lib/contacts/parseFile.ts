// src/lib/contacts/parseFile.ts
// Multi-format contact-file parser for the Contact Center bulk import. Normalizes
// CSV, TSV, Excel (.xlsx), and JSON into the same header-keyed table the column
// recognizer consumes. File-level validation (extension, empty, size) is enforced
// by the import route; this parser throws a friendly message on malformed content.

import { parseSpreadsheet, extensionOf } from '@/lib/spreadsheet'
import { matrixToTable } from '@/lib/csv'

export const CONTACT_FILE_EXTENSIONS = ['csv', 'tsv', 'txt', 'xlsx', 'json', 'pdf'] as const
export type ContactFileExt = (typeof CONTACT_FILE_EXTENSIONS)[number]

export interface ParsedContactTable {
  headers: string[]
  rows: Array<Record<string, string>>
  kind: string
}

function parseDelimited(text: string, delim: string): ParsedContactTable {
  const matrix = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(delim).map((c) => c.trim()))
  const t = matrixToTable(matrix)
  return { headers: t.headers, rows: t.rows, kind: 'tsv' }
}

function parseJson(text: string): ParsedContactTable {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The .json file is not valid JSON.')
  }
  // Accept either a bare array of objects or { contacts: [...] } / { data: [...] }.
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (((data as Record<string, unknown>).contacts ?? (data as Record<string, unknown>).data) as unknown)
      : null
  if (!Array.isArray(arr)) {
    throw new Error('The JSON must be an array of contact objects (or {"contacts": [...]}).')
  }
  const objects = arr.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
  const headerSet = new Set<string>()
  for (const o of objects) for (const k of Object.keys(o)) headerSet.add(k)
  const headers = Array.from(headerSet)
  const rows = objects.map((o) => {
    const row: Record<string, string> = {}
    for (const h of headers) {
      const v = o[h]
      row[h] = v == null ? '' : String(v)
    }
    return row
  })
  return { headers, rows, kind: 'json' }
}

export async function parseContactsFile(buffer: Buffer, filename: string): Promise<ParsedContactTable> {
  const ext = extensionOf(filename)
  if (ext === 'json') return parseJson(buffer.toString('utf8'))
  if (ext === 'pdf') {
    // Positioned-text table reconstruction (Farmers/Salesforce printable views).
    const { parsePdfFile } = await import('@/lib/import/pdf')
    return parsePdfFile(buffer)
  }
  if (ext === 'tsv' || ext === 'txt') return parseDelimited(buffer.toString('utf8'), '\t')
  // csv, xlsx, and extensionless fall through to the spreadsheet parser.
  const t = await parseSpreadsheet(buffer, filename)
  return { headers: t.headers, rows: t.rows, kind: t.kind }
}
