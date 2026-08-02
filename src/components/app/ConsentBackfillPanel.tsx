'use client'

import * as React from 'react'
import { ShieldCheck, CheckCircle2, AlertTriangle, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MonoLabel } from '@/components/ui/typography'

// Retroactive consent-group backfill (§12/TCPA). For contacts ALREADY imported into a group
// but never granted consent, the licensed operator: (1) previews the resolved population +
// suppression breakdown (writes nothing), (2) attests the group has prior express consent,
// (3) grants. Suppression always wins and re-running is idempotent, so this only ever ADDS
// consent for un-suppressed members — never re-consents an opt-out.

export interface ConsentGroupOption {
  key: string
  label: string
  hint: string
  disclosure: string
  importTags: string[]
  channels: ('sms' | 'email')[]
}

interface Report {
  membersProcessed: number
  smsCreated: number
  emailCreated: number
  skippedAlreadyGranted: number
  skippedRevoked: number
  skippedDnc: number
  skippedHouseholdDnc: number
  population: {
    contactsMatched: number
    membersResolved: number
    contactsWithoutMember: number
  }
}

type Channel = 'sms' | 'email'

function skippedTotal(r: Report): number {
  return r.skippedRevoked + r.skippedDnc + r.skippedHouseholdDnc
}

function GroupCard({ group }: { group: ConsentGroupOption }) {
  const [sms, setSms] = React.useState(group.channels.includes('sms'))
  const [email, setEmail] = React.useState(group.channels.includes('email'))
  const [attest, setAttest] = React.useState(false)
  const [busy, setBusy] = React.useState<false | 'preview' | 'commit'>(false)
  const [preview, setPreview] = React.useState<Report | null>(null)
  const [committed, setCommitted] = React.useState<Report | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const channels = React.useMemo<Channel[]>(
    () => [sms ? 'sms' : null, email ? 'email' : null].filter(Boolean) as Channel[],
    [sms, email],
  )
  const noChannel = channels.length === 0

  // Any channel change invalidates a stale preview/attestation so the operator can't grant on
  // a preview taken for a different channel set.
  React.useEffect(() => {
    setPreview(null)
    setCommitted(null)
    setAttest(false)
  }, [sms, email])

  async function run(dryRun: boolean) {
    setError(null)
    setBusy(dryRun ? 'preview' : 'commit')
    try {
      const res = await fetch('/api/app/consent/backfill-group', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ group: group.key, channels, dry_run: dryRun, attest: dryRun ? undefined : true }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error || 'Request failed.')
        toast.error(json?.error || 'Request failed.')
        return
      }
      if (dryRun) {
        setPreview(json.report as Report)
      } else {
        setCommitted(json.report as Report)
        setPreview(null)
        const r = json.report as Report
        toast.success(`${group.label}: granted ${r.smsCreated} SMS + ${r.emailCreated} email consents.`)
      }
    } catch {
      const msg = 'Network error — please retry.'
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const shown = committed ?? preview

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> {group.label}
          </span>
          <span className="flex flex-wrap gap-1">
            {group.importTags.map((t) => (
              <Badge key={t} variant="outline" className="font-normal">
                {t}
              </Badge>
            ))}
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{group.hint}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">{group.disclosure}</p>

        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium">Channels</span>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={sms}
              disabled={!group.channels.includes('sms') || busy !== false}
              onChange={(e) => setSms(e.target.checked)}
            />
            SMS
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={email}
              disabled={!group.channels.includes('email') || busy !== false}
              onChange={(e) => setEmail(e.target.checked)}
            />
            Email
          </label>
        </div>

        {shown ? (
          <div className="rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
              <Users className="h-4 w-4 text-muted-foreground" />
              {shown.population.contactsMatched} contact{shown.population.contactsMatched === 1 ? '' : 's'} matched ·{' '}
              {shown.population.membersResolved} reachable
              {committed ? <Badge className="ml-auto">Granted</Badge> : <Badge variant="outline" className="ml-auto">Preview</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 text-sm sm:grid-cols-3">
              <Stat label={committed ? 'SMS granted' : 'SMS to grant'} value={shown.smsCreated} />
              <Stat label={committed ? 'Email granted' : 'Email to grant'} value={shown.emailCreated} />
              <Stat label="Already on file" value={shown.skippedAlreadyGranted} muted />
              <Stat label="Suppressed (opt-out/DNC)" value={skippedTotal(shown)} muted />
              {shown.population.contactsWithoutMember > 0 ? (
                <Stat label="Not yet reachable" value={shown.population.contactsWithoutMember} muted />
              ) : null}
            </dl>
            {shown.population.contactsWithoutMember > 0 ? (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                {shown.population.contactsWithoutMember} matched contact
                {shown.population.contactsWithoutMember === 1 ? ' is' : 's are'} not yet linked into a household, so consent
                can’t be keyed to them yet — they’re picked up automatically once materialized.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        ) : null}

        {committed ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Consent granted and audited. Re-run any time — it never duplicates or
            overrides an opt-out.
          </p>
        ) : (
          <>
            {preview ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={attest}
                  disabled={busy !== false}
                  onChange={(e) => setAttest(e.target.checked)}
                />
                <span className="text-xs text-muted-foreground">
                  I confirm the contacts in the <strong>{group.label}</strong> group have already provided prior express
                  consent to be contacted on the selected channel(s). This attestation is recorded to the audit log with
                  each consent record.
                </span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => run(true)} disabled={noChannel || busy !== false}>
                {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Preview
              </Button>
              <Button onClick={() => run(false)} disabled={!preview || !attest || noChannel || busy !== false}>
                {busy === 'commit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Grant consent
              </Button>
            </div>
            {noChannel ? <p className="text-xs text-muted-foreground">Select at least one channel.</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <MonoLabel className="block text-[11px]">{label}</MonoLabel>
      <span className={muted ? 'text-muted-foreground' : 'font-semibold'}>{value}</span>
    </div>
  )
}

export function ConsentBackfillPanel({ groups }: { groups: ConsentGroupOption[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} />
      ))}
    </div>
  )
}
