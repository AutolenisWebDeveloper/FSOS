// src/lib/import/xlsxRaw.ts
// A minimal, namespace-tolerant .xlsx reader used as a fallback when ExcelJS
// cannot parse a workbook. Some tools (e.g. certain Salesforce "cleaned" exports)
// write the SpreadsheetML with a namespace prefix — `<x:workbook>`, `<x:sheet>` —
// which ExcelJS's parser rejects. This reader strips prefixes and pulls cell
// values straight from the zip, converting Excel date serials to ISO dates.
//
// Scope: reads the first worksheet into a string matrix (row-major, column order
// preserved). Handles inline/shared strings, plain numbers, and date-formatted
// numbers. It is deliberately small — not a general xlsx engine.

import JSZip from 'jszip'

// Namespace-tolerant tag matchers (ignore any `prefix:` on the element name).
const reBetween = (tag: string) => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'g')

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

function colToIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64)
  return n - 1
}

// Excel 1900-system serial → ISO date (accounts for the 1900 leap-year bug via
// the 25569-day offset between serial 1 and the Unix epoch).
function serialToIso(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000)
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? String(n) : d.toISOString().slice(0, 10)
}

// Builtin numFmtIds that represent dates/times, plus any custom code with y/m/d.
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57, 58])

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  const out: string[] = []
  const si = reBetween('si')
  let m: RegExpExecArray | null
  while ((m = si.exec(xml))) {
    const t = reBetween('t')
    let s = ''
    let tm: RegExpExecArray | null
    while ((tm = t.exec(m[1]))) s += tm[1]
    out.push(xmlUnescape(s))
  }
  return out
}

// Map style index (s="…") → whether that style is a date format.
function parseDateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return []
  const dateFmtIds = new Set<number>(BUILTIN_DATE_IDS)
  const numFmt = /<(?:\w+:)?numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g
  let nm: RegExpExecArray | null
  while ((nm = numFmt.exec(stylesXml))) {
    const code = xmlUnescape(nm[2]).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')
    if (/[ymd]/i.test(code)) dateFmtIds.add(Number(nm[1]))
  }
  const cellXfsBlock = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml)
  const styleIsDate: boolean[] = []
  if (cellXfsBlock) {
    const xf = /<(?:\w+:)?xf\b([^>]*)\/?>/g
    let xm: RegExpExecArray | null
    while ((xm = xf.exec(cellXfsBlock[1]))) {
      const idMatch = /\bnumFmtId="(\d+)"/.exec(xm[1])
      styleIsDate.push(idMatch ? dateFmtIds.has(Number(idMatch[1])) : false)
    }
  }
  return styleIsDate
}

export async function xlsxToMatrix(buffer: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer)
  const get = async (path: string) => {
    const f = zip.file(path)
    return f ? await f.async('string') : undefined
  }
  const shared = parseSharedStrings(await get('xl/sharedStrings.xml'))
  const styleIsDate = parseDateStyles(await get('xl/styles.xml'))

  // First worksheet (by path order).
  const sheetPath = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort()[0]
  if (!sheetPath) throw new Error('No worksheet found in the workbook.')
  const sheetXml = (await get(sheetPath)) || ''

  const matrix: string[][] = []
  const rowRe = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g
  const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g
  let rowM: RegExpExecArray | null
  while ((rowM = rowRe.exec(sheetXml))) {
    const cells: string[] = []
    let cellM: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((cellM = cellRe.exec(rowM[1]))) {
      const attrs = cellM[1]
      const inner = cellM[2] || ''
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
      if (!ref) continue
      const t = /\bt="([^"]*)"/.exec(attrs)?.[1]
      const s = /\bs="(\d+)"/.exec(attrs)?.[1]
      let value = ''
      if (t === 'inlineStr') {
        const tRe = reBetween('t')
        let tm: RegExpExecArray | null
        while ((tm = tRe.exec(inner))) value += tm[1]
        value = xmlUnescape(value)
      } else {
        const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1]
        if (v != null) {
          if (t === 's') value = shared[Number(v)] ?? ''
          else if (t === 'str' || t === 'e') value = xmlUnescape(v)
          else {
            // numeric — a date if its style says so, else the raw number.
            const isDate = s != null && styleIsDate[Number(s)]
            value = isDate ? serialToIso(Number(v)) : xmlUnescape(v)
          }
        }
      }
      cells[colToIndex(ref)] = value
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    matrix.push(cells)
  }
  return matrix
}
