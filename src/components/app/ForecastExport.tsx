'use client'

import * as React from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export interface ForecastCsvRow {
  section: string
  label: string
  value: number
}

// A11 export — build a CSV client-side from the already-derived forecast rows and
// trigger a download. No server round-trip; the data shown is the data exported.
export function ForecastExport({ rows }: { rows: ForecastCsvRow[] }) {
  function exportCsv() {
    try {
      const header = 'section,label,value'
      const lines = rows.map((r) => {
        const label = /[",\n]/.test(r.label) ? `"${r.label.replace(/"/g, '""')}"` : r.label
        return `${r.section},${label},${r.value}`
      })
      const csv = [header, ...lines].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'forecast.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed.')
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
      <Download className="h-4 w-4" /> Export CSV
    </Button>
  )
}
