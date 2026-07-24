'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/forms/Field'
import { WizardShell } from '@/components/archetypes'
import { TEMPLATE_CATEGORY } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'
import { MESSAGE_PURPOSES } from '@/lib/comms/purpose'
import { CLAIM_FIELD_KEYS } from '@/lib/comms/claims'

const STEPS = ['Audience', 'Template', 'Schedule', 'Confirm', 'Review']

/** An ACTIVE delegation the FSA may send under, paired with its represented agency owner. */
export interface DelegationOption {
  id: string
  ownerId: string
  ownerName: string
}

// A6 builder: audience → approved template → schedule → consent/quiet-hours ack → review.
// Only APPROVED templates are selectable — an unapproved template cannot be attached.
export function CampaignBuilder({ templates, delegations = [] }: { templates: { id: string; name: string; channel: string; category: string }[]; delegations?: DelegationOption[] }) {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({ name: '', channel: 'email', category: 'educational', template_id: '', audience: 'all_consented', schedule_at: '', ack: false, purpose: '', delegation_id: '' })
  const [claimFields, setClaimFields] = React.useState<string[]>([])

  function set<K extends keyof typeof form>(k: K, val: (typeof form)[K]) { setForm((f) => ({ ...f, [k]: val })) }
  function toggleClaim(key: string) { setClaimFields((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key])) }
  const channelTemplates = templates.filter((t) => t.channel === form.channel)

  async function submit() {
    if (!form.ack) { toast.error('Confirm consent + quiet-hours to continue.'); return }
    if (!form.template_id) { toast.error('Select an approved template.'); return }
    setSaving(true)
    // Slice 7 — a chosen delegation carries its represented agency owner (set together).
    const chosen = delegations.find((d) => d.id === form.delegation_id)
    const res = await postJson<{ campaign: { id: string } }>('/api/comms/campaigns', {
      name: form.name, channel: form.channel, category: form.category, template_id: form.template_id,
      audience: { kind: form.audience }, schedule_at: form.schedule_at || undefined, quiet_hours_ack: form.ack,
      ...(form.purpose ? { purpose: form.purpose } : {}),
      ...(chosen ? { delegation_id: chosen.id, represented_agency_owner_id: chosen.ownerId } : {}),
      ...(claimFields.length > 0 ? { claim_fields: claimFields } : {}),
    })
    setSaving(false)
    if (!res.ok) {
      if (res.error.reason === 'unapproved_template') { toast.error('That template is not approved. Only approved templates can be used.'); return }
      toast.error(firstFieldError(res.error).message); return
    }
    toast.success('Campaign created. Activate to dispatch through the gate.')
    router.push(`/app/comms/campaigns/${res.data.campaign.id}`)
  }

  return (
    <WizardShell
      title="New Campaign"
      steps={STEPS}
      current={step}
      footer={
        <>
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={step === 1 && !form.template_id}>Next</Button>
          ) : (
            <Button onClick={submit} disabled={saving || !form.ack || !form.template_id}>{saving ? 'Creating…' : 'Create campaign'}</Button>
          )}
        </>
      }
    >
      {step === 0 ? (
        <div className="space-y-4">
          <Field id="name" label="Campaign name" required><Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field id="channel" label="Channel"><Select id="channel" value={form.channel} onChange={(e) => { set('channel', e.target.value); set('template_id', '') }}><option value="email">email</option><option value="sms">sms</option></Select></Field>
          <Field id="audience" label="Audience" hint="The gate re-checks every recipient at send time"><Select id="audience" value={form.audience} onChange={(e) => set('audience', e.target.value)}><option value="all_consented">All consented members</option><option value="cross_sell">Cross-sell gap households</option><option value="conversion">Conversion-due households</option></Select></Field>
          <Field id="purpose" label="Message purpose" hint="Drives purpose-scoped consent, frequency caps + priority collision at dispatch">
            <Select id="purpose" value={form.purpose} onChange={(e) => set('purpose', e.target.value)}>
              <option value="">— None (channel-wide consent) —</option>
              {MESSAGE_PURPOSES.map((p) => (<option key={p} value={p}>{p.replace(/_/g, ' ').toLowerCase()}</option>))}
            </Select>
          </Field>
          {delegations.length > 0 ? (
            <Field id="delegation" label="Send on behalf of (delegated)" hint="Only ACTIVE delegations appear. The gate re-verifies the delegation per send.">
              <Select id="delegation" value={form.delegation_id} onChange={(e) => set('delegation_id', e.target.value)}>
                <option value="">— None (direct FSA send) —</option>
                {delegations.map((d) => (<option key={d.id} value={d.id}>On behalf of {d.ownerName}</option>))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}
      {step === 1 ? (
        <div className="space-y-4">
          <Field id="template_id" label="Approved template" required hint="Only approved templates appear here">
            <Select id="template_id" value={form.template_id} onChange={(e) => set('template_id', e.target.value)}>
              <option value="">— Select —</option>
              {channelTemplates.map((t) => (<option key={t.id} value={t.id}>{t.name} ({t.category})</option>))}
            </Select>
          </Field>
          {channelTemplates.length === 0 ? <p className="text-sm text-muted-foreground">No approved {form.channel} templates. Create + approve one first.</p> : null}
          <Field id="category" label="Category"><Select id="category" value={form.category} onChange={(e) => set('category', e.target.value)}>{TEMPLATE_CATEGORY.map((c) => (<option key={c} value={c}>{c.replace(/_/g, ' ')}</option>))}</Select></Field>
          <Field id="claim_fields" label="Specific claims this message makes" hint="If the message states a deadline, coverage status, or appointment time, check it. Each is verified per recipient at send time — an unverified one is excluded, never guessed (§13).">
            <div className="space-y-1">
              {CLAIM_FIELD_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={claimFields.includes(k)} onChange={() => toggleClaim(k)} className="h-4 w-4 rounded border-input" />
                  <span>{k.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>
          </Field>
        </div>
      ) : null}
      {step === 2 ? (
        <Field id="schedule_at" label="Schedule (optional)" hint="Blank = dispatch on activation"><Input id="schedule_at" type="datetime-local" value={form.schedule_at} onChange={(e) => set('schedule_at', e.target.value)} /></Field>
      ) : null}
      {step === 3 ? (
        <label className="flex items-start gap-2 rounded-md border border-status-pending/30 bg-status-pending/10 p-3 text-sm">
          <input type="checkbox" checked={form.ack} onChange={(e) => set('ack', e.target.checked)} className="mt-1" />
          <span>I confirm this campaign only targets consented recipients within quiet hours, and every send passes the full compliance gate. There is no force-send.</span>
        </label>
      ) : null}
      {step === 4 ? (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {form.name || '—'}</p>
          <p><span className="text-muted-foreground">Channel:</span> {form.channel}</p>
          <p><span className="text-muted-foreground">Template:</span> {templates.find((t) => t.id === form.template_id)?.name ?? '—'}</p>
          <p><span className="text-muted-foreground">Audience:</span> {form.audience}</p>
          <p><span className="text-muted-foreground">Purpose:</span> {form.purpose ? form.purpose.replace(/_/g, ' ').toLowerCase() : 'none (channel-wide consent)'}</p>
          <p><span className="text-muted-foreground">On behalf of:</span> {delegations.find((d) => d.id === form.delegation_id)?.ownerName ?? 'direct FSA send'}</p>
          <p><span className="text-muted-foreground">Specific claims:</span> {claimFields.length > 0 ? claimFields.map((k) => k.replace(/_/g, ' ')).join(', ') + ' (verified per recipient)' : 'none'}</p>
          <p><span className="text-muted-foreground">Consent/quiet-hours confirmed:</span> {form.ack ? 'yes' : 'no'}</p>
        </div>
      ) : null}
    </WizardShell>
  )
}

interface SimSummary { audience: number; wouldSend: number; excluded: number; excludedByStep: Record<string, number> }

export function CampaignActivateControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<null | 'activate' | 'pause' | 'simulate'>(null)
  const [sim, setSim] = React.useState<SimSummary | null>(null)

  async function act(action: 'activate' | 'pause') {
    setBusy(action)
    const res = await postJson<{ dispatched?: { sent: number; suppressed: number; audience: number }; note?: string }>(`/api/comms/campaigns/${id}`, { action })
    setBusy(null)
    if (!res.ok) {
      // §14 — activation requires a recent simulation pass.
      if (res.error.reason === 'simulation_required') { toast.error('Run a simulation before activating this campaign (§14).'); return }
      toast.error(firstFieldError(res.error).message); return
    }
    if (action === 'activate' && res.data.dispatched) {
      const d = res.data.dispatched
      toast.success(`Dispatched through the gate: ${d.sent} sent, ${d.suppressed} suppressed of ${d.audience}.${res.data.note ? ' ' + res.data.note : ''}`)
    } else toast.success(`Campaign ${action}d`)
    router.refresh()
  }

  async function simulate() {
    setBusy('simulate')
    const res = await postJson<{ simulation: { summary: SimSummary } }>(`/api/comms/campaigns/${id}`, { action: 'simulate' })
    setBusy(null)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    const s = res.data.simulation.summary
    setSim(s)
    toast.success(`Simulation: ${s.wouldSend} would send, ${s.excluded} excluded of ${s.audience}. No messages were sent.`)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={simulate} disabled={busy !== null}>
          {busy === 'simulate' ? 'Simulating…' : 'Run simulation (safe preview)'}
        </Button>
        {status !== 'active' ? (
          <Button size="sm" onClick={() => act('activate')} disabled={busy !== null}>Activate + dispatch</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => act('pause')} disabled={busy !== null}>Pause</Button>
        )}
      </div>
      {sim && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Simulation preview (no messages sent)</p>
          <p className="text-muted-foreground">
            {sim.wouldSend} would send · {sim.excluded} excluded · {sim.audience} audience
          </p>
          {sim.excluded > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
              {Object.entries(sim.excludedByStep).map(([step, n]) => (
                <li key={step}>{step}: {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
