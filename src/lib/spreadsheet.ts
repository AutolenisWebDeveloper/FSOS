// src/lib/spreadsheet.ts
// ─────────────────────────────────────────────────────────────────────────
// Unified spreadsheet loader for the contact-upload workflow. Accepts a CSV
// or a modern Excel workbook (.xlsx) and returns the same header-keyed table
// shape, so the mapping / validation / import pipeline is format-agnostic.
//
// Legacy .xls (BIFF) is intentionally not supported by the Excel reader; the
// route rejects it with guidance to re-save as .xlsx or .csv.
// ─────────────────────────────────────────────────────────────────────────

import ExcelJS from 'exceljs'
import { parseCsvRecords, matrixToTable, type CsvTable } from './csv'

export type SpreadsheetKind = 'csv' | 'xlsx'

export interface SpreadsheetTable extends CsvTable {
  kind: SpreadsheetKind
  sheetName?: string
}

/** File extensions this loader can read. */
export const SUPPORTED_EXTENSIONS = ['csv', 'xlsx'] as const

export function extensionOf(filename: string): string {
  return (filename.split('.').pop() || '').toLowerCase()
}

/** Coerce any ExcelJS cell value (string, number, date, formula, rich text, hyperlink) to text. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.text === 'string') return v.text // hyperlink cell { text, hyperlink }
    if (Array.isArray(v.richText)) return v.richText.map((r) => (r as { text?: string }).text || '').join('')
    if ('result' in v) return cellToString(v.result) // formula cell → its computed result
    if ('error' in v) return '' // #REF! etc.
    if (typeof v.hyperlink === 'string') return v.hyperlink
  }
  return String(value)
}

/**
 * Read an .xlsx workbook (first non-empty worksheet) into a cell matrix,
 * then fold it into the shared header-keyed table shape.
 */
async function parseXlsx(buffer: Buffer): Promise<SpreadsheetTable> {
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)

  const ws = wb.worksheets.find((w) => w.rowCount > 0) || wb.worksheets[0]
  if (!ws) return { kind: 'xlsx', headers: [], rows: [] }

  const matrix: string[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    // colNumber is 1-based; fill gaps so column alignment is preserved.
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cellToString(cell.value)
    })
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    matrix.push(cells)
  })

  // Drop fully-blank leading/trailing rows so the header lands on row 0.
  const trimmed = matrix.filter((r) => r.some((c) => (c ?? '').trim() !== ''))
  return { ...matrixToTable(trimmed), kind: 'xlsx', sheetName: ws.name }
}

/**
 * Parse an uploaded spreadsheet buffer into a header-keyed table. Throws a
 * typed-message Error for unsupported types so the route can surface guidance.
 */
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<SpreadsheetTable> {
  const ext = extensionOf(filename)
  if (ext === 'csv' || ext === '') {
    return { ...parseCsvRecords(buffer.toString('utf8')), kind: 'csv' }
  }
  if (ext === 'xlsx') {
    return parseXlsx(buffer)
  }
  if (ext === 'xls') {
    throw new Error('Legacy .xls files are not supported. Re-save the file as .xlsx or .csv and upload again.')
  }
  throw new Error(`Unsupported file type .${ext}. Upload a .csv or .xlsx file.`)
}
