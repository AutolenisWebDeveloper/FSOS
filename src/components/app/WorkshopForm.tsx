'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, Upload, ShieldAlert, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { postJson, firstFieldError } from '@/lib/client/api'
import { WORKSHOP_TOPICS, DELIVERY_MODES, PRESENTER_TYPES } from '@/lib/validation/schemas'

interface AttachedPresenter {
  id: string
  name: string
  firm: string | null
  fund_family: string | null
  is_third_party: boolean
  presenter_type: string
}

// Templated, data-driven workshop authoring (spec §8 P0-C). NOT a freeform page builder —
// every workshop yields the same approvable layout. Presenters are reusable across
// workshops; attaching a third-party / fund-family presenter auto-flags the workshop as
// securities (compliance warning shown). Images reuse the shared private-bucket uploader.
export function WorkshopForm() {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [errorField, setErrorField] = React.useState<string | undefined>()

  // Core fields
  const [title, setTitle] = React.useState('')
  const [topic, setTopic] = React.useState('general')
  const [deliveryMode, setDeliveryMode] = React.useState<(typeof DELIVERY_MODES)[number]>('in_person')
  const [scheduledAt, setScheduledAt] = React.useState('')
  const [timezone, setTimezone] = React.useState('America/Chicago')
  const [venueName, setVenueName] = React.useState('')
  const [venueAddress, setVenueAddress] = React.useState('')
  const [capacityInPerson, setCapacityInPerson] = React.useState('')
  const [capacityVirtual, setCapacityVirtual] = React.useState('')
  const [hostName, setHostName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [agenda, setAgenda] = React.useState('')

  // Hero image
  const [heroRef, setHeroRef] = React.useState<string | null>(null)
  const [heroPreview, setHeroPreview] = React.useState<string | null>(null)
  const [heroBusy, setHeroBusy] = React.useState(false)

  // Presenters
  const [attached, setAttached] = React.useState<AttachedPresenter[]>([])
  const [existing, setExisting] = React.useState<AttachedPresenter[]>([])
  const [showNew, setShowNew] = React.useState(false)

  const showVenue = deliveryMode === 'in_person' || deliveryMode === 'hybrid'
  const showVirtual = deliveryMode === 'virtual' || deliveryMode === 'hybrid'
  const willBeSecurity = attached.some((p) => p.is_third_party || (p.fund_family && p.fund_family.trim() !== ''))

  React.useEffect(() => {
    fetch('/api/presenters')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setExisting(d.presenters || []))
      .catch(() => setExisting([]))
  }, [])

  async function uploadImage(file: File, kind: 'hero' | 'headshot'): Promise<string | null> {
    const fd = new FormData()
    fd.append('kind', kind)
    fd.append('file', file)
    const res = await fetch('/api/workshops/assets/upload', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || 'Upload failed')
      return null
    }
    if (kind === 'hero') setHeroPreview(data.preview_url ?? null)
    return data.storage_ref ?? null
  }

  async function onHero(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setHeroBusy(true)
    const ref = await uploadImage(file, 'hero')
    setHeroBusy(false)
    if (ref) setHeroRef(ref)
  }

  function attachExisting(id: string) {
    const p = existing.find((x) => x.id === id)
    if (p && !attached.some((a) => a.id === id)) setAttached((prev) => [...prev, p])
  }

  function detach(id: string) {
    setAttached((prev) => prev.filter((p) => p.id !== id))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setErrorField(undefined)
    const res = await postJson<{ workshop_id?: string }>('/api/workshops', {
      title,
      topic,
      description: description || undefined,
      agenda: agenda || undefined,
      scheduled_at: scheduledAt,
      delivery_mode: deliveryMode,
      host_name: hostName || undefined,
      timezone: timezone || undefined,
      venue_name: showVenue ? venueName || undefined : undefined,
      venue_address: showVenue ? venueAddress || undefined : undefined,
      capacity_in_person: showVenue && capacityInPerson ? Number(capacityInPerson) : undefined,
      capacity_virtual: showVirtual && capacityVirtual ? Number(capacityVirtual) : undefined,
      hero_image_ref: heroRef || undefined,
      presenter_ids: attached.map((p) => p.id),
    })
    setBusy(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      setErrorField(fe.field)
      toast.error(fe.message)
      return
    }
    toast.success('Workshop created as draft. Submit it for compliance review to publish.')
    router.push(`/app/workshops/${res.data.workshop_id}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ── Basics ── */}
      <section className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required aria-invalid={errorField === 'title'} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="topic">Topic</Label>
            <Select id="topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {WORKSHOP_TOPICS.map((t) => (
                <option key={t} value={t} className="capitalize">{t}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="host_name">Host / presenter of record</Label>
            <Input id="host_name" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Markist Athelus" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Educational content only — no product pitch." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agenda">Agenda</Label>
          <Textarea id="agenda" rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="What attendees will learn (one point per line)." />
        </div>
      </section>

      {/* ── Delivery + session ── */}
      <section className="space-y-4 border-t pt-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="delivery_mode">Delivery</Label>
            <Select id="delivery_mode" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as typeof deliveryMode)}>
              {DELIVERY_MODES.map((m) => (
                <option key={m} value={m}>{m === 'in_person' ? 'In person' : m === 'virtual' ? 'Virtual' : 'Hybrid'}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheduled_at">Date &amp; time</Label>
            <Input id="scheduled_at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required aria-invalid={errorField === 'scheduled_at'} />
          </div>
        </div>
        {showVenue ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="venue_name">Venue name</Label>
              <Input id="venue_name" value={venueName} onChange={(e) => setVenueName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="venue_address">Venue address</Label>
              <Input id="venue_address" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap_ip">In-person capacity</Label>
              <Input id="cap_ip" type="number" min={1} value={capacityInPerson} onChange={(e) => setCapacityInPerson(e.target.value)} />
            </div>
          </div>
        ) : null}
        {showVirtual ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cap_v">Virtual capacity</Label>
              <Input id="cap_v" type="number" min={1} value={capacityVirtual} onChange={(e) => setCapacityVirtual(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tz">Timezone</Label>
              <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">The unique join link is provisioned per registrant at reminder time (P3).</p>
          </div>
        ) : null}
      </section>

      {/* ── Hero image ── */}
      <section className="space-y-2 border-t pt-5">
        <Label htmlFor="hero">Hero image</Label>
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm hover:bg-muted">
            {heroBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            <span>{heroRef ? 'Replace image' : 'Upload image'}</span>
            <input id="hero" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onHero} />
          </label>
          {heroPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroPreview} alt="Hero preview" className="h-12 w-20 rounded object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">PNG, JPG or WebP · max 8MB</span>
          )}
        </div>
      </section>

      {/* ── Presenters ── */}
      <section className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between">
          <Label>Presenters</Label>
          <div className="flex items-center gap-2">
            {existing.length > 0 ? (
              <Select aria-label="Attach existing presenter" value="" onChange={(e) => { if (e.target.value) attachExisting(e.target.value) }} className="h-9 w-48 text-sm">
                <option value="">Attach existing…</option>
                {existing.filter((p) => !attached.some((a) => a.id === p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.firm ? ` · ${p.firm}` : ''}</option>
                ))}
              </Select>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setShowNew((s) => !s)}>
              <UserPlus className="h-4 w-4" aria-hidden /> New presenter
            </Button>
          </div>
        </div>

        {attached.length === 0 ? (
          <p className="text-sm text-muted-foreground">No presenters attached yet.</p>
        ) : (
          <ul className="space-y-2">
            {attached.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.firm ? <span className="text-muted-foreground">· {p.firm}</span> : null}
                  {p.fund_family ? <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold-deep">{p.fund_family}</span> : null}
                  {p.is_third_party ? <span className="rounded-full bg-status-security/15 px-2 py-0.5 text-xs text-status-security">Third-party</span> : null}
                </span>
                <button type="button" onClick={() => detach(p.id)} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${p.name}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {showNew ? <NewPresenter onCreated={(p) => { setAttached((prev) => [...prev, p]); setExisting((prev) => [...prev, p]); setShowNew(false) }} uploadImage={uploadImage} /> : null}

        {willBeSecurity ? (
          <div role="status" className="flex items-start gap-2 rounded-md border border-status-security/30 bg-status-security/10 px-3 py-2 text-sm text-status-security">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>A third-party / fund-family presenter is attached, so this workshop will be flagged <strong>securities</strong>: excluded from the automated comms engine and routed for FFS review. Third-party bios, logos, and slides are REQUIRES-APPROVAL.</span>
          </div>
        ) : null}
      </section>

      <div className="flex items-center gap-2 border-t pt-5">
        <Button type="submit" disabled={busy || heroBusy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Create draft
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/app/workshops')} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// Inline create-a-presenter sub-form. Persists immediately so the id can be attached.
function NewPresenter({
  onCreated,
  uploadImage,
}: {
  onCreated: (p: AttachedPresenter) => void
  uploadImage: (file: File, kind: 'headshot') => Promise<string | null>
}) {
  const [name, setName] = React.useState('')
  const [ptitle, setPtitle] = React.useState('')
  const [firm, setFirm] = React.useState('')
  const [type, setType] = React.useState<(typeof PRESENTER_TYPES)[number]>('internal')
  const [fundFamily, setFundFamily] = React.useState('')
  const [thirdParty, setThirdParty] = React.useState(false)
  const [bio, setBio] = React.useState('')
  const [headshotRef, setHeadshotRef] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onHeadshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    const ref = await uploadImage(file, 'headshot')
    setBusy(false)
    if (ref) setHeadshotRef(ref)
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Presenter name is required.')
      return
    }
    setBusy(true)
    const res = await postJson<{ id?: string; is_third_party?: boolean }>('/api/presenters', {
      name,
      title: ptitle || undefined,
      firm: firm || undefined,
      presenter_type: type,
      fund_family: fundFamily || undefined,
      is_third_party: thirdParty,
      bio: bio || undefined,
      headshot_ref: headshotRef || undefined,
    })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    onCreated({
      id: res.data.id!,
      name,
      firm: firm || null,
      fund_family: fundFamily || null,
      is_third_party: !!res.data.is_third_party,
      presenter_type: type,
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p_name">Name</Label>
          <Input id="p_name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p_title">Title</Label>
          <Input id="p_title" value={ptitle} onChange={(e) => setPtitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p_type">Type</Label>
          <Select id="p_type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {PRESENTER_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">{t}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p_firm">Firm</Label>
          <Input id="p_firm" value={firm} onChange={(e) => setFirm(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p_fund">Fund family (optional)</Label>
          <Input id="p_fund" value={fundFamily} onChange={(e) => setFundFamily(e.target.value)} placeholder="e.g. a fund company" />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-foreground/80">
            <input type="checkbox" checked={thirdParty} onChange={(e) => setThirdParty(e.target.checked)} className="h-4 w-4 accent-primary" />
            Third-party presenter
          </label>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="p_bio">Bio</Label>
        <Textarea id="p_bio" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm hover:bg-muted">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          <span>{headshotRef ? 'Headshot added' : 'Upload headshot'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onHeadshot} />
        </label>
        <Button type="button" size="sm" onClick={save} disabled={busy}>
          <Plus className="h-4 w-4" aria-hidden /> Add presenter
        </Button>
      </div>
    </div>
  )
}
