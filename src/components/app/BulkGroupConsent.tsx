'use client'

import * as React from 'react'
import { ShieldCheck, ShieldOff, CheckCircle2, AlertTriangle, Loader2, Users, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { MonoLabel } from '@/components/ui/typography'

// Group Consents (Compliance → Consent). Bulk grant/revoke consent for every contact in one or
// more tag-defined groups. Flow: pick group(s) → pick channels → pick Grant/Revoke → Preview
// (writes nothing) → confirm/attest → Apply → completion summary. Grant is suppression-aware
// (opt-outs never re-consented); revoke applies to all. See bulk-consent-run.ts.

export interface TagOption {
  tag: string
  contacts: number
}

type Channel = 'sms' | 'email'
type Action = 'grant' | 'revoke'

interface Population {
  contactsMatched: number
  membersResolved: number
  contactsWithoutMember: number
}
interface GrantReport {
  membersProcessed: number
  smsCreated: number
  emailCreated: number
  skippedAlreadyGranted: number
  skippedRevoked: number
  skippedDnc: number
  skippedHouseholdDnc: number
}
interface RevokeReport {
  membersProcessed: number
  smsRevoked: number
  emailRevoked: number
  skippedAlreadyRevoked: number
}
interface Result {
  action: Action
  tags: string[]
  channels: Channel[]
  population: Population
  grant?: GrantReport
  revoke?: RevokeReport
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <MonoLabel className="block text-[11px]">{label}</MonoLabel>
      <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>{value}</span>
    </div>
  )
}

export function BulkGroupConsent({ tags, capped }: { tags: TagOption[]; capped: boolean }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [filter, setFilter] = React.useState('')
  const [sms, setSms] = React.useState(true)
  const [email, setEmail] = React.useState(true)
  const [action, setAction] = React.useState<Action>('grant')
  const [ack, setAck] = React.useState(false)
  const [busy, setBusy] = React.useState<false | 'preview' | 'commit'>(false)
  const [preview, setPreview] = React.useState<Result | null>(null)
  const [committed, setCommitted] = React.useState<Result | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const channels = React.useMemo<Channel[]>(
    () => [sms ? 'sms' : null, email ? 'email' : null].filter(Boolean) as Channel[],
    [sms, email],
  )
  const selectedTags = React.useMemo(() => Array.from(selected), [selected])
  const noChannel = channels.length === 0
  const noGroup = selectedTags.length === 0

  // Any change to the target/direction invalidates a stale preview + its confirmation.
  const invalidate = React.useCallback(() => {
    setPreview(null)
    setCommitted(null)
    setAck(false)
  }, [])

  function toggleTag(tag: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
    invalidate()
  }

  const visibleTags = React.useMemo(() => {
    const f = filter.trim().toLowerCase()
    return f ? tags.filter((t) => t.tag.includes(f)) : tags
  }, [tags, filter])

  async function run(dryRun: boolean) {
    setError(null)
    setBusy(dryRun ? 'preview' : 'commit')
    try {
      const res = await fetch('/api/app/consent/bulk-group', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tags: selectedTags,
          channels,
          action,
          dry_run: dryRun,
          ...(dryRun ? {} : action === 'grant' ? { attest: true } : { confirm: true }),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error || 'Request failed.')
        toast.error(json?.error || 'Request failed.')
        return
      }
      if (dryRun) {
        setPreview(json.report as Result)
      } else {
        const r = json.report as Result
        setCommitted(r)
        setPreview(null)
        const n = r.action === 'grant' ? (r.grant!.smsCreated + r.grant!.emailCreated) : (r.revoke!.smsRevoked + r.revoke!.emailRevoked)
        toast.success(`${r.action === 'grant' ? 'Granted' : 'Revoked'} ${n} consent record${n === 1 ? '' : 's'}.`)
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
  const isRevoke = action === 'revoke'

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
      {/* ── Group picker ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Groups {selectedTags.length ? <span className="text-muted-foreground">· {selectedTags.length} selected</span> : null}</p>
          {selected.size > 0 ? (
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { setSelected(new Set()); invalidate() }}>
              Clear
            </button>
          ) : null}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter groups…" className="pl-8" aria-label="Filter groups" />
        </div>
        <div className="max-h-[24rem] overflow-y-auto rounded-lg border">
          {visibleTags.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{tags.length === 0 ? 'No contact groups found.' : 'No groups match your filter.'}</p>
          ) : (
            <ul className="divide-y">
              {visibleTags.map((t) => (
                <li key={t.tag}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/40">
                    <input type="checkbox" checked={selected.has(t.tag)} disabled={busy !== false} onChange={() => toggleTag(t.tag)} />
                    <span className="flex-1 truncate font-medium">{t.tag}</span>
                    <Badge variant="outline" className="font-normal tabular-nums">{t.contacts}</Badge>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {capped ? <p className="text-xs text-muted-foreground">Showing the most common groups; the tag list was capped for a large book.</p> : null}
      </div>

      {/* ── Action panel ─────────────────────────────────────────── */}
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Direction</span>
            <div className="inline-flex overflow-hidden rounded-md border" role="radiogroup" aria-label="Direction">
              {(['grant', 'revoke'] as Action[]).map((a) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={action === a}
                  disabled={busy !== false}
                  onClick={() => { setAction(a); invalidate() }}
                  className={
                    'px-3 py-1.5 text-sm capitalize transition-colors ' +
                    (action === a ? (a === 'revoke' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground') : 'text-muted-foreground hover:bg-muted')
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Channels</span>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={sms} disabled={busy !== false} onChange={(e) => { setSms(e.target.checked); invalidate() }} /> SMS
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={email} disabled={busy !== false} onChange={(e) => { setEmail(e.target.checked); invalidate() }} /> Email
            </label>
          </div>
        </div>

        <div className={'flex items-start gap-2 rounded-md border p-3 text-xs ' + (isRevoke ? 'border-destructive/30 bg-destructive/5' : 'bg-muted/40')}>
          {isRevoke ? <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          <p className="text-muted-foreground">
            {isRevoke
              ? 'Revoke opts every reachable member of the selected group(s) out of the chosen channel(s). This immediately suppresses those channels at send time.'
              : 'Grant adds consent for members who don’t have it and leaves existing consent alone. It never re-consents anyone who opted out — those are skipped and shown in the summary.'}
          </p>
        </div>

        {shown ? (
          <div className="rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
              <Users className="h-4 w-4 text-muted-foreground" />
              {shown.population.contactsMatched} contact{shown.population.contactsMatched === 1 ? '' : 's'} matched · {shown.population.membersResolved} reachable
              {committed ? <Badge className="ml-auto">{isRevoke ? 'Revoked' : 'Granted'}</Badge> : <Badge variant="outline" className="ml-auto">Preview</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-3">
              {shown.grant ? (
                <>
                  <Stat label={committed ? 'SMS granted' : 'SMS to grant'} value={shown.grant.smsCreated} strong />
                  <Stat label={committed ? 'Email granted' : 'Email to grant'} value={shown.grant.emailCreated} strong />
                  <Stat label="Already on file" value={shown.grant.skippedAlreadyGranted} />
                  <Stat label="Skipped — opted out" value={shown.grant.skippedRevoked} />
                  <Stat label="Skipped — DNC" value={shown.grant.skippedDnc} />
                  <Stat label="Skipped — do-not-contact" value={shown.grant.skippedHouseholdDnc} />
                </>
              ) : shown.revoke ? (
                <>
                  <Stat label={committed ? 'SMS revoked' : 'SMS to revoke'} value={shown.revoke.smsRevoked} strong />
                  <Stat label={committed ? 'Email revoked' : 'Email to revoke'} value={shown.revoke.emailRevoked} strong />
                  <Stat label="Already revoked" value={shown.revoke.skippedAlreadyRevoked} />
                </>
              ) : null}
              {shown.population.contactsWithoutMember > 0 ? <Stat label="Not yet reachable" value={shown.population.contactsWithoutMember} /> : null}
            </dl>
            {shown.population.contactsWithoutMember > 0 ? (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                {shown.population.contactsWithoutMember} matched contact{shown.population.contactsWithoutMember === 1 ? ' is' : 's are'} not yet linked into a household, so
                consent can’t be keyed to them yet — they’re picked up automatically once materialized.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /> {error}</p>
        ) : null}

        {committed ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {isRevoke ? 'Consent revoked' : 'Consent granted'} and audited for {committed.population.membersResolved} member{committed.population.membersResolved === 1 ? '' : 's'} across {committed.tags.length} group{committed.tags.length === 1 ? '' : 's'}.
            </p>
            <Button variant="outline" onClick={() => { setCommitted(null); setAck(false) }}>Start another update</Button>
          </div>
        ) : (
          <>
            {preview ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={ack} disabled={busy !== false} onChange={(e) => setAck(e.target.checked)} />
                <span className="text-xs text-muted-foreground">
                  {isRevoke ? (
                    <>I confirm I want to <strong>revoke</strong> consent on the selected channel(s) for every reachable member of the selected group(s). This is recorded to the audit log.</>
                  ) : (
                    <>I confirm the contacts in the selected group(s) have already provided <strong>prior express consent</strong> to be contacted on the selected channel(s). This attestation is recorded to the audit log with each consent record.</>
                  )}
                </span>
              </label>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => run(true)} disabled={noGroup || noChannel || busy !== false}>
                {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Preview
              </Button>
              <Button
                variant={isRevoke ? 'destructive' : 'default'}
                onClick={() => run(false)}
                disabled={!preview || !ack || noGroup || noChannel || busy !== false}
              >
                {busy === 'commit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isRevoke ? 'Revoke consent' : 'Grant consent'}
              </Button>
              {noGroup ? <span className="text-xs text-muted-foreground">Select at least one group.</span> : noChannel ? <span className="text-xs text-muted-foreground">Select at least one channel.</span> : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
