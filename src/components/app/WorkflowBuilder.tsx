'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { WORKFLOW_TRIGGERS, WorkflowCreateSchema } from '@/lib/validation/schemas'
import { postJson, patchJson, firstFieldError } from '@/lib/client/api'

const CONDITION_OPS = ['eq', 'neq', 'gt', 'lt', 'contains', 'exists'] as const
const STEP_TYPES = ['action', 'delay', 'branch'] as const
const STEP_ACTIONS = ['create_task', 'log_activity', 'enqueue_sequence', 'notify_fsa'] as const
const BACKOFFS = ['fixed', 'exponential'] as const

type ConditionOp = (typeof CONDITION_OPS)[number]
type StepType = (typeof STEP_TYPES)[number]
type StepAction = (typeof STEP_ACTIONS)[number]
type Backoff = (typeof BACKOFFS)[number]

interface ConditionRow {
  field: string
  op: ConditionOp
  value: string
}
interface StepRow {
  type: StepType
  action: StepAction
  delay_hours: string
}

let rowKey = 0
const nextKey = () => `r${rowKey++}`

// ─── Create builder (A5/A6 FormShell body) ────────────────────────────────────
export function WorkflowBuilder() {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [triggerType, setTriggerType] = React.useState<(typeof WORKFLOW_TRIGGERS)[number]>('manual')
  const [conditions, setConditions] = React.useState<{ key: string; row: ConditionRow }[]>([])
  const [steps, setSteps] = React.useState<{ key: string; row: StepRow }[]>([
    { key: nextKey(), row: { type: 'action', action: 'create_task', delay_hours: '0' } },
  ])
  const [maxRetries, setMaxRetries] = React.useState('3')
  const [backoff, setBackoff] = React.useState<Backoff>('exponential')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  function addCondition() {
    if (conditions.length >= 20) return
    setConditions((c) => [...c, { key: nextKey(), row: { field: '', op: 'eq', value: '' } }])
  }
  function updateCondition(key: string, patch: Partial<ConditionRow>) {
    setConditions((c) => c.map((x) => (x.key === key ? { ...x, row: { ...x.row, ...patch } } : x)))
  }
  function removeCondition(key: string) {
    setConditions((c) => c.filter((x) => x.key !== key))
  }

  function addStep() {
    if (steps.length >= 30) return
    setSteps((s) => [...s, { key: nextKey(), row: { type: 'action', action: 'create_task', delay_hours: '0' } }])
  }
  function updateStep(key: string, patch: Partial<StepRow>) {
    setSteps((s) => s.map((x) => (x.key === key ? { ...x, row: { ...x.row, ...patch } } : x)))
  }
  function removeStep(key: string) {
    setSteps((s) => s.filter((x) => x.key !== key))
  }

  function buildPayload() {
    return {
      name,
      description: description.trim() ? description.trim() : undefined,
      trigger_type: triggerType,
      trigger_config: {},
      conditions: conditions.map(({ row }) => ({
        field: row.field,
        op: row.op,
        ...(row.op === 'exists' ? {} : { value: row.value }),
      })),
      steps: steps.map(({ row }) => {
        if (row.type === 'action') return { type: 'action' as const, action: row.action, config: {} }
        if (row.type === 'delay') return { type: 'delay' as const, delay_hours: Number(row.delay_hours || 0), config: {} }
        return { type: 'branch' as const, config: {} }
      }),
      failure_policy: { max_retries: Number(maxRetries || 0), backoff },
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const payload = buildPayload()
    const parsed = WorkflowCreateSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      toast.error('Please fix the highlighted fields.')
      return
    }
    setSaving(true)
    const res = await postJson<{ workflow: { id: string } }>('/api/workflows', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Workflow created as draft (disabled). Enable it when ready.')
    router.push(`/app/workflows/${res.data.workflow.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Comm-sending steps still pass the comms dispatcher gate — consent, quiet-hours, DNC, and securities checks are enforced and never bypassed. New workflows start disabled.</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" required error={errors.name}>
          <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="trigger_type" label="Trigger" required error={errors.trigger_type}>
          <Select id="trigger_type" value={triggerType} onChange={(e) => setTriggerType(e.target.value as (typeof WORKFLOW_TRIGGERS)[number])}>
            {WORKFLOW_TRIGGERS.map((t) => (<option key={t} value={t}>{t.replace(/_/g, ' ')}</option>))}
          </Select>
        </Field>
      </div>
      <Field id="description" label="Description" error={errors.description}>
        <Textarea id="description" name="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      {/* Conditions */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Conditions</h2>
          <Button type="button" size="sm" variant="outline" onClick={addCondition} disabled={conditions.length >= 20}>
            <Plus className="h-4 w-4" /> Add condition
          </Button>
        </div>
        {errors.conditions ? <p className="text-xs text-destructive">{errors.conditions}</p> : null}
        {conditions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No conditions — the workflow runs for every matching trigger.</p>
        ) : (
          <div className="space-y-2">
            {conditions.map(({ key, row }) => (
              <div key={key} className="grid grid-cols-[1fr_8rem_1fr_auto] items-center gap-2">
                <Input aria-label="Field" placeholder="field (e.g. stage)" value={row.field} onChange={(e) => updateCondition(key, { field: e.target.value })} />
                <Select aria-label="Operator" value={row.op} onChange={(e) => updateCondition(key, { op: e.target.value as ConditionOp })}>
                  {CONDITION_OPS.map((o) => (<option key={o} value={o}>{o}</option>))}
                </Select>
                <Input aria-label="Value" placeholder="value" value={row.value} disabled={row.op === 'exists'} onChange={(e) => updateCondition(key, { value: e.target.value })} />
                <Button type="button" size="icon" variant="ghost" onClick={() => removeCondition(key)} aria-label="Remove condition">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Steps */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Steps</h2>
          <Button type="button" size="sm" variant="outline" onClick={addStep} disabled={steps.length >= 30}>
            <Plus className="h-4 w-4" /> Add step
          </Button>
        </div>
        {errors.steps ? <p className="text-xs text-destructive">{errors.steps}</p> : null}
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">Add at least one step for the workflow to do anything.</p>
        ) : (
          <ol className="space-y-2">
            {steps.map(({ key, row }, i) => (
              <li key={key} className="grid grid-cols-[2rem_9rem_1fr_auto] items-center gap-2">
                <span className="text-sm text-muted-foreground">{i + 1}.</span>
                <Select aria-label="Step type" value={row.type} onChange={(e) => updateStep(key, { type: e.target.value as StepType })}>
                  {STEP_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                </Select>
                {row.type === 'action' ? (
                  <Select aria-label="Action" value={row.action} onChange={(e) => updateStep(key, { action: e.target.value as StepAction })}>
                    {STEP_ACTIONS.map((a) => (<option key={a} value={a}>{a.replace(/_/g, ' ')}</option>))}
                  </Select>
                ) : row.type === 'delay' ? (
                  <Input aria-label="Delay hours" type="number" min={0} max={8760} value={row.delay_hours} onChange={(e) => updateStep(key, { delay_hours: e.target.value })} placeholder="delay hours" />
                ) : (
                  <span className="text-xs text-muted-foreground">Branch — routes based on conditions.</span>
                )}
                <Button type="button" size="icon" variant="ghost" onClick={() => removeStep(key)} aria-label="Remove step">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Failure policy */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Failure policy</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="max_retries" label="Max retries" error={errors.failure_policy}>
            <Input id="max_retries" type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} />
          </Field>
          <Field id="backoff" label="Backoff">
            <Select id="backoff" value={backoff} onChange={(e) => setBackoff(e.target.value as Backoff)}>
              {BACKOFFS.map((b) => (<option key={b} value={b}>{b}</option>))}
            </Select>
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create workflow'}</Button>
      </div>
    </form>
  )
}

// ─── Detail controls: enable/disable + archive ────────────────────────────────
export function WorkflowControls({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function toggle() {
    setBusy(true)
    const res = await patchJson(`/api/workflows/${id}`, { enabled: !enabled })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success(!enabled ? 'Workflow enabled.' : 'Workflow disabled.')
    router.refresh()
  }

  async function archive() {
    setBusy(true)
    const res = await patchJson(`/api/workflows/${id}`, { archived: true })
    setBusy(false)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success('Workflow archived.')
    router.push('/app/workflows')
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={toggle} disabled={busy} variant={enabled ? 'outline' : 'default'}>
        {enabled ? 'Disable' : 'Enable'}
      </Button>
      <Button size="sm" variant="outline" onClick={archive} disabled={busy}>Archive</Button>
    </div>
  )
}
