'use client'

// Public opt-out page (/unsubscribe). Records an email/SMS opt-out via the
// public POST /api/consent/opt-out endpoint (writes to the consent ledger).

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PublicPage, PublicCard, PublicAlert } from '@/components/public/PublicShell'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const CHANNELS = [
  { value: 'all', label: 'All messages' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
] as const

export default function Unsubscribe() {
  const [contact, setContact] = useState('')
  const [channel, setChannel] = useState<'all' | 'email' | 'sms'>('all')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (!contact.trim()) {
      setErr('Please enter your email or phone number.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/consent/opt-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: contact.trim(), channel }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErr(d.error || 'Something went wrong. Please try again.')
      } else {
        setDone(true)
      }
    } catch {
      setErr('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PublicPage align="center">
      <PublicCard subtitle="Manage your contact preferences">
        {!done ? (
          <>
            <h1 className="text-xl font-semibold text-foreground">Unsubscribe / opt-out</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Enter the email or phone number you&apos;d like us to stop contacting. This takes effect immediately for
              marketing messages.
            </p>

            <div className="mt-5 space-y-4">
              <Field id="contact" label="Email or phone number">
                <Input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="you@example.com or (555) 123-4567"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
                />
              </Field>

              <div className="space-y-1.5">
                <Label htmlFor="channel-group">Channels to opt out</Label>
                <div id="channel-group" role="radiogroup" aria-label="Channels to opt out" className="grid grid-cols-3 gap-2">
                  {CHANNELS.map((c) => {
                    const active = channel === c.value
                    return (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setChannel(c.value)}
                        className={cn(
                          'rounded-md border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          active
                            ? 'border-primary bg-primary-soft text-primary'
                            : 'border-input bg-card text-muted-foreground hover:border-ring/50 hover:text-foreground',
                        )}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {err && <PublicAlert>{err}</PublicAlert>}

              <Button onClick={submit} loading={submitting} size="lg" className="w-full">
                {submitting ? 'Processing…' : 'Opt me out'}
              </Button>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Note: we may still send messages required to service policies you currently hold, as permitted by law.
              </p>
            </div>
          </>
        ) : (
          <div className="py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-won/10">
              <CheckCircle2 className="h-6 w-6 text-status-won" aria-hidden />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-foreground">You&apos;re opted out</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              We&apos;ve recorded your request. If you continue to receive marketing messages after a few days, please
              contact us directly.
            </p>
          </div>
        )}
      </PublicCard>
    </PublicPage>
  )
}
