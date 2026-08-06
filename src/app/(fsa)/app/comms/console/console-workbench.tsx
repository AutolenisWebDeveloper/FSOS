'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { postJson, patchJson, deleteJson, firstFieldError } from '@/lib/client/api'
import { cn } from '@/lib/utils'

// ── Types mirroring the API contracts ────────────────────────────────────────
type Channel = 'sms' | 'email'
type Tab = 'sms' | 'email' | 'ai'
type Source = 'blank' | 'campaign'

interface AssetRow {
  asset_id: string
  source_table: string
  campaign_key: string | null
  channel: string | null
  kind: string
  name: string | null
  approval_status: string | null
}
interface AssetGroup {
  key: string
  label: string
  assets: AssetRow[]
}
interface AgentRow {
  key: string
  name: string
  mission: string | null
}
interface TestRecipient {
  id: string
  channel: Channel
  address: string
  label: string | null
  verified_at: string | null
}
interface GateOutcome {
  ok: boolean
  sent?: boolean
  blocked?: boolean
  blocked_step?: string | null
  reason?: string
  message_id?: string
  idempotent?: boolean
  ai_test?: boolean
  guardrail_pass?: boolean
  failures?: string[]
  live?: { sent: boolean; blocked: boolean; blocked_step?: string; reason?: string } | null
}

const MANUAL_PURPOSES = ['TRANSACTIONAL', 'SERVICING', 'APPOINTMENT', 'RELATIONSHIP', 'APPLICATION_STATUS', 'DOCUMENT_REQUEST', 'POLICY_DEADLINE', 'MARKETING'] as const

function newIdemKey(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

export function ConsoleWorkbench() {
  // Composition state
  const [tab, setTab] = useState<Tab>('sms')
  const [aiChannel, setAiChannel] = useState<Channel>('sms')
  const [source, setSource] = useState<Source>('blank')
  const channel: Channel = tab === 'ai' ? aiChannel : tab

  // Recipient
  const [to, setTo] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [city, setCity] = useState('')

  // Blank compose
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  const [purpose, setPurpose] = useState<string>('')

  // Campaign asset
  const [assets, setAssets] = useState<AssetGroup[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetQuery, setAssetQuery] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null)

  // AI
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [agentKey, setAgentKey] = useState('')
  const [aiPurpose, setAiPurpose] = useState('RELATIONSHIP')
  const [liveAi, setLiveAi] = useState(false)

  // Preview
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Test mode
  const [testMode, setTestMode] = useState(false)
  const [testRecipients, setTestRecipients] = useState<TestRecipient[]>([])
  const [selectedTestId, setSelectedTestId] = useState('')
  const [campaignKey, setCampaignKey] = useState<string | null>(null)

  // Send outcome
  const [outcome, setOutcome] = useState<GateOutcome | null>(null)
  const [sending, setSending] = useState(false)

  // ── Deep-link: /app/comms/console?mode=test&campaign=life_conversion ────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('mode') === 'test') setTestMode(true)
    const c = params.get('campaign')
    if (c) {
      setCampaignKey(c)
      setSource('campaign')
    }
  }, [])

  // ── Load agents once (for the AI tab) ───────────────────────────────────────
  useEffect(() => {
    fetch('/api/comms/agents')
      .then((r) => (r.ok ? r.json() : { agents: [] }))
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => setAgents([]))
  }, [])

  // ── Load test recipients when test mode turns on ────────────────────────────
  const loadTestRecipients = useCallback(() => {
    fetch('/api/comms/test/recipients')
      .then((r) => (r.ok ? r.json() : { recipients: [] }))
      .then((d) => setTestRecipients(d.recipients ?? []))
      .catch(() => setTestRecipients([]))
  }, [])
  useEffect(() => {
    if (testMode) loadTestRecipients()
  }, [testMode, loadTestRecipients])

  // ── Load campaign assets for the picker ─────────────────────────────────────
  const loadAssets = useCallback(() => {
    setAssetsLoading(true)
    const qs = new URLSearchParams({ channel })
    if (assetQuery.trim()) qs.set('q', assetQuery.trim())
    if (campaignKey) qs.set('campaign', campaignKey)
    fetch(`/api/comms/assets?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => setAssets(d.groups ?? []))
      .catch(() => setAssets([]))
      .finally(() => setAssetsLoading(false))
  }, [channel, assetQuery, campaignKey])
  useEffect(() => {
    if (source === 'campaign') loadAssets()
  }, [source, loadAssets])

  // Reset the selected asset when the channel changes (an asset is channel-specific).
  useEffect(() => {
    setSelectedAsset(null)
    setPreview(null)
    setOutcome(null)
  }, [tab, aiChannel])

  const recipientCtx = useMemo(
    () => ({ first_name: firstName || undefined, last_name: lastName || undefined, city: city || undefined }),
    [firstName, lastName, city],
  )

  // ── Preview (production render; never sends) ────────────────────────────────
  const runPreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreview(null)
    const payload: Record<string, unknown> = { channel, recipient: recipientCtx }
    if (source === 'campaign') {
      if (!selectedAsset) {
        toast.error('Pick an asset to preview.')
        setPreviewLoading(false)
        return
      }
      payload.source_kind = tab === 'ai' ? 'agent_seed' : 'campaign_asset'
      payload.source_asset_id = selectedAsset.asset_id
      payload.source_asset_table = selectedAsset.source_table
    } else {
      payload.source_kind = tab === 'ai' ? 'agent_seed' : 'blank'
      payload.body = body
      if (channel === 'email') payload.subject = subject
    }
    const res = await postJson<Record<string, unknown>>('/api/comms/preview', payload)
    setPreviewLoading(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    setPreview(res.data)
  }, [channel, recipientCtx, source, selectedAsset, tab, body, subject])

  // ── Send / initiate / test ──────────────────────────────────────────────────
  const canSend = useMemo(() => {
    if (!testMode && !to.trim()) return false
    if (testMode && !selectedTestId) return false
    if (source === 'campaign' && !selectedAsset) return false
    if (source === 'blank' && tab !== 'ai' && !body.trim()) return false
    if (tab === 'ai' && !agentKey) return false
    if (tab === 'ai' && source === 'blank' && !body.trim()) return false
    return true
  }, [testMode, to, selectedTestId, source, selectedAsset, tab, body, agentKey])

  const handleSend = useCallback(async () => {
    setSending(true)
    setOutcome(null)
    const idem = newIdemKey()
    try {
      // ── Test mode → POST /api/comms/test (verified self destination) ─────────
      if (testMode) {
        const payload: Record<string, unknown> = {
          channel,
          test_recipient_id: selectedTestId,
          campaign_key: campaignKey ?? selectedAsset?.campaign_key ?? undefined,
          idempotency_key: idem,
        }
        if (source === 'campaign' && selectedAsset) {
          payload.asset_id = selectedAsset.asset_id
          payload.asset_table = selectedAsset.source_table
        } else if (body.trim()) {
          payload.body = body
        }
        if (tab === 'ai') {
          payload.agent_key = agentKey
          payload.live_ai = liveAi
        }
        const res = await postJson<GateOutcome>('/api/comms/test', payload)
        if (!res.ok) {
          toast.error(firstFieldError(res.error).message)
          return
        }
        setOutcome(res.data)
        if (res.data.ai_test) toast[res.data.guardrail_pass ? 'success' : 'error'](res.data.guardrail_pass ? 'AI test passed the guardrail.' : 'AI test failed the guardrail.')
        else if (res.data.sent) toast.success('Test sent through the gate.')
        else toast.error('Test blocked by the gate — see the result.')
        return
      }

      // ── AI conversation → POST /api/comms/conversations/start ────────────────
      if (tab === 'ai') {
        const payload: Record<string, unknown> = {
          agent_key: agentKey,
          channel,
          to,
          member_id: undefined,
          purpose: aiPurpose,
          idempotency_key: idem,
        }
        if (source === 'campaign' && selectedAsset) {
          payload.seed_asset_id = selectedAsset.asset_id
          payload.seed_asset_table = selectedAsset.source_table
        } else {
          payload.opening_body = body
        }
        const res = await postJson<GateOutcome>('/api/comms/conversations/start', payload)
        if (!res.ok) {
          toast.error(firstFieldError(res.error).message)
          return
        }
        setOutcome(res.data)
        if (res.data.sent) toast.success('AI conversation initiated — auto-reply armed.')
        else toast.error('Blocked by the gate — conversation not armed.')
        return
      }

      // ── Individual SMS / email → POST /api/comms/send ────────────────────────
      const payload: Record<string, unknown> = { channel, to, idempotency_key: idem }
      if (source === 'campaign' && selectedAsset) {
        payload.source_kind = 'campaign_asset'
        payload.source_asset_id = selectedAsset.asset_id
        payload.source_asset_table = selectedAsset.source_table
      } else {
        payload.source_kind = 'blank'
        payload.body = body
        payload.human_authored = true
        if (channel === 'email') payload.subject = subject
        if (purpose) payload.purpose = purpose
      }
      const res = await postJson<GateOutcome>('/api/comms/send', payload)
      if (!res.ok) {
        toast.error(firstFieldError(res.error).message)
        return
      }
      setOutcome(res.data)
      if (res.data.idempotent) toast.message('Already sent (idempotent).')
      else if (res.data.sent) toast.success('Message sent through the gate.')
      else toast.error('Blocked by the gate — see the result.')
    } finally {
      setSending(false)
    }
  }, [testMode, tab, channel, to, selectedTestId, source, selectedAsset, body, subject, purpose, agentKey, aiPurpose, liveAi, campaignKey])

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      {/* ── Left column: compose ── */}
      <div className="space-y-4">
        <RecipientPanel
          testMode={testMode}
          to={to}
          setTo={setTo}
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          city={city}
          setCity={setCity}
          channel={channel}
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Channel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Was a hand-rolled `role="tablist"` with no aria-controls, no tabpanel,
                and no roving tabindex — a keyboard user tabbed through every option
                and a screen reader announced tabs controlling nothing. Modelled as a
                radiogroup rather than tabs: it selects a value that reconfigures the
                composer, it does not switch between sibling panels. */}
            <Segmented<Tab>
              label="Channel"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'sms', label: 'SMS' },
                { value: 'email', label: 'Email' },
                { value: 'ai', label: 'AI conversation' },
              ]}
            />
            {tab === 'ai' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ai-channel">Deliver on</Label>
                  <Select id="ai-channel" value={aiChannel} onChange={(e) => setAiChannel(e.target.value as Channel)}>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent">Agent</Label>
                  <Select id="agent" value={agentKey} onChange={(e) => setAgentKey(e.target.value)}>
                    <option value="">Select an agent…</option>
                    {agents.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="ai-purpose">Purpose</Label>
                  <Select id="ai-purpose" value={aiPurpose} onChange={(e) => setAiPurpose(e.target.value)}>
                    {MANUAL_PURPOSES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </div>
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  The opener is green-zone only (invite / educate / schedule). The AI never recommends a product or makes a suitability call; the opener self-identifies as an automated assistant and the STOP/HELP opt-out is added automatically. A securities-flagged contact cannot be started.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <SourceSelector
          source={source}
          setSource={setSource}
          isAi={tab === 'ai'}
          channel={channel}
          body={body}
          setBody={setBody}
          subject={subject}
          setSubject={setSubject}
          purpose={purpose}
          setPurpose={setPurpose}
          assets={assets}
          assetsLoading={assetsLoading}
          assetQuery={assetQuery}
          setAssetQuery={setAssetQuery}
          reloadAssets={loadAssets}
          selectedAsset={selectedAsset}
          setSelectedAsset={setSelectedAsset}
        />
      </div>

      {/* ── Right column: preview, actions, result ── */}
      <div className="space-y-4">
        <PreviewPane preview={preview} loading={previewLoading} channel={channel} onPreview={runPreview} />

        <TestModePanel
          testMode={testMode}
          setTestMode={setTestMode}
          recipients={testRecipients}
          selectedTestId={selectedTestId}
          setSelectedTestId={setSelectedTestId}
          reload={loadTestRecipients}
        />

        <Card>
          <CardContent className="space-y-3 pt-5">
            <Button onClick={handleSend} disabled={!canSend || sending} loading={sending} className="w-full">
              {testMode ? 'Run test through the gate' : tab === 'ai' ? 'Initiate AI conversation' : 'Send now'}
            </Button>
            {tab === 'ai' && testMode && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={liveAi} onChange={(e) => setLiveAi(e.target.checked)} />
                Also live-send the opener to my verified test destination
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              Individual and test sends don&apos;t require consent on file. Every other gate step still runs — quiet hours, DNC/opt-out, the securities firewall, and the recommendation red-line. A blocked send shows the failing step and reason.
            </p>
            <GateBanner outcome={outcome} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ── Recipient panel ───────────────────────────────────────────────────────────
function RecipientPanel(props: {
  testMode: boolean
  to: string
  setTo: (v: string) => void
  firstName: string
  setFirstName: (v: string) => void
  lastName: string
  setLastName: (v: string) => void
  city: string
  setCity: (v: string) => void
  channel: Channel
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Recipient</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.testMode ? (
          <p className="rounded-md border border-status-assumption/40 bg-status-assumption/10 px-3 py-2 text-sm text-status-assumption">
            Test mode is on — the message is sent to your verified test destination below, not to this recipient.
          </p>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="to">{props.channel === 'email' ? 'Email address' : 'Mobile number'}</Label>
            <Input
              id="to"
              value={props.to}
              onChange={(e) => props.setTo(e.target.value)}
              placeholder={props.channel === 'email' ? 'name@example.com' : '+1 214 555 1234'}
              inputMode={props.channel === 'email' ? 'email' : 'tel'}
            />
            <p className="text-xs text-muted-foreground">
              The advisor + agency identity, DNC/opt-out, and quiet hours are resolved and enforced by the gate at send time. An individual send does not require consent on file — but an explicit opt-out still blocks it.
            </p>
          </div>
        )}
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">Personalization (optional)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="fn">First name</Label>
              <Input id="fn" value={props.firstName} onChange={(e) => props.setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ln">Last name</Label>
              <Input id="ln" value={props.lastName} onChange={(e) => props.setLastName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ci">City</Label>
              <Input id="ci" value={props.city} onChange={(e) => props.setCity(e.target.value)} />
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

// ── Source selector ─────────────────────────────────────────────────────────
function SourceSelector(props: {
  source: Source
  setSource: (s: Source) => void
  isAi: boolean
  channel: Channel
  body: string
  setBody: (v: string) => void
  subject: string
  setSubject: (v: string) => void
  purpose: string
  setPurpose: (v: string) => void
  assets: AssetGroup[]
  assetsLoading: boolean
  assetQuery: string
  setAssetQuery: (v: string) => void
  reloadAssets: () => void
  selectedAsset: AssetRow | null
  setSelectedAsset: (a: AssetRow | null) => void
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Message source</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Segmented<Source>
          label="Message source"
          value={props.source}
          onChange={props.setSource}
          options={[
            { value: 'blank', label: props.isAi ? 'Blank opener' : 'Blank compose' },
            { value: 'campaign', label: 'From a campaign' },
          ]}
        />

        {props.source === 'blank' ? (
          <div className="space-y-2">
            {props.channel === 'email' && !props.isAi && (
              <div className="space-y-1">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={props.subject} onChange={(e) => props.setSubject(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="body">{props.isAi ? 'Opening message' : 'Message'}</Label>
              <Textarea id="body" rows={6} value={props.body} onChange={(e) => props.setBody(e.target.value)} placeholder="Education / invitation only — no product or investment recommendation." />
            </div>
            {!props.isAi && (
              <div className="space-y-1">
                <Label htmlFor="purpose">Purpose (optional)</Label>
                <Select id="purpose" value={props.purpose} onChange={(e) => props.setPurpose(e.target.value)}>
                  <option value="">— none —</option>
                  {MANUAL_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A licensed operator authoring a 1:1 message is the content approval; recommendation language is still blocked. The email opt-out footer and the SMS STOP/HELP opt-out are added automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={props.assetQuery} onChange={(e) => props.setAssetQuery(e.target.value)} placeholder="Search assets…" onKeyDown={(e) => e.key === 'Enter' && props.reloadAssets()} />
              <Button variant="outline" onClick={props.reloadAssets}>
                Search
              </Button>
            </div>
            {props.assetsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : props.assets.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No {props.channel} assets found. Try another channel or clear the search.
              </p>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {props.assets.map((g) => (
                  <div key={g.key}>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
                    <div className="space-y-1">
                      {g.assets.map((a) => {
                        const selected = props.selectedAsset?.asset_id === a.asset_id && props.selectedAsset?.source_table === a.source_table
                        return (
                          <button
                            key={`${a.source_table}:${a.asset_id}`}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => props.setSelectedAsset(a)}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                              selected ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                            )}
                          >
                            <span className="truncate">{a.name ?? 'Untitled asset'}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              <Badge variant="outline" className="text-[10px]">
                                {a.kind}
                              </Badge>
                              {a.approval_status && a.approval_status !== 'approved' && (
                                <Badge variant="draft" className="text-[10px]">
                                  {a.approval_status}
                                </Badge>
                              )}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {props.selectedAsset && props.selectedAsset.approval_status && props.selectedAsset.approval_status !== 'approved' && (
              <p className="text-xs text-status-pending">
                This asset is not approved yet — the gate will block the send until it is approved.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Preview pane ─────────────────────────────────────────────────────────────
function PreviewPane(props: { preview: Record<string, unknown> | null; loading: boolean; channel: Channel; onPreview: () => void }) {
  const p = props.preview
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Preview</CardTitle>
        <Button variant="outline" size="sm" onClick={props.onPreview} loading={props.loading}>
          Render
        </Button>
      </CardHeader>
      <CardContent>
        {props.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !p ? (
          <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            Render a preview to see exactly what will be sent — the same renderer the send path uses.
          </p>
        ) : p.opening_turn ? (
          <div className="space-y-2">
            <Badge variant="secondary">AI opening turn</Badge>
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{String(p.opening_turn)}</p>
            {p.note ? <p className="text-xs text-muted-foreground">{String(p.note)}</p> : null}
          </div>
        ) : props.channel === 'sms' || p.segment ? (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{String(p.body ?? '')}</p>
            {p.segment ? (
              <p className="text-xs text-muted-foreground">
                {(p.segment as { encoding: string }).encoding} · {(p.segment as { length: number }).length} chars · {(p.segment as { segments: number }).segments} segment(s)
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {p.subject ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Subject: </span>
                {String(p.subject)}
              </p>
            ) : null}
            <iframe title="Email preview" sandbox="" className="h-72 w-full rounded-md border bg-white" srcDoc={String(p.html ?? '')} />
            {p.note ? <p className="text-xs text-muted-foreground">{String(p.note)}</p> : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Test-mode panel (allowlist management + selection) ───────────────────────
function TestModePanel(props: {
  testMode: boolean
  setTestMode: (v: boolean) => void
  recipients: TestRecipient[]
  selectedTestId: string
  setSelectedTestId: (v: string) => void
  reload: () => void
}) {
  const [addChannel, setAddChannel] = useState<Channel>('sms')
  const [addAddress, setAddAddress] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [adding, setAdding] = useState(false)

  const add = async () => {
    setAdding(true)
    const res = await postJson<{ recipient_id: string; code_sent: boolean; blocked?: boolean; reason?: string }>('/api/comms/test/recipients', {
      channel: addChannel,
      address: addAddress,
      label: addLabel || undefined,
    })
    setAdding(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (res.data.blocked) toast.warning(`Verification code blocked by the gate: ${res.data.reason ?? 'see the gate'}`)
    else toast.success('Verification code sent — enter it to verify this destination.')
    setAddAddress('')
    setAddLabel('')
    props.reload()
  }

  const remove = async (id: string) => {
    const res = await deleteJson(`/api/comms/test/recipients/${id}`)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (props.selectedTestId === id) props.setSelectedTestId('')
    props.reload()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Test mode</span>
          <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <input type="checkbox" checked={props.testMode} onChange={(e) => props.setTestMode(e.target.checked)} />
            Send to a verified self destination
          </label>
        </CardTitle>
      </CardHeader>
      {props.testMode && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A test is a real gated send to a destination you own and verified — it proves the pipeline. Test rows never enroll, never advance a campaign, and never touch production analytics.
          </p>

          {props.recipients.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="test-dest">Destination</Label>
              <Select id="test-dest" value={props.selectedTestId} onChange={(e) => props.setSelectedTestId(e.target.value)}>
                <option value="">Select a verified destination…</option>
                {props.recipients
                  .filter((r) => r.verified_at)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label ? `${r.label} · ` : ''}
                      {r.address} ({r.channel})
                    </option>
                  ))}
              </Select>
            </div>
          )}

          {/* Unverified rows with inline verify */}
          {props.recipients
            .filter((r) => !r.verified_at)
            .map((r) => (
              <VerifyRow key={r.id} recipient={r} onRemove={() => remove(r.id)} onVerified={props.reload} />
            ))}

          {/* Add a destination */}
          <details className="rounded-md border p-2">
            <summary className="cursor-pointer text-sm text-muted-foreground">Add a test destination</summary>
            <div className="mt-2 space-y-2">
              <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                <Select value={addChannel} onChange={(e) => setAddChannel(e.target.value as Channel)}>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </Select>
                <Input value={addAddress} onChange={(e) => setAddAddress(e.target.value)} placeholder={addChannel === 'email' ? 'me@example.com' : '+1 214 555 1234'} />
              </div>
              <Input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Label (optional, e.g. my cell)" />
              <Button variant="outline" size="sm" onClick={add} loading={adding} disabled={!addAddress.trim()}>
                Send verification code
              </Button>
            </div>
          </details>
        </CardContent>
      )}
    </Card>
  )
}

// ── Per-row verify (owns its own code input) ─────────────────────────────────
function VerifyRow({ recipient, onRemove, onVerified }: { recipient: TestRecipient; onRemove: () => void; onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const verify = async () => {
    setBusy(true)
    const res = await patchJson<{ verified: boolean }>(`/api/comms/test/recipients/${recipient.id}`, { code })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Destination verified.')
    onVerified()
  }
  return (
    <div className="rounded-md border border-status-pending/40 bg-status-pending/5 p-2 text-sm">
      <div className="flex items-center justify-between">
        <span>
          {recipient.address} <span className="text-muted-foreground">({recipient.channel}) — unverified</span>
        </span>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
        <Button variant="outline" size="sm" onClick={verify} loading={busy} disabled={code.trim().length < 4}>
          Verify
        </Button>
      </div>
    </div>
  )
}

// ── Gate banner (result, no override) ────────────────────────────────────────
function GateBanner({ outcome }: { outcome: GateOutcome | null }) {
  if (!outcome) return null
  if (outcome.ai_test) {
    return (
      <div className={cn('rounded-md border p-3 text-sm', outcome.guardrail_pass ? 'border-status-active/40 bg-status-active/5' : 'border-destructive/40 bg-destructive/5')}>
        <p className="font-medium">{outcome.guardrail_pass ? 'AI guardrail: passed' : 'AI guardrail: failed'}</p>
        {outcome.failures && outcome.failures.length > 0 && <p className="mt-1 text-muted-foreground">{outcome.failures.join(', ')}</p>}
        {outcome.live && (
          <p className="mt-1 text-muted-foreground">
            Live self-send: {outcome.live.sent ? 'sent' : `blocked (${outcome.live.blocked_step ?? 'gate'})`}
          </p>
        )}
      </div>
    )
  }
  const good = outcome.sent
  return (
    <div className={cn('rounded-md border p-3 text-sm', good ? 'border-status-active/40 bg-status-active/5' : 'border-destructive/40 bg-destructive/5')}>
      <p className="font-medium">{good ? 'Sent through the gate' : 'Blocked by the gate'}</p>
      {!good && (
        <p className="mt-1 text-muted-foreground">
          {outcome.blocked_step ? <span className="font-mono">{outcome.blocked_step}</span> : null} {outcome.reason ?? ''}
        </p>
      )}
      {good && outcome.message_id && <p className="mt-1 text-xs text-muted-foreground">Message {outcome.message_id}</p>}
    </div>
  )
}
