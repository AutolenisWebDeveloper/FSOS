'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, FileDown, Table } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// Report actions (build instruction §7). Approve makes the current version
// client-presentable (§4); once approved, the PDF and Excel exports unlock.
// Downloads are plain links to the export routes (auth enforced server-side).
export function ReportActions({ planId, approved }: { planId: string; approved: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function onApprove() {
    setBusy(true)
    const res = await postJson<{ version_no?: number }>(`/api/fna/plans/${planId}/approve`, {})
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Approved version ${res.data.version_no ?? ''} — now presentable to a client.`)
    router.refresh()
  }

  if (!approved) {
    return (
      <Button onClick={onApprove} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
        {busy ? 'Approving…' : 'Approve for client'}
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild>
        <a href={`/api/fna/plans/${planId}/report/pdf`}>
          <FileDown className="h-4 w-4" aria-hidden /> Download PDF
        </a>
      </Button>
      <Button asChild variant="outline">
        <a href={`/api/fna/plans/${planId}/report/xlsx`}>
          <Table className="h-4 w-4" aria-hidden /> Download Excel
        </a>
      </Button>
    </div>
  )
}
