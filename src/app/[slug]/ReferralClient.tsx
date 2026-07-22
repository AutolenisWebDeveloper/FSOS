'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, Link2Off } from 'lucide-react'
import { PublicPage, PublicCard, PublicAlert } from '@/components/public/PublicShell'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CONTACT } from '@/lib/site'

// Location from the single NAP source of truth (lib/site) — not a hardcoded,
// conflicting city string. Keeps every public surface consistent.
const SUBTITLE = `Markist · Licensed FSA · ${CONTACT.address.city}, ${CONTACT.address.region}`

interface Agency {
  agency_id: string
  name: string
  owner: string
  city?: string
  slug?: string
}

const REFERRAL_TYPES = [
  { value: 'general', label: 'General Review' },
  { value: 'life', label: 'Life Insurance' },
  { value: 'retirement', label: 'Retirement Planning' },
  { value: 'conversion', label: 'Term Conversion' },
  { value: 'opra', label: 'OPRA Opportunity' },
  { value: 'business', label: 'Business Planning' },
]

export default function ReferralClient() {
  const params = useParams()
  const slug = params.slug as string

  const [agency, setAgency] = useState<Agency | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    client_name: '',
    client_email: '',
    client_phone: '',
    referral_type: 'general',
    notes: '',
  })

  // Look up the agency by slug on load so we can greet by owner name
  useEffect(() => {
    if (!slug) return
    setLoading(true)
    fetch(`/api/agencies/referral?slug=${encodeURIComponent(slug)}`)
      .then(async res => {
        if (res.status === 404) { setNotFound(true); setAgency(null); return }
        const data = await res.json()
        if (data.error) { setNotFound(true); setAgency(null); return }
        setAgency({ ...data, slug })
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.client_name.trim()) { setError('Please enter the client\'s name.'); return }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/agencies/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency_slug: slug, ...form }),
      })
      const data = await res.json()
      if (data.success) {
        setSubmitted(true)
        if (data.owner) setAgency(a => a ? { ...a, owner: data.owner } : a)
      } else {
        setError(data.error || 'Submission failed. Please try again.')
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <PublicPage>
      <PublicCard subtitle={SUBTITLE}>
        <div className="space-y-4" role="status" aria-busy>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="space-y-4 pt-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <span className="sr-only">Loading referral form…</span>
        </div>
      </PublicCard>
    </PublicPage>
  )

  if (notFound) return (
    <PublicPage>
      <PublicCard subtitle={SUBTITLE}>
        <div className="py-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Link2Off className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-foreground">Referral link not active</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This referral link is not active. Contact your agent for a new link.
          </p>
        </div>
      </PublicCard>
    </PublicPage>
  )

  if (submitted) return (
    <PublicPage>
      <PublicCard subtitle={SUBTITLE}>
        <div className="py-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-won/10">
            <CheckCircle2 className="h-6 w-6 text-status-won" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-foreground">Referral submitted</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Thank you for the referral. Markist will reach out to your client shortly. A questionnaire link will be
            sent to their email to prepare for the appointment.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => { setSubmitted(false); setForm({ client_name: '', client_email: '', client_phone: '', referral_type: 'general', notes: '' }) }}
          >
            Submit another referral
          </Button>
        </div>
      </PublicCard>
    </PublicPage>
  )

  return (
    <PublicPage>
      <PublicCard subtitle={SUBTITLE}>
        <h1 className="text-lg font-semibold text-foreground">Refer a client</h1>
        {agency?.owner && (
          <p className="mt-1 text-sm font-medium text-primary">
            Referred by {agency.owner}{agency.name ? ` — ${agency.name}` : ''}
          </p>
        )}
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Submit a client referral to Markist. Your client will receive a secure questionnaire to prepare for their
          financial review.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <Field id="client_name" label="Client full name" required>
            <Input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Jane Smith" autoComplete="name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="client_email" label="Client email">
              <Input type="email" value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))} placeholder="jane@example.com" autoComplete="off" />
            </Field>
            <Field id="client_phone" label="Client phone">
              <Input type="tel" value={form.client_phone} onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))} placeholder="(555) 123-4567" autoComplete="off" />
            </Field>
          </div>
          <Field id="referral_type" label="Referral type">
            <Select value={form.referral_type} onChange={e => setForm(f => ({ ...f, referral_type: e.target.value }))}>
              {REFERRAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field id="notes" label="Notes" hint="Optional — any context that would help Markist prepare.">
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any context that would help Markist prepare…" rows={3} />
          </Field>

          {error && <PublicAlert>{error}</PublicAlert>}

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            {submitting ? 'Submitting…' : 'Submit referral'}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
          Markist · Farmers Financial Solutions, LLC<br />
          Securities offered through Farmers Financial Solutions, LLC, Member FINRA &amp; SIPC
        </p>
      </PublicCard>
    </PublicPage>
  )
}
