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

const STEPS = ['Audience', 'Template', 'Schedule', 'Confirm', 'Review']

// A6 builder: audience → approved template → schedule → consent/quiet-hours ack → review.
// Only APPROVED templates are selectable — an unapproved template cannot be attached.
export function CampaignBuilder({ templates }: { templates: { id: string; name: string; channel: string; category: string }[] }) {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({ name: '', channel: 'email', category: 'educational', template_id: '', audience: 'all_consented', schedule_at: '', ack: false })

  function set<K extends keyof typeof form>(k: K, val: (typeof form)[K]) { setForm((f) => ({ ...f, [k]: val })) }
  const channelTemplates = templates.filter((t) => t.channel === form.channel)

  async function submit() {
    if (!form.ack) { toast.error('Confirm consent + quiet-hours to continue.'); return }
    if (!form.template_id) { toast.error('Select an approved template.'); return }
    setSaving(true)
    const res = await postJson<{ campaign: { id: string } }>('/api/comms/campaigns', {
      name: form.name, channel: form.channel, category: form.category, template_id: form.template_id,
      audience: { kind: form.audience }, schedule_at: form.schedule_at || undefined, quiet_hours_ack: form.ack,
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
        </div>
      ) : null}
      {step === 2 ? (
        <Field id="schedule_at" label="Schedule (optional)" hint="Blank = dispatch on activation"><Input id="schedule_at" type="datetime-local" value={form.schedule_at} onChange={(e) => set('schedule_at', e.target.value)} /></Field>
      ) : null}
      {step === 3 ? (
        <label className="flex items-start gap-2 rounded-md border border-status-pending/30 bg-status-pending/10 p-3 text-sm">
          <input type="checkbox" checked={form.ack} onChange={(e) => set('ack', e.target.checked)} className="mt-1" />
          <span>I confirm this campaign only targets consented recipients within quiet hours, and every send passes the 7-step gate. There is no force-send.</span>
        </label>
      ) : null}
      {step === 4 ? (
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {form.name || '—'}</p>
          <p><span className="text-muted-foreground">Channel:</span> {form.channel}</p>
          <p><span className="text-muted-foreground">Template:</span> {templates.find((t) => t.id === form.template_id)?.name ?? '—'}</p>
          <p><span className="text-muted-foreground">Audience:</span> {form.audience}</p>
          <p><span className="text-muted-foreground">Consent/quiet-hours confirmed:</span> {form.ack ? 'yes' : 'no'}</p>
        </div>
      ) : null}
    </WizardShell>
  )
}

export function CampaignActivateControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function act(action: 'activate' | 'pause') {
    setBusy(true)
    const res = await postJson<{ dispatched?: { sent: number; suppressed: number; audience: number }; note?: string }>(`/api/comms/campaigns/${id}`, { action })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    if (action === 'activate' && res.data.dispatched) {
      const d = res.data.dispatched
      toast.success(`Dispatched through the gate: ${d.sent} sent, ${d.suppressed} suppressed of ${d.audience}.${res.data.note ? ' ' + res.data.note : ''}`)
    } else toast.success(`Campaign ${action}d`)
    router.refresh()
  }

  return (
    <div className="flex gap-2">
      {status !== 'active' ? <Button size="sm" onClick={() => act('activate')} disabled={busy}>Activate + dispatch</Button> : <Button size="sm" variant="outline" onClick={() => act('pause')} disabled={busy}>Pause</Button>}
    </div>
  )
}
