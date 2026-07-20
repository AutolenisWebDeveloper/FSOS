'use client'

import * as React from 'react'
import { CheckCircle2, Star } from 'lucide-react'
import { postJson, firstFieldError } from '@/lib/client/api'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/button'

// Public post-event feedback survey (spec §D). Rendered on the replay page. Submits the
// registrant's join_token + rating (1–5) + most_useful + consult_requested to the public
// feedback route, which writes workshop_feedback and (on consult_requested) routes into the
// existing consult spine — the FFS-supervised path for is_security workshops. Educational
// framing only; no product recommendation is ever collected here.
export function WorkshopFeedbackForm({ token }: { token: string }) {
  const [rating, setRating] = React.useState<number>(0)
  const [mostUseful, setMostUseful] = React.useState('')
  const [consult, setConsult] = React.useState(false)
  const [company, setCompany] = React.useState('') // honeypot
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErr, setFieldErr] = React.useState<string | undefined>()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErr(undefined)
    const res = await postJson('/api/public/workshops/feedback', {
      join_token: token,
      rating: rating || undefined,
      most_useful: mostUseful || undefined,
      consult_requested: consult,
      company,
    })
    setBusy(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      setFieldErr(fe.field)
      setError(fe.message)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="rounded-lg border border-status-won/20 bg-status-won/10 p-6 text-center" role="status">
        <CheckCircle2 className="mx-auto h-8 w-8 text-status-won" aria-hidden />
        <p className="mt-2 text-sm font-medium text-foreground">Thank you — your feedback was received.</p>
        {consult ? (
          <p className="mt-1 text-sm text-muted-foreground">A specialist will reach out about a personal review.</p>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">How would you rate this workshop?</legend>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              onClick={() => setRating(n)}
              className="rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star className={`h-7 w-7 ${n <= rating ? 'fill-primary text-primary' : 'text-muted-foreground'}`} aria-hidden />
            </button>
          ))}
        </div>
        {fieldErr === 'rating' && error ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>

      <Field id="most_useful" label="What was most useful?">
        <textarea
          value={mostUseful}
          onChange={(e) => setMostUseful(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Optional — a sentence or two helps us improve."
        />
      </Field>

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={consult}
          onChange={(e) => setConsult(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span>
          I&apos;d like a personal review with a specialist.{' '}
          <span className="text-muted-foreground">(Educational — no obligation.)</span>
        </span>
      </label>

      {/* Honeypot — hidden from users, filled by bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company">Company</label>
        <input id="company" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>

      {error && fieldErr !== 'rating' ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Submitting…' : 'Submit feedback'}
      </Button>
    </form>
  )
}
