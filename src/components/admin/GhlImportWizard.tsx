'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload, AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel, Numeric } from '@/components/ui/typography'
import { postJson, firstFieldError } from '@/lib/client/api'

interface Counts {
  total: number
  importable: number
  duplicateInFile: number
  duplicateExisting: number
  errors: number
  noConsent: number
  truncated: boolean
}
interface PreviewResult {
  job_id: string
  token: string
  counts: Counts
  sample: { full_name: string; email: string | null; phone: string | null; consent: string[] }[]
  errors: { row: number; reason: string }[]
}

const STEPS = ['Upload', 'Preview', 'Commit'] as const

// GHL Contact Upload wizard (docs/legacy-port.md §2.6). Paste/upload CSV → preview
// exact changes → commit → rollback token. No-consent contacts are flagged and
// remain unsendable. There is no verified GHL API — this is the labeled CSV fallback.
export function GhlImportWizard() {
  const router = useRouter()
  const [step, setStep] = React.useState<0 | 1 | 2>(0)
  const [csv, setCsv] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [preview, setPreview] = React.useState<PreviewResult | null>(null)
  const [committedToken, setCommittedToken] = React.useState<string | null>(null)
  const [created, setCreated] = React.useState<{ households: number; members: number; consents: number } | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setCsv(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  async function runPreview() {
    setBusy(true)
    const res = await postJson<PreviewResult>('/api/admin/imports/ghl', { mode: 'preview', csv })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    setPreview(res.data)
    setStep(1)
  }

  async function runCommit() {
    if (!preview) return
    setBusy(true)
    const res = await postJson<{ token: string; created: { households: number; members: number; consents: number } }>(
      '/api/admin/imports/ghl',
      { mode: 'commit', job_id: preview.job_id },
    )
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    setCommittedToken(res.data.token)
    setCreated(res.data.created)
    setStep(2)
    toast.success('Import committed.')
    router.refresh()
  }

  async function runRollback() {
    if (!committedToken) return
    setBusy(true)
    const res = await postJson<{ restored: number }>('/api/admin/imports/ghl', { mode: 'rollback', token: committedToken })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Rolled back — ${res.data.restored} household(s) removed.`)
    reset()
    router.refresh()
  }

  function reset() {
    setStep(0)
    setCsv('')
    setPreview(null)
    setCommittedToken(null)
    setCreated(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import GoHighLevel contacts</CardTitle>
        <ol className="mt-2 flex flex-wrap gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={
                i === step
                  ? 'flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary'
                  : i < step
                    ? 'flex items-center gap-1.5 rounded-full border border-status-won/40 px-3 py-1 text-xs text-status-won'
                    : 'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground'
              }
            >
              <span className="font-medium">{i + 1}</span> {s}
            </li>
          ))}
        </ol>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              No verified GoHighLevel API is available, so this is the CSV fallback. Export contacts from GHL and paste or
              upload the CSV. Recognized columns: name (or first/last), email, phone, consent (email/sms/both), tags.
              Securities data is never imported.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ghl-file">Upload CSV</Label>
              <input id="ghl-file" type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ghl-csv">…or paste CSV</Label>
              <Textarea
                id="ghl-csv"
                rows={6}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder="name,email,phone,consent&#10;Jane Smith,jane@example.com,(972) 555-0100,email"
              />
            </div>
            <Button onClick={runPreview} disabled={busy || !csv.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              Preview import
            </Button>
          </>
        ) : null}

        {step === 1 && preview ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="To import" value={preview.counts.importable} />
              <Stat label="Duplicates" value={preview.counts.duplicateInFile + preview.counts.duplicateExisting} />
              <Stat label="Errors" value={preview.counts.errors} />
              <Stat label="No consent" value={preview.counts.noConsent} tone="warn" />
            </div>

            {preview.counts.noConsent > 0 ? (
              <p className="flex items-start gap-2 rounded-md border border-status-assumption/40 bg-status-assumption/10 p-3 text-xs text-status-assumption">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {preview.counts.noConsent} contact(s) have no consent — they will be imported but flagged and cannot be
                messaged until consent is captured.
              </p>
            ) : null}
            {preview.counts.truncated ? (
              <p className="text-xs text-muted-foreground">File truncated to the first 2,000 rows.</p>
            ) : null}

            {preview.sample.length > 0 ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Consent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell>{s.full_name}</TableCell>
                        <TableCell className="text-muted-foreground"><Numeric>{s.email ?? '—'}</Numeric></TableCell>
                        <TableCell>
                          {s.consent.length > 0 ? (
                            s.consent.map((c) => (
                              <Badge key={c} variant="active" className="mr-1">
                                {c}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="assumption">no consent</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {preview.errors.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">{preview.errors.length} error row(s)</summary>
                <ul className="mt-2 space-y-0.5">
                  {preview.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="flex items-center gap-2 border-t pt-4">
              <Button onClick={runCommit} disabled={busy || preview.counts.importable === 0}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Commit {preview.counts.importable} contact(s)
              </Button>
              <Button variant="outline" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        ) : null}

        {step === 2 && created ? (
          <>
            <div className="flex items-center gap-2 rounded-md border border-status-won/40 bg-status-won/10 p-4 text-sm text-status-won">
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
              <p>
                Imported {created.households} household(s), {created.members} member(s), and {created.consents} consent
                record(s).
              </p>
            </div>
            {committedToken ? (
              <div className="space-y-2">
                <MonoLabel>Rollback token</MonoLabel>
                <p className="numeric break-all rounded-md border bg-muted/40 p-2 text-xs">{committedToken}</p>
                <p className="text-xs text-muted-foreground">
                  Rolling back deletes exactly what this import created and restores the pre-import state.
                </p>
              </div>
            ) : null}
            <div className="flex items-center gap-2 border-t pt-4">
              <Button variant="destructive" onClick={runRollback} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                Roll back this import
              </Button>
              <Button variant="outline" onClick={reset} disabled={busy}>
                Start another
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'warn' && value > 0 ? 'border-status-assumption/40 bg-status-assumption/10' : ''}`}>
      <MonoLabel>{label}</MonoLabel>
      <div className="numeric mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  )
}
