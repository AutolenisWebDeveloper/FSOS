// src/lib/spreadsheet.ts
// ─────────────────────────────────────────────────────────────────────────
// Unified spreadsheet loader for the contact-upload workflow. Accepts a CSV
// or a modern Excel workbook (.xlsx) and returns the same header-keyed table
// shape, so the mapping / validation / import pipeline is format-agnostic.
//
// Legacy .xls (BIFF) is intentionally not supported by the Excel reader; the
// route rejects it with guidance to re-save as .xlsx or .csv.
// ─────────────────────────────────────────────────────────────────────────

import { xlsxToMatrix } from './import/xlsxRaw'
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

/**
 * Read an .xlsx workbook (first non-empty worksheet) into a cell matrix,
 * then fold it into the shared header-keyed table shape.
 */
async function parseXlsx(buffer: Buffer): Promise<SpreadsheetTable> {
  const matrix = await xlsxToMatrix(buffer)
  // Drop fully-blank leading/trailing rows so the header lands on row 0.
  const trimmed = matrix.filter((r) => r.some((c) => (c ?? '').trim() !== ''))
  return { ...matrixToTable(trimmed), kind: 'xlsx' }
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
