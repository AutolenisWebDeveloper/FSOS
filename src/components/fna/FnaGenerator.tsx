'use client'

import * as React from 'react'
import { AlertTriangle, FileSignature, ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SecuritiesBanner } from '@/components/ui/securities'
import { postJson, firstFieldError } from '@/lib/client/api'
import { FNA_DISCLAIMER, type FnaReport } from '@/lib/fna/screen'

interface HouseholdOption {
  id: string
  primary_name: string
}

type Phase = 'idle' | 'generating' | 'saving'

const REASON_LABEL: Record<string, string> = {
  recommendation: 'Contains individualized recommendation / call-to-action language',
  missing_disclaimer: 'Required FINRA disclaimer was missing',
}

// FNA Generator (docs/legacy-port.md §2.1). Generate → review → save to Document
// OS. The FINRA disclaimer renders verbatim on every report; a household holding
// securities shows the FFS-managed marker; a blocked (recommendation-bearing)
// draft is escalated, never saved.
export function FnaGenerator({ households }: { households: HouseholdOption[] }) {
  const [householdId, setHouseholdId] = React.useState<string>(households[0]?.id ?? '')
  const [notes, setNotes] = React.useState<string>('')
  const [phase, setPhase] = React.useState<Phase>('idle')
  const [report, setReport] = React.useState<FnaReport | null>(null)
  const [hasSecurities, setHasSecurities] = React.useState(false)
  const [blockedReasons, setBlockedReasons] = React.useState<string[] | null>(null)
  const [savedId, setSavedId] = React.useState<string | null>(null)

  const householdName = households.find((h) => h.id === householdId)?.primary_name ?? ''
  const busy = phase !== 'idle'

  async function onGenerate() {
    if (!householdId) return
    setPhase('generating')
    setReport(null)
    setBlockedReasons(null)
    setSavedId(null)
    const res = await postJson<{ report?: FnaReport; hasSecurities?: boolean; blocked?: boolean; reasons?: string[] }>(
      '/api/fna/generate',
      { household_id: householdId, notes: notes.trim() || undefined },
    )
    setPhase('idle')
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (res.data.blocked) {
      setBlockedReasons(res.data.reasons ?? ['recommendation'])
      toast.warning('Draft blocked and escalated to the FSA — recommendation language detected.')
      return
    }
    if (res.data.report) {
      setReport(res.data.report)
      setHasSecurities(Boolean(res.data.hasSecurities))
    }
  }

  async function onSave() {
    if (!report || !householdId) return
    setPhase('saving')
    const res = await postJson<{ document_id?: string; blocked?: boolean; reasons?: string[] }>('/api/fna/save', {
      household_id: householdId,
      report,
    })
    setPhase('idle')
    if (!res.ok) {
      if (res.status === 422 && res.error && 'reasons' in res.error) {
        setBlockedReasons((res.error as unknown as { reasons?: string[] }).reasons ?? ['recommendation'])
        setReport(null)
      }
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (res.data.document_id) {
      setSavedId(res.data.document_id)
      toast.success('FNA saved to Document OS.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Selection + generate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate a Financial Needs Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fna-household">Household</Label>
              <Select
                id="fna-household"
                value={householdId}
                onChange={(e) => setHouseholdId(e.target.value)}
                disabled={busy}
              >
                {households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.primary_name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fna-notes">FSA notes (optional)</Label>
            <Textarea
              id="fna-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              rows={3}
              placeholder="Context for the analysis — life events, goals, review focus. Do not include securities account details."
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={onGenerate} disabled={!householdId || busy}>
              {phase === 'generating' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Generating…
                </>
              ) : (
                <>
                  <FileSignature className="h-4 w-4" aria-hidden /> Generate FNA
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Identifies needs &amp; gaps. Never names a product to buy. Requires FSA review before delivery.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Blocked / escalated */}
      {blockedReasons ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Draft hard-blocked and escalated to the FSA — not saved.</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {blockedReasons.map((r) => (
                <li key={r}>{REASON_LABEL[r] ?? r}</li>
              ))}
            </ul>
            <p className="text-xs">
              The FNA red line (CLAUDE.md §2.2) forbids individualized recommendations. Regenerate or hand the case to
              the human FSA.
            </p>
          </div>
        </div>
      ) : null}

      {/* Saved confirmation */}
      {savedId ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-status-active/40 bg-status-active/10 p-4 text-sm text-status-active"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <p>
            Saved to Document OS for <span className="font-medium">{householdName}</span>. Deliver it from the household
            document record — never by ad-hoc email.
          </p>
        </div>
      ) : null}

      {/* Report review */}
      {report ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Draft FNA — {householdName}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Review before saving. This is a draft, not a recommendation.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {report.urgency ? <Badge variant="outline">Urgency: {String(report.urgency)}</Badge> : null}
              {report.risk_profile ? <Badge variant="outline">{String(report.risk_profile)} profile</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {hasSecurities ? <SecuritiesBanner /> : null}

            {report.executive_summary ? (
              <Section title="Summary">
                <p>{report.executive_summary}</p>
              </Section>
            ) : null}

            {report.financial_position ? (
              <Section title="Financial position">
                <p>{report.financial_position}</p>
              </Section>
            ) : null}

            {report.gaps && report.gaps.length > 0 ? (
              <Section title="Coverage gaps &amp; discussion topics">
                <ul className="list-disc space-y-1 pl-5">
                  {report.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {report.recommendations && report.recommendations.length > 0 ? (
              <Section title="Discussion topics for the FSA meeting">
                <div className="space-y-2">
                  {report.recommendations.map((r, i) => (
                    <div key={i} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.title ?? `Topic ${i + 1}`}</span>
                        {r.product_category ? <Badge variant="outline">{r.product_category}</Badge> : null}
                      </div>
                      {r.description ? <p className="mt-1 text-sm text-muted-foreground">{r.description}</p> : null}
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {report.next_steps && report.next_steps.length > 0 ? (
              <Section title="Next steps">
                <ol className="list-decimal space-y-1 pl-5">
                  {report.next_steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </Section>
            ) : null}

            {/* FINRA disclaimer — renders verbatim on every report (§2.1). */}
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{report.compliance_disclaimer ?? FNA_DISCLAIMER}</p>
            </div>

            <div className="flex items-center gap-3 border-t pt-4">
              <Button onClick={onSave} disabled={busy}>
                {phase === 'saving' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
                  </>
                ) : (
                  'Save to Document OS'
                )}
              </Button>
              <Button variant="outline" onClick={() => setReport(null)} disabled={busy}>
                Discard draft
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="text-sm">{children}</div>
    </section>
  )
}
