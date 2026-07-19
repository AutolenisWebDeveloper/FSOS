'use client'

// Compliance Intelligence — the working surface for the NIGO-resolution / RightBridge
// / note-authoring subsystem (owner-authorized; docs/compliance/). Six tabs wired to
// the /api/compliance/* routes. Every conclusion the engine returns is grounded in
// and cited to an uploaded knowledge-library passage; where authority is missing the
// UI surfaces the verify-gate note ("insufficient authority — upload the governing
// document") rather than an invented rule.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TabKey = 'analyze' | 'note' | 'rightbridge' | 'checklist' | 'library' | 'history'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'analyze', label: 'Analyze NIGO' },
  { key: 'note', label: 'Harden a Note' },
  { key: 'rightbridge', label: 'RightBridge Check' },
  { key: 'checklist', label: 'Paperwork Checklist' },
  { key: 'library', label: 'Knowledge Library' },
  { key: 'history', label: 'NIGO History' },
]

const AUTHORITY_TYPES = [
  'FINRA_RULE',
  'SEC_RULE',
  'STATE_REQUIREMENT',
  'CARRIER_REQUIREMENT',
  'FORM_INSTRUCTION',
  'FFS_PROCEDURE',
  'SUITABILITY_STANDARD',
  'INTERNAL_PREFERENCE',
] as const

// ── shared helpers ────────────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error || `Request failed (${res.status})` }
    return { ok: true, data: json as T }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

function validityVariant(v: string): 'won' | 'lost' | 'pending' | 'blocked' | 'escalated' | 'outline' {
  switch (v) {
    case 'valid':
      return 'won'
    case 'partially_valid':
      return 'pending'
    case 'unsupported':
      return 'blocked'
    case 'inconsistent':
    case 'duplicative':
      return 'escalated'
    default:
      return 'outline'
  }
}

function authorityVariant(t: string | null): 'active' | 'secondary' | 'assumption' | 'outline' {
  if (!t) return 'assumption'
  if (t === 'FINRA_RULE' || t === 'SEC_RULE' || t === 'STATE_REQUIREMENT') return 'active'
  if (t === 'INTERNAL_PREFERENCE') return 'assumption'
  return 'secondary'
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}

// ── Tab: Analyze NIGO ─────────────────────────────────────────────────────────

interface AnalyzeIssue {
  id: string | null
  seq: number
  issue_text: string
  authority_type: string | null
  validity: string
  explanation: string
  whats_wrong: string
  what_to_fix: string
  draft_artifact: string
  citations: string[]
  verify_note: string | null
  retrieved: { authority_type: string; section_ref: string | null; title: string | null; verbatim: boolean }[]
}

function AnalyzeTab() {
  const [nigo, setNigo] = useState('')
  const [product, setProduct] = useState('')
  const [carrier, setCarrier] = useState('')
  const [state, setState] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [workItem, setWorkItem] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [caseId, setCaseId] = useState<string | null>(null)
  const [issues, setIssues] = useState<AnalyzeIssue[] | null>(null)

  async function run() {
    setLoading(true)
    setError('')
    setIssues(null)
    const res = await postJson<{ case_id: string; issues: AnalyzeIssue[] }>('/api/compliance/analyze', {
      nigo_text: nigo,
      product: product || undefined,
      carrier: carrier || undefined,
      state: state || undefined,
      reviewer: reviewer || undefined,
      work_item: workItem || undefined,
    })
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCaseId(res.data.case_id)
    setIssues(res.data.issues)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <div>
          <Label htmlFor="nigo">Paste the NIGO</Label>
          <Textarea
            id="nigo"
            rows={7}
            value={nigo}
            onChange={(e) => setNigo(e.target.value)}
            placeholder="Paste the full NIGO email / notice here…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <Label htmlFor="product">Product</Label>
            <Input id="product" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="VA, VUL…" />
          </div>
          <div>
            <Label htmlFor="carrier">Carrier</Label>
            <Input id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Pacific Life…" />
          </div>
          <div>
            <Label htmlFor="state">State</Label>
            <Input id="state" value={state} onChange={(e) => setState(e.target.value)} placeholder="TX" />
          </div>
          <div>
            <Label htmlFor="reviewer">Reviewer</Label>
            <Input id="reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="work">Work item</Label>
            <Input id="work" value={workItem} onChange={(e) => setWorkItem(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={loading || nigo.trim().length < 5}>
          {loading ? 'Analyzing…' : 'Analyze NIGO'}
        </Button>
        {caseId ? <span className="text-xs text-muted-foreground">Case {caseId.slice(0, 8)}</span> : null}
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {issues && issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discrete issues were parsed from that NIGO.</p>
      ) : null}

      {issues?.map((it) => (
        <Card key={`${it.seq}-${it.id ?? ''}`}>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <CardTitle className="text-base">
              Issue {it.seq}: <span className="font-normal text-muted-foreground">{it.issue_text}</span>
            </CardTitle>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              <Badge variant={validityVariant(it.validity)}>{it.validity.replace(/_/g, ' ')}</Badge>
              <Badge variant={authorityVariant(it.authority_type)}>
                {it.authority_type ? it.authority_type.replace(/_/g, ' ') : 'unsupported'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {it.explanation ? (
              <div>
                <div className="font-medium">Why it was raised</div>
                <p className="text-muted-foreground">{it.explanation}</p>
              </div>
            ) : null}
            {it.whats_wrong ? (
              <div>
                <div className="font-medium">What&apos;s wrong / missing</div>
                <p className="text-muted-foreground">{it.whats_wrong}</p>
              </div>
            ) : null}
            {it.what_to_fix ? (
              <div>
                <div className="font-medium">What to fix</div>
                <p className="text-muted-foreground">{it.what_to_fix}</p>
              </div>
            ) : null}
            {it.draft_artifact ? (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-medium">Draft response</div>
                  <CopyButton text={it.draft_artifact} />
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">{it.draft_artifact}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">Citations:</span>
              {it.citations.length ? (
                it.citations.map((c) => (
                  <Badge key={c} variant="outline">
                    {c}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">none grounded</span>
              )}
            </div>
            {it.verify_note ? (
              <div className="rounded-md border border-status-assumption/40 bg-status-assumption/10 px-3 py-2 text-xs text-status-assumption">
                Verify gate: {it.verify_note}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Tab: Harden a Note ────────────────────────────────────────────────────────

function NoteTab() {
  const [facts, setFacts] = useState('')
  const [existing, setExisting] = useState('')
  const [product, setProduct] = useState('')
  const [txn, setTxn] = useState('')
  const [isReplacement, setIsReplacement] = useState(false)
  const [hasLoan, setHasLoan] = useState(false)
  const [is1035, setIs1035] = useState(false)
  const [isBuffered, setIsBuffered] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    note: string
    applicable_elements: string[]
    missing_facts: string[]
    citations: string[]
    disclaimer: string
  } | null>(null)

  async function run() {
    setLoading(true)
    setError('')
    setResult(null)
    const res = await postJson<typeof result & object>('/api/compliance/note', {
      case_facts: facts,
      existing_note: existing || undefined,
      product: product || undefined,
      transaction_type: txn || undefined,
      is_replacement: isReplacement,
      has_loan: hasLoan,
      is_exchange_1035: is1035,
      is_buffered: isBuffered,
    })
    setLoading(false)
    if (!res.ok) return setError(res.error)
    setResult(res.data as NonNullable<typeof result>)
  }

  const toggle = (v: boolean, set: (b: boolean) => void, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  )

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="facts">Case facts</Label>
        <Textarea
          id="facts"
          rows={6}
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
          placeholder="Age, income, net worth, liquid net worth, time horizon, stated objective, product, funding source, costs…"
        />
      </div>
      <div>
        <Label htmlFor="existing">Existing note to strengthen (optional)</Label>
        <Textarea id="existing" rows={4} value={existing} onChange={(e) => setExisting(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="np">Product</Label>
          <Input id="np" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="VA, VUL, RILA…" />
        </div>
        <div>
          <Label htmlFor="nt">Transaction type</Label>
          <Input id="nt" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="exchange, new purchase…" />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        {toggle(isReplacement, setIsReplacement, 'Replacement')}
        {toggle(hasLoan, setHasLoan, 'Has loan')}
        {toggle(is1035, setIs1035, '1035 exchange')}
        {toggle(isBuffered, setIsBuffered, 'Buffered / RILA')}
      </div>
      <Button onClick={run} disabled={loading || facts.trim().length < 5}>
        {loading ? 'Drafting…' : 'Draft / strengthen note'}
      </Button>

      {error ? <ErrorBanner message={error} /> : null}

      {result ? (
        <div className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Drafted note</CardTitle>
              <CopyButton text={result.note} />
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{result.note}</p>
            </CardContent>
          </Card>
          {result.missing_facts.length ? (
            <div className="rounded-md border border-status-pending/40 bg-status-pending/10 p-3 text-sm">
              <div className="font-medium">Still needed to fully satisfy the standard</div>
              <ul className="ml-4 list-disc text-muted-foreground">
                {result.missing_facts.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {result.applicable_elements.map((e) => (
              <Badge key={e} variant="outline">
                {e.split(' ')[0]}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
        </div>
      ) : null}
    </div>
  )
}

// ── Tab: RightBridge Check ────────────────────────────────────────────────────

function RightBridgeTab() {
  const [text, setText] = useState('')
  const [type, setType] = useState('product_profiler')
  const [caseId, setCaseId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    parsed_fields: Record<string, unknown>
    scoring_flags: Record<string, unknown>
    consistency_flags: { field: string; issue: string; citation?: string | null }[]
  } | null>(null)

  async function run() {
    setLoading(true)
    setError('')
    setResult(null)
    const res = await postJson<NonNullable<typeof result>>('/api/compliance/rightbridge', {
      report_text: text,
      report_type: type,
      case_id: caseId || undefined,
    })
    setLoading(false)
    if (!res.ok) return setError(res.error)
    setResult(res.data)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rbtype">Report type</Label>
          <select
            id="rbtype"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="product_profiler">Product Profiler</option>
            <option value="life_wizard">Life Wizard</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <Label htmlFor="rbcase">Link to NIGO case id (optional)</Label>
          <Input id="rbcase" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="uuid" />
        </div>
      </div>
      <div>
        <Label htmlFor="rbtext">RightBridge report text</Label>
        <Textarea
          id="rbtext"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the extracted text of the RightBridge report (fields, answers, scoring)…"
        />
      </div>
      <Button onClick={run} disabled={loading || text.trim().length < 20}>
        {loading ? 'Checking…' : 'Extract + consistency check'}
      </Button>

      {error ? <ErrorBanner message={error} /> : null}

      {result ? (
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consistency flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {result.consistency_flags.length === 0 ? (
                <p className="text-muted-foreground">No contradictions detected against the available documents.</p>
              ) : (
                result.consistency_flags.map((f, i) => (
                  <div key={i} className="rounded-md border border-status-blocked/40 bg-status-blocked/10 p-2">
                    <div className="font-medium">{f.field}</div>
                    <p className="text-muted-foreground">{f.issue}</p>
                    {f.citation ? <Badge variant="outline">{f.citation}</Badge> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parsed fields</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs">
                {JSON.stringify(result.parsed_fields, null, 2)}
              </pre>
              {result.scoring_flags && Object.keys(result.scoring_flags).length ? (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs">
                  {JSON.stringify(result.scoring_flags, null, 2)}
                </pre>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

// ── Tab: Paperwork Checklist ──────────────────────────────────────────────────

function ChecklistTab() {
  const [product, setProduct] = useState('')
  const [carrier, setCarrier] = useState('')
  const [txn, setTxn] = useState('')
  const [state, setState] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    required_forms: { form: string; why: string; citation?: string | null }[]
    required_fields: { field: string; why: string; citation?: string | null }[]
    required_signatures: { signer: string; document: string; citation?: string | null }[]
    gaps: string[]
  } | null>(null)

  async function run() {
    setLoading(true)
    setError('')
    setResult(null)
    const res = await postJson<NonNullable<typeof result>>('/api/compliance/checklist', {
      product,
      carrier: carrier || undefined,
      transaction_type: txn || undefined,
      state: state || undefined,
    })
    setLoading(false)
    if (!res.ok) return setError(res.error)
    setResult(res.data)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <Label htmlFor="cp">Product</Label>
          <Input id="cp" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="VA…" />
        </div>
        <div>
          <Label htmlFor="cc">Carrier</Label>
          <Input id="cc" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ct">Transaction</Label>
          <Input id="ct" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="exchange…" />
        </div>
        <div>
          <Label htmlFor="cs">State</Label>
          <Input id="cs" value={state} onChange={(e) => setState(e.target.value)} placeholder="TX" />
        </div>
      </div>
      <Button onClick={run} disabled={loading || product.trim().length < 1}>
        {loading ? 'Building…' : 'Build checklist'}
      </Button>

      {error ? <ErrorBanner message={error} /> : null}

      {result ? (
        <div className="space-y-3 text-sm">
          {(['required_forms', 'required_fields', 'required_signatures'] as const).map((key) => {
            const items = result[key]
            if (!items.length) return null
            return (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="text-base">{key.replace('required_', 'Required ').replace('_', ' ')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {items.map((it, i) => {
                    const rec = it as Record<string, string | null | undefined>
                    const primary = rec.form ?? rec.field ?? `${rec.signer ?? ''} — ${rec.document ?? ''}`
                    return (
                      <div key={i} className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{primary}</div>
                          <p className="text-muted-foreground">{rec.why ?? ''}</p>
                        </div>
                        {rec.citation ? <Badge variant="outline">{rec.citation}</Badge> : null}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
          {result.gaps.length ? (
            <div className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-3">
              <div className="font-medium text-status-assumption">Library gaps — upload to complete</div>
              <ul className="ml-4 list-disc text-muted-foreground">
                {result.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ── Tab: Knowledge Library ────────────────────────────────────────────────────

interface LibDoc {
  id: string
  title: string
  authority_type: string
  source_org: string | null
  carrier: string | null
  verbatim: boolean
  is_assumption: boolean
  updated_at: string
}

function LibraryTab() {
  const [docs, setDocs] = useState<LibDoc[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // upload form
  const [title, setTitle] = useState('')
  const [authority, setAuthority] = useState<string>('FFS_PROCEDURE')
  const [org, setOrg] = useState('')
  const [section, setSection] = useState('')
  const [productScope, setProductScope] = useState('')
  const [carrier, setCarrier] = useState('')
  const [isAssumption, setIsAssumption] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/compliance/ingest')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error || 'Failed to load library')
      } else {
        setDocs(json.documents ?? [])
        setCounts(json.chunk_counts_by_tier ?? {})
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function upload() {
    setSaving(true)
    setSaveMsg('')
    const res = await postJson<{ document_id: string; chunks: number }>('/api/compliance/ingest', {
      title,
      authority_type: authority,
      source_org: org || undefined,
      section_ref: section || undefined,
      carrier: carrier || undefined,
      product_scope: productScope
        ? productScope.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      is_assumption: isAssumption,
      text: body,
    })
    setSaving(false)
    if (!res.ok) return setSaveMsg(res.error)
    setSaveMsg(`Stored — ${res.data.chunks} chunk(s).`)
    setTitle('')
    setSection('')
    setBody('')
    void refresh()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Upload a governing document</h3>
        <p className="text-xs text-muted-foreground">
          The highest-value uploads are your <strong>FFS_PROCEDURE</strong> (compliance manual, WSPs, FCB bulletins) and{' '}
          <strong>CARRIER_REQUIREMENT</strong> docs — that&apos;s what lets the engine say &ldquo;this NIGO is firm
          policy, not a FINRA rule&rdquo; with a citation.
        </p>
        <div>
          <Label htmlFor="lt">Title</Label>
          <Input id="lt" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="la">Authority tier</Label>
            <select
              id="la"
              value={authority}
              onChange={(e) => setAuthority(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {AUTHORITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="lo">Source org</Label>
            <Input id="lo" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="FFS, Pacific Life…" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ls">Section ref</Label>
            <Input id="ls" value={section} onChange={(e) => setSection(e.target.value)} placeholder="WSP §4.2" />
          </div>
          <div>
            <Label htmlFor="lp">Product scope (comma-sep)</Label>
            <Input id="lp" value={productScope} onChange={(e) => setProductScope(e.target.value)} placeholder="VA, VUL" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="lc">Carrier</Label>
            <Input id="lc" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </div>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isAssumption} onChange={(e) => setIsAssumption(e.target.checked)} />
            Config default — verify
          </label>
        </div>
        <div>
          <Label htmlFor="lb">Document text</Label>
          <Textarea id="lb" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <Button onClick={upload} disabled={saving || title.trim().length < 2 || body.trim().length < 1}>
          {saving ? 'Storing…' : 'Store in library'}
        </Button>
        {saveMsg ? <p className="text-xs text-muted-foreground">{saveMsg}</p> : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Library by authority tier</h3>
        <div className="flex flex-wrap gap-2">
          {AUTHORITY_TYPES.map((t) => {
            const n = counts[t] ?? 0
            const empty = n === 0
            return (
              <Badge key={t} variant={empty ? 'assumption' : 'active'}>
                {t.replace(/_/g, ' ')}: {n}
                {empty ? ' — upload' : ''}
              </Badge>
            )
          })}
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet. Load the seed corpus, then add your FFS + carrier docs.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {docs.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-2 p-2 text-sm">
                <div>
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">{d.source_org ?? '—'}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={authorityVariant(d.authority_type)}>{d.authority_type.replace(/_/g, ' ')}</Badge>
                  {!d.verbatim ? <Badge variant="assumption">verify verbatim</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: NIGO History ─────────────────────────────────────────────────────────

interface HistoryIssue {
  id: string
  seq: number
  issue_text: string
  authority_type: string | null
  validity: string | null
}
interface HistoryCase {
  id: string
  work_item: string | null
  product: string | null
  carrier: string | null
  reviewer: string | null
  outcome: string
  round_number: number | null
  received_at: string
  issues: HistoryIssue[]
}
interface Stats {
  total_cases: number
  total_issues: number
  not_law_backed_pct: number
  avg_rounds: number
  avg_days_open: number
  validity_breakdown: Record<string, number>
  authority_breakdown: Record<string, number>
  top_patterns: { pattern: string; count: number }[]
}

function HistoryTab() {
  const [cases, setCases] = useState<HistoryCase[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  const refresh = useCallback(async (search: string) => {
    setLoading(true)
    setError('')
    try {
      const [hRes, sRes] = await Promise.all([
        fetch(`/api/compliance/history${search ? `?q=${encodeURIComponent(search)}` : ''}`),
        fetch('/api/compliance/stats'),
      ])
      const hJson = await hRes.json().catch(() => ({}))
      const sJson = await sRes.json().catch(() => ({}))
      if (!hRes.ok) setError(hJson?.error || 'Failed to load history')
      else setCases(hJson.cases ?? [])
      if (sRes.ok) setStats(sJson as Stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh('')
  }, [refresh])

  return (
    <div className="space-y-4">
      {stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { label: 'Cases', value: stats.total_cases },
            { label: 'Issues', value: stats.total_issues },
            { label: 'Not law-backed', value: `${stats.not_law_backed_pct}%` },
            { label: 'Avg rounds', value: stats.avg_rounds },
            { label: 'Avg days open', value: stats.avg_days_open },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-3">
                <div className="text-2xl font-semibold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {stats && stats.total_issues > 0 ? (
        <p className="text-xs text-muted-foreground">
          Of {stats.total_issues} reviewer-raised issues, {stats.not_law_backed_pct}% were NOT backed by a FINRA/SEC/state
          rule (firm policy, preference, or unsupported) — the evidence base for your pushbacks.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issue text…" />
        <Button variant="outline" onClick={() => refresh(q)}>
          Search
        </Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No NIGO history yet. Analyzed NIGOs are logged here automatically.</p>
      ) : (
        <div className="space-y-2">
          {cases.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm">
                  {c.work_item || c.id.slice(0, 8)}{' '}
                  <span className="font-normal text-muted-foreground">
                    {[c.product, c.carrier, c.reviewer].filter(Boolean).join(' · ')}
                  </span>
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Badge variant="outline">{c.outcome}</Badge>
                  {c.round_number && c.round_number > 1 ? <Badge variant="pending">round {c.round_number}</Badge> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-sm">
                {c.issues.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{it.issue_text}</span>
                    <span className="flex shrink-0 gap-1">
                      {it.validity ? <Badge variant={validityVariant(it.validity)}>{it.validity.replace(/_/g, ' ')}</Badge> : null}
                      <Badge variant={authorityVariant(it.authority_type)}>
                        {it.authority_type ? it.authority_type.replace(/_/g, ' ') : 'unsupported'}
                      </Badge>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function ComplianceIntelligence() {
  const [tab, setTab] = useState<TabKey>('analyze')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'analyze' ? <AnalyzeTab /> : null}
      {tab === 'note' ? <NoteTab /> : null}
      {tab === 'rightbridge' ? <RightBridgeTab /> : null}
      {tab === 'checklist' ? <ChecklistTab /> : null}
      {tab === 'library' ? <LibraryTab /> : null}
      {tab === 'history' ? <HistoryTab /> : null}
    </div>
  )
}
