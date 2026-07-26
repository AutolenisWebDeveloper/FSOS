import Link from 'next/link'
import { Users, Send, Filter, ArrowLeft } from 'lucide-react'
import { ListShell, Section, StatTile, EmptyState, ErrorState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getDb, ConfigError } from '@/lib/supabase/client'
import { resolveSegment, type SegmentBreakdown } from '@/lib/segments/resolve'
import { SEGMENT_PRESETS, type SegmentChannel, type ExclusionReason } from '@/lib/segments/rules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Slice 6 — Segment manager. Shows the three first-class campaign segments
// (Cross-Sell, Life Conversion, Win-Back) with a LIVE breakdown — how many contacts
// are in the segment, how many are eligible to enroll, and why the rest are excluded
// — so the FSA sees exactly who a campaign will reach before enrolling, then launches
// a campaign from the segment. Segments are dynamic (resolved on read), so a
// newly-cleaned/materialized contact appears automatically. Read-only surface;
// enrollment flows through the existing campaign builder + engine.

const REASON_LABEL: Record<ExclusionReason, string> = {
  no_household: 'No household',
  no_contact_method: 'No email/phone',
  no_consent: 'No consent',
  suppressed: 'Suppressed / DNC',
  incomplete: 'Incomplete',
}

interface SegmentView {
  key: string
  label: string
  channel: SegmentChannel
  breakdown: SegmentBreakdown
}

export default async function SegmentsPage({ searchParams }: { searchParams?: Promise<{ channel?: string }> }) {
  const sp = (await searchParams) ?? {}
  const channel: SegmentChannel = sp.channel === 'sms' ? 'sms' : 'email'

  let segments: SegmentView[] | null = null
  let state: 'ok' | 'error' | 'not_configured' = 'ok'
  try {
    const db = getDb()
    const presets = Object.values(SEGMENT_PRESETS)
    segments = await Promise.all(
      presets.map(async (p) => {
        const rule = { ...p.rule, channel }
        return { key: p.key, label: p.label, channel, breakdown: await resolveSegment(db, rule) }
      }),
    )
  } catch (e) {
    state = e instanceof ConfigError ? 'not_configured' : 'error'
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="ghost">
        <Link href="/app/contacts"><ArrowLeft className="h-4 w-4" /> Contacts</Link>
      </Button>
      <Button asChild size="sm" variant={channel === 'email' ? 'default' : 'outline'}>
        <Link href="/app/contacts/segments?channel=email">Email</Link>
      </Button>
      <Button asChild size="sm" variant={channel === 'sms' ? 'default' : 'outline'}>
        <Link href="/app/contacts/segments?channel=sms">SMS</Link>
      </Button>
    </div>
  )

  const shell = (children: React.ReactNode) => (
    <ListShell
      title="Campaign segments"
      description="The targeting layer your campaigns enroll from — live counts and exactly who's eligible vs excluded, on the channel you'll send."
      actions={actions}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: 'Segments' }]}
    >
      {children}
    </ListShell>
  )

  if (state === 'not_configured') {
    return shell(<EmptyState title="Database not configured" description="Set the Supabase environment variables to resolve segments." />)
  }
  if (state === 'error' || !segments) {
    return shell(<ErrorState description="Could not resolve the campaign segments. Try again." />)
  }

  return shell(
    <div className="space-y-6">
      {segments.map((s) => {
        const b = s.breakdown
        const reasons = (Object.keys(b.byReason) as ExclusionReason[]).filter((r) => b.byReason[r] > 0)
        return (
          <Section
            key={s.key}
            title={s.label}
            description={`Resolved live on the ${s.channel.toUpperCase()} channel. Consent, DNC, quiet hours and the securities firewall are re-checked per recipient at send.`}
          >
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile label="Eligible to enroll" value={b.eligible} tone={b.eligible > 0 ? 'brand' : 'neutral'} hint="Ready to send now" />
              <StatTile label="In segment" value={b.total} />
              <StatTile label="Excluded" value={b.excluded} tone={b.excluded > 0 ? 'attention' : 'neutral'} />
            </div>

            {reasons.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Excluded because:</span>
                {reasons.map((r) => (
                  <Badge key={r} variant="outline">
                    {REASON_LABEL[r]} · {b.byReason[r]}
                  </Badge>
                ))}
              </div>
            ) : b.total > 0 ? (
              <p className="mb-3 text-sm text-muted-foreground">Every contact in this segment is eligible to enroll.</p>
            ) : (
              <p className="mb-3 text-sm text-muted-foreground">No contacts match this segment yet.</p>
            )}

            {b.eligible === 0 ? (
              <Button size="sm" disabled title="No eligible members to enroll yet">
                <Send className="h-4 w-4" /> Create campaign from this segment
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={`/app/comms/campaigns/new?segment=${s.key}&channel=${s.channel}`}>
                  <Send className="h-4 w-4" /> Create campaign from this segment
                </Link>
              </Button>
            )}
          </Section>
        )
      })}

      <Section title="How segments work" description="Reference">
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li className="flex gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0" /> A contact becomes enrollable once it's connected to a household (Contacts → import or the daily backfill materialize it into the spine).</li>
          <li className="flex gap-2"><Filter className="mt-0.5 h-4 w-4 shrink-0" /> Segments re-evaluate every time this page loads, so a newly-cleaned contact appears in the right audience automatically.</li>
          <li className="flex gap-2"><Send className="mt-0.5 h-4 w-4 shrink-0" /> Enrolling a campaign from a segment sends only to the <em>eligible</em> members; the dispatcher gate still checks consent, DNC, quiet hours and the securities firewall for every message.</li>
        </ul>
      </Section>
    </div>,
  )
}
