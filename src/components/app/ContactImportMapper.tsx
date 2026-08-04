'use client'

import * as React from 'react'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Sparkles, Wand2, Plus, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel } from '@/components/ui/typography'
import { CONTACT_TYPE_LABEL } from '@/components/app/contactMeta'

// ── Types mirroring /api/app/imports/analyze ───────────────────────────────
type Confidence = 'high' | 'medium' | 'low' | 'none'
interface Decision { kind: string; fieldId?: string; rule?: unknown; customKey?: string; entity?: string; fieldType?: string; label?: string }
interface PlanEntry { source: string; squashed: string; sampleValues: string[]; decision: Decision; entity: string | null; confidence: Confidence; method: string; remembered: boolean; conflict: boolean }
interface FieldDef { id: string; entity: string; key: string; label: string; type: string }
interface CustomFieldDef { entity: string; key: string; label: string; fieldType: string }
interface Analysis {
  filename: string
  format: string
  total_rows: number
  detected_template: { key: string; name: string; shape: string } | null
  saved_template: { name: string; template_key: string | null } | null
  plan: { entries: PlanEntry[]; unrecognized: string[] }
  fields: FieldDef[]
  custom_fields: CustomFieldDef[]
}

interface RowResult { row_number: number; full_name: string | null; email: string | null; phone: string | null; status: string; contact_type: string | null; error_message: string | null }
interface CommitResult {
  filename: string; format: string; total: number
  counts: { imported: number; merged?: number; review?: number; duplicate: number; invalid: number }
  households_materialized?: number; joint_created?: number
  mapping?: { confirmed: boolean; template_saved: boolean; custom_fields_created: number } | null
  rows: RowResult[]
}

// A per-header choice — the editable form of a Decision.
type Choice =
  | { kind: 'field'; fieldId: string }
  | { kind: 'split'; rule: unknown }
  | { kind: 'custom'; customKey: string; entity: string; fieldType: string; label: string }
  | { kind: 'as_is' }
  | { kind: 'ignore' }
  | { kind: 'unrecognized' }

const ENTITY_LABEL: Record<string, string> = { household: 'Household', member: 'Member', policy: 'Policy', agency: 'Agency' }
const TYPE_OPTIONS = ['text', 'number', 'date', 'phone', 'email', 'tag'] as const

const CONFIDENCE_STYLE: Record<Confidence, { label: string; cls: string }> = {
  high: { label: 'Recognized', cls: 'text-status-won border-status-won/40 bg-status-won/5' },
  medium: { label: 'Likely', cls: 'text-status-pending border-status-pending/40 bg-status-pending/5' },
  low: { label: 'Low confidence', cls: 'text-status-assumption border-status-assumption/40 bg-status-assumption/5' },
  none: { label: 'Needs mapping', cls: 'text-destructive border-destructive/40 bg-destructive/5' },
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'
}
function decisionToChoice(d: Decision): Choice {
  switch (d.kind) {
    case 'field': return { kind: 'field', fieldId: d.fieldId! }
    case 'split': return { kind: 'split', rule: d.rule }
    case 'custom': return { kind: 'custom', customKey: d.customKey!, entity: d.entity!, fieldType: d.fieldType!, label: d.label || d.customKey! }
    case 'as_is': return { kind: 'as_is' }
    case 'ignore': return { kind: 'ignore' }
    default: return { kind: 'unrecognized' }
  }
}
function choiceToDecision(c: Choice): Decision {
  switch (c.kind) {
    case 'field': return { kind: 'field', fieldId: c.fieldId }
    case 'split': return { kind: 'split', rule: c.rule }
    case 'custom': return { kind: 'custom', customKey: c.customKey, entity: c.entity, fieldType: c.fieldType, label: c.label }
    case 'as_is': return { kind: 'as_is' }
    default: return { kind: 'ignore' }
  }
}

const SELECT_CLS = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export function ContactImportMapper() {
  const [file, setFile] = React.useState<File | null>(null)
  const [phase, setPhase] = React.useState<'idle' | 'analyzing' | 'mapping' | 'committing' | 'done'>('idle')
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null)
  const [choices, setChoices] = React.useState<Record<string, Choice>>({})
  const [customFields, setCustomFields] = React.useState<CustomFieldDef[]>([])
  const [creatingFor, setCreatingFor] = React.useState<string | null>(null)
  const [tags, setTags] = React.useState('')
  const [source, setSource] = React.useState('')
  const [aiRoute, setAiRoute] = React.useState(true)
  const [remember, setRemember] = React.useState(true)
  const [result, setResult] = React.useState<CommitResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const reset = () => {
    setPhase('idle'); setAnalysis(null); setChoices({}); setCustomFields([]); setResult(null); setError(null); setCreatingFor(null)
  }

  async function analyze() {
    if (!file) { setError('Choose a CSV, TSV, Excel, JSON, or PDF file first.'); return }
    setError(null); setResult(null); setPhase('analyzing')
    try {
      const fd = new FormData()
      fd.set('file', file)
      const res = await fetch('/api/app/imports/analyze', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Analysis failed (HTTP ${res.status}).`); setPhase('idle'); return }
      const a = data as Analysis
      setAnalysis(a)
      setCustomFields(a.custom_fields || [])
      const seeded: Record<string, Choice> = {}
      for (const e of a.plan.entries) seeded[e.squashed] = decisionToChoice(e.decision)
      setChoices(seeded)
      setPhase('mapping')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.'); setPhase('idle')
    }
  }

  function setChoice(squashed: string, c: Choice) {
    setChoices((prev) => ({ ...prev, [squashed]: c }))
  }

  function onSelectChange(entry: PlanEntry, value: string) {
    if (value === '__create__') { setCreatingFor(entry.squashed); return }
    if (value === '__ignore__') return setChoice(entry.squashed, { kind: 'ignore' })
    if (value === '__as_is__') return setChoice(entry.squashed, { kind: 'as_is' })
    if (value === '__split__') return setChoice(entry.squashed, { kind: 'split', rule: entry.decision.rule })
    if (value.startsWith('custom:')) {
      const [, ek] = value.split('custom:')
      const cf = customFields.find((f) => `${f.entity}.${f.key}` === ek)
      if (cf) return setChoice(entry.squashed, { kind: 'custom', customKey: cf.key, entity: cf.entity, fieldType: cf.fieldType, label: cf.label })
      return
    }
    if (value.startsWith('field:')) return setChoice(entry.squashed, { kind: 'field', fieldId: value.slice('field:'.length) })
  }

  function choiceToValue(c: Choice | undefined): string {
    if (!c) return '__ignore__'
    switch (c.kind) {
      case 'field': return `field:${c.fieldId}`
      case 'split': return '__split__'
      case 'custom': return `custom:${c.entity}.${c.customKey}`
      case 'as_is': return '__as_is__'
      case 'ignore': return '__ignore__'
      default: return '__unrecognized__'
    }
  }

  function createCustom(squashed: string, label: string, entity: string, fieldType: string) {
    const key = slug(label)
    const cf: CustomFieldDef = { entity, key, label: label.trim() || key, fieldType }
    setCustomFields((prev) => (prev.some((f) => f.entity === entity && f.key === key) ? prev : [...prev, cf]))
    setChoice(squashed, { kind: 'custom', customKey: key, entity, fieldType, label: cf.label })
    setCreatingFor(null)
  }

  async function commit() {
    if (!file || !analysis) return
    setError(null); setPhase('committing')
    const headerMap: Record<string, Decision> = {}
    for (const e of analysis.plan.entries) {
      const c = choices[e.squashed]
      if (!c || c.kind === 'unrecognized') continue // unmapped → skipped
      headerMap[e.squashed] = choiceToDecision(c)
    }
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('mapping', JSON.stringify(headerMap))
      fd.set('save_template', remember ? 'true' : 'false')
      fd.set('ai_route', aiRoute ? 'true' : 'false')
      fd.set('ai', 'false')
      if (tags.trim()) fd.set('tags', tags.trim())
      if (source.trim()) fd.set('source', source.trim())
      const res = await fetch('/api/app/contacts/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Import failed (HTTP ${res.status}).`); setPhase('mapping'); return }
      setResult(data as CommitResult); setPhase('done')
      toast.success(`Imported ${data.counts?.imported ?? 0} of ${data.total} contacts.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.'); setPhase('mapping')
    }
  }

  const unresolvedCount = analysis
    ? analysis.plan.entries.filter((e) => {
        const c = choices[e.squashed]
        return !c || c.kind === 'unrecognized'
      }).length
    : 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Step 1 — Upload */}
      {phase === 'idle' || phase === 'analyzing' ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Import contacts — map fields once, remembered next time</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label htmlFor="mapper-file" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 text-center transition-colors hover:border-primary/50">
                {file ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                <span className="text-sm font-medium">{file ? file.name : 'Drop a CSV, TSV, Excel, JSON, or PDF file here or click to browse'}</span>
                <span className="text-xs text-muted-foreground">CSV · TSV · .xlsx · JSON · PDF · max 8MB · up to 2,000 rows</span>
                <input id="mapper-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.json,.pdf" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tags">Tags (comma-separated)</Label>
                  <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="event-2026, warm-lead" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source">Source</Label>
                  <Input id="source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="import" />
                </div>
              </div>
              <Button type="button" className="w-full" disabled={!file || phase === 'analyzing'} onClick={analyze}>
                {phase === 'analyzing' ? 'Analyzing columns…' : 'Analyze columns'}
              </Button>
              <p className="text-xs text-muted-foreground">Columns are auto-detected against known Farmers district exports. You confirm anything unrecognized once — the mapping is remembered for the next file of the same shape. No consent or birthday step.</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Step 2 — Map */}
      {phase === 'mapping' || phase === 'committing' ? analysis ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4 text-primary" /> Review field mapping · {analysis.filename}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {analysis.detected_template ? (
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="font-medium">Template detected — {analysis.detected_template.name}</p>
                  <p className="text-xs text-muted-foreground">{analysis.detected_template.shape}. Columns below are pre-mapped; adjust anything that looks wrong.</p>
                </div>
              </div>
            ) : analysis.saved_template ? (
              <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                <div><p className="font-medium">Saved mapping applied — {analysis.saved_template.name}</p><p className="text-xs text-muted-foreground">You mapped a file of this shape before; that mapping was reused.</p></div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No known template — map the columns below. Your choices are remembered for next time.</p>
            )}

            {unresolvedCount > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> {unresolvedCount} column{unresolvedCount === 1 ? '' : 's'} still need a choice. Unmapped columns are skipped on import.
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[26%]">Source column</TableHead>
                    <TableHead className="w-[24%]">Sample values</TableHead>
                    <TableHead className="w-[16%]">Confidence</TableHead>
                    <TableHead>Maps to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.plan.entries.map((e) => {
                    const c = choices[e.squashed]
                    const conf = CONFIDENCE_STYLE[e.confidence]
                    const isCreating = creatingFor === e.squashed
                    return (
                      <React.Fragment key={e.squashed || e.source}>
                        <TableRow className={e.conflict ? 'bg-status-assumption/5' : undefined}>
                          <TableCell>
                            <MonoLabel>{e.source}</MonoLabel>
                            {e.conflict ? <span className="ml-1 text-[10px] text-status-assumption">duplicate target</span> : null}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{e.sampleValues.length ? e.sampleValues.join(' · ') : '—'}</TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${conf.cls}`}>{conf.label}</span>
                            {e.remembered ? <span className="ml-1 text-[10px] text-muted-foreground">remembered</span> : null}
                          </TableCell>
                          <TableCell>
                            {c?.kind === 'split' ? (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center rounded-md border border-status-assumption/40 bg-status-assumption/5 px-2 py-0.5 text-xs text-status-assumption">Split → AOR code + series code</span>
                                <button type="button" className="text-xs text-primary underline" onClick={() => setChoice(e.squashed, { kind: 'ignore' })}>change</button>
                              </div>
                            ) : (
                              <select aria-label={`Map column ${e.source}`} className={SELECT_CLS} value={choiceToValue(c)} onChange={(ev) => onSelectChange(e, ev.target.value)}>
                                <option value="__unrecognized__" disabled>— Choose —</option>
                                <option value="__ignore__">Ignore this column</option>
                                <option value="__as_is__">Import as-is (keep raw)</option>
                                <option value="__create__">＋ Create custom field…</option>
                                {customFields.length ? (
                                  <optgroup label="Custom fields">
                                    {customFields.map((f) => <option key={`${f.entity}.${f.key}`} value={`custom:${f.entity}.${f.key}`}>{f.label} · {ENTITY_LABEL[f.entity]}</option>)}
                                  </optgroup>
                                ) : null}
                                {(['household', 'member', 'policy', 'agency'] as const).map((ent) => (
                                  <optgroup key={ent} label={ENTITY_LABEL[ent]}>
                                    {analysis.fields.filter((f) => f.entity === ent).map((f) => <option key={f.id} value={`field:${f.id}`}>{f.label}</option>)}
                                  </optgroup>
                                ))}
                              </select>
                            )}
                          </TableCell>
                        </TableRow>
                        {isCreating ? (
                          <TableRow>
                            <TableCell colSpan={4} className="bg-muted/30">
                              <CustomFieldCreator defaultLabel={e.source} onCancel={() => setCreatingFor(null)} onCreate={(label, entity, type) => createCustom(e.squashed, label, entity, type)} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={aiRoute} onChange={(ev) => setAiRoute(ev.target.checked)} />
              <span><span className="font-medium">AI categorize contacts</span><span className="block text-xs text-muted-foreground">Identify each new contact’s type and auto-tag it. Falls back to Uncategorized if the AI gateway is off.</span></span>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={remember} onChange={(ev) => setRemember(ev.target.checked)} />
              <span><span className="font-medium">Remember this mapping for next time</span><span className="block text-xs text-muted-foreground">Save it as a template for files with this column signature. Individual column decisions are always remembered.</span></span>
            </label>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={reset} disabled={phase === 'committing'}><ArrowLeft className="mr-1.5 h-4 w-4" /> Start over</Button>
              <Button type="button" onClick={commit} disabled={phase === 'committing'}>{phase === 'committing' ? 'Importing…' : `Import ${analysis.total_rows} rows`}</Button>
            </div>
            <p className="text-xs text-muted-foreground">A name column is required. Rows without a valid email or phone are quarantined and reported (never dropped). Owner + joint owner group into one household.</p>
          </CardContent>
        </Card>
      ) : null : null}

      {/* Step 3 — Result */}
      {phase === 'done' && result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-status-won" /> {result.filename} · {result.format.toUpperCase()}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span><strong>{result.counts.imported}</strong> imported</span>
              {typeof result.counts.merged === 'number' ? <span className="text-muted-foreground"><strong>{result.counts.merged}</strong> merged</span> : null}
              {typeof result.counts.review === 'number' ? <span className="text-muted-foreground"><strong>{result.counts.review}</strong> review</span> : null}
              <span className="text-muted-foreground"><strong>{result.counts.duplicate}</strong> duplicate</span>
              <span className="text-muted-foreground"><strong>{result.counts.invalid}</strong> quarantined</span>
              <span className="text-muted-foreground">of {result.total} rows</span>
              {result.joint_created ? <span className="text-muted-foreground">· {result.joint_created} joint owner{result.joint_created === 1 ? '' : 's'}</span> : null}
            </div>
            {result.mapping ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                <p className="mb-0.5 text-sm font-medium text-foreground">Mapping remembered</p>
                {result.mapping.template_saved ? <span>Template saved for this file shape. </span> : null}
                {result.mapping.custom_fields_created ? <span>{result.mapping.custom_fields_created} custom field{result.mapping.custom_fields_created === 1 ? '' : 's'} created. </span> : null}
                <span>The next file like this will map automatically.</span>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Contact</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
                <TableBody>
                  {result.rows.slice(0, 200).map((r) => (
                    <TableRow key={r.row_number}>
                      <TableCell><MonoLabel>{r.row_number}</MonoLabel></TableCell>
                      <TableCell>{r.full_name || r.email || r.phone || '—'}</TableCell>
                      <TableCell className="text-xs">{r.contact_type ? (CONTACT_TYPE_LABEL[r.contact_type] ?? r.contact_type) : '—'}</TableCell>
                      <TableCell className="capitalize">{r.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.error_message ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {result.rows.length > 200 ? <p className="text-xs text-muted-foreground">Showing the first 200 of {result.rows.length} rows.</p> : null}
            <Button type="button" variant="outline" onClick={reset}>Import another file</Button>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          <div><p className="font-medium">Something went wrong</p><p className="text-muted-foreground">{error}</p></div>
        </div>
      ) : null}
    </div>
  )
}

function CustomFieldCreator({ defaultLabel, onCreate, onCancel }: { defaultLabel: string; onCreate: (label: string, entity: string, type: string) => void; onCancel: () => void }) {
  const [label, setLabel] = React.useState(defaultLabel)
  const [entity, setEntity] = React.useState('member')
  const [type, setType] = React.useState('text')
  return (
    <div className="flex flex-wrap items-end gap-3 py-1">
      <div className="space-y-1">
        <Label htmlFor="cf-label" className="text-xs">Field label</Label>
        <Input id="cf-label" value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 w-48" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cf-entity" className="text-xs">Attach to</Label>
        <select id="cf-entity" className={`${SELECT_CLS} h-8 w-36`} value={entity} onChange={(e) => setEntity(e.target.value)}>
          {(['household', 'member', 'policy', 'agency'] as const).map((en) => <option key={en} value={en}>{ENTITY_LABEL[en]}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="cf-type" className="text-xs">Type</Label>
        <select id="cf-type" className={`${SELECT_CLS} h-8 w-28`} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPE_OPTIONS.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
        </select>
      </div>
      <Button type="button" size="sm" onClick={() => onCreate(label, entity, type)}><Plus className="mr-1 h-3.5 w-3.5" /> Add field</Button>
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
    </div>
  )
}
