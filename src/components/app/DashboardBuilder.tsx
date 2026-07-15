'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus, Trash2, LayoutDashboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { DASHBOARD_WIDGETS, widgetDef } from '@/lib/analytics/catalog'
import { DashboardCreateSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

// OS-01 Custom dashboard builder (A5/A1). Name a dashboard and choose an ordered
// set of widgets. Every widget renders from a DB-derived metric — the layout only
// pins WHICH widgets and in WHAT order, so a dashboard can't drift from the data.
export function DashboardBuilder() {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [visibility, setVisibility] = React.useState<'private' | 'shared'>('private')
  const [layout, setLayout] = React.useState<string[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const available = DASHBOARD_WIDGETS.filter((w) => !layout.includes(w.key))

  function addWidget(key: string) {
    if (layout.length >= 24 || layout.includes(key)) return
    setLayout((l) => [...l, key])
  }
  function removeWidget(key: string) {
    setLayout((l) => l.filter((k) => k !== key))
  }
  function move(index: number, dir: -1 | 1) {
    setLayout((l) => {
      const next = [...l]
      const j = index + dir
      if (j < 0 || j >= next.length) return l
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const payload = {
      name,
      description: description.trim() ? description.trim() : undefined,
      visibility,
      layout,
    }
    const parsed = DashboardCreateSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      toast.error(fe.layout?.[0] ?? 'Please fix the highlighted fields.')
      return
    }
    setSaving(true)
    const res = await postJson<{ dashboard: { id: string } }>('/api/dashboards', parsed.data)
    setSaving(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    toast.success('Dashboard created.')
    router.push(`/app/dashboards/${res.data.dashboard.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Dashboard name" required error={errors.name}>
          <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My production dashboard" />
        </Field>
        <Field id="visibility" label="Visibility" hint="Shared dashboards are visible to internal staff.">
          <Select id="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'shared')}>
            <option value="private">private</option>
            <option value="shared">shared</option>
          </Select>
        </Field>
      </div>
      <Field id="description" label="Description" error={errors.description}>
        <Textarea id="description" name="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this dashboard is for." />
      </Field>

      {/* Selected widgets (ordered) */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Widgets{layout.length > 0 ? ` (${layout.length})` : ''}</h2>
        {errors.layout ? <p className="text-xs text-destructive">{errors.layout}</p> : null}
        {layout.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
            No widgets yet — add at least one from the catalog below.
          </div>
        ) : (
          <ol className="space-y-2">
            {layout.map((key, i) => {
              const def = widgetDef(key)
              return (
                <li key={key} className="flex items-center gap-2 rounded-md border p-2">
                  <span className="w-6 text-center text-sm text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{def?.label ?? key}</p>
                    <p className="text-xs capitalize text-muted-foreground">{def?.kind}</p>
                  </div>
                  <Button type="button" size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${def?.label ?? key} up`}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={i === layout.length - 1} aria-label={`Move ${def?.label ?? key} down`}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" onClick={() => removeWidget(key)} aria-label={`Remove ${def?.label ?? key}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {/* Widget catalog */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Add a widget</h2>
        {available.length === 0 ? (
          <p className="text-xs text-muted-foreground">Every catalog widget is on this dashboard.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => addWidget(w.key)}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:border-primary/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{w.label}</span>
                  <span className="block text-xs capitalize text-muted-foreground">{w.kind}</span>
                </span>
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create dashboard'}</Button>
      </div>
    </form>
  )
}
