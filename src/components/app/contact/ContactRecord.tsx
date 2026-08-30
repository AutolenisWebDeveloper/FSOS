import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowUpRight,
  Building2,
  CalendarCheck,
  CalendarClock,
  Cake,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react'
import { ErrorState, EmptyState } from '@/components/archetypes'
import { NoteItem, AddNoteButton } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel, Money, Numeric } from '@/components/ui/typography'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { humanize, timeAgo } from '@/lib/dashboards/format'
import { cn } from '@/lib/utils'
import { CONTACT_TYPE_LABEL } from '@/components/app/contactMeta'
import { ContactForm } from '@/components/app/ContactForm'
import { loadContactRecord, type ContactRecord as Record_ } from '@/lib/contacts/record-data'
import {
  CHANNEL_STATE_LABEL,
  STREAM_KIND_LABEL,
  ageFromDob,
  appointmentStart,
  channelState,
  deriveAttention,
  dialHref,
  dueBucket,
  formatPhone,
  initialsOf,
  isOpenAppointment,
  isOpenOpportunity,
  mailHref,
  nextAppointment,
  num,
  relativeDay,
  summarizeContact,
  toContactSection,
  type ChannelState,
  type ContactRecordSection,
} from '@/lib/contacts/record-view'
import { IdentityBand, Fact } from './ContactIdentity'
import { AttentionStrip, ContactSectionNav, DataRow, Nothing, Panel, RailBand, Surface } from './ContactChrome'
import { ContactHeaderActions } from './ContactHeaderActions'
import { ContactLogButton } from './ContactLogButton'
import { ContactStream, type StreamEntry } from './ContactStream'
import { ContactTaskComposer, ContactTaskList } from './ContactTasks'

/*
 * The Contact Record workspace — /app/contacts/[id].
 *
 * Composition only: every read comes from lib/contacts/record-data, every rule
 * from lib/contacts/record-view. The page answers, in order and without a click:
 * WHO (identity band) · STATUS (chips + reachability) · ATTENTION (strip) ·
 * NOW (Overview "Right now") · HISTORY (timeline) · ACTION (header cluster,
 * inline task controls, per-section actions).
 *
 * Sections are `?s=` query params rather than routes, so the whole record stays
 * one server-rendered page with deep-linkable, keyboard-navigable sections.
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const DATETIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  return Number.isNaN(t) ? null : DATE.format(t)
}
function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : DATETIME.format(t)
}

const APPT_BADGE: Record<string, 'active' | 'won' | 'lost' | 'draft'> = {
  scheduled: 'active',
  completed: 'won',
  cancelled: 'lost',
  no_show: 'lost',
}

export async function ContactRecord({ id, section: raw }: { id: string; section?: string }) {
  const res = await loadContactRecord(id)
  if (!res.ok) {
    return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  }
  if (!res.data) notFound()

  const r = res.data
  const c = r.contact
  const section = toContactSection(raw)
  const now = Date.now()

  // ─── Derived model ──────────────────────────────────────────────────────────
  const openTasks = r.tasks.filter((t) => !t.completed)
  const doneTasks = r.tasks.filter((t) => t.completed)
  const openOpps = r.opportunities.filter((o) => isOpenOpportunity(o.stage))
  const openDocRequests = r.documentRequests.filter((d) => d.status === 'requested')
  const upcoming = nextAppointment(r.appointments, now)
  const hasSecurities = r.policies.some((p) => p.is_security) || r.opportunities.some((o) => o.is_security)
  const doNotContact = r.household?.do_not_contact === true || r.suppressed.sms || r.suppressed.email || r.suppressed.call
  const archived = c.status === 'archived'

  const stream = buildStream(r)
  const snapshot = summarizeContact({ policies: r.policies, opportunities: r.opportunities, tasks: r.tasks, stream: r.activities, now })
  const attention = deriveAttention({
    contactId: c.id,
    archived,
    doNotContact,
    tasks: r.tasks,
    appointments: r.appointments,
    opportunities: r.opportunities,
    openDocumentRequests: openDocRequests.length,
    hasContactChannel: !!(c.phone || c.email),
    now,
  })

  const phone = formatPhone(c.phone)
  const age = ageFromDob(c.dob, now)
  const latestConsent = (channel: 'sms' | 'email' | 'call'): 'granted' | 'revoked' | null => {
    const rows = r.consents.filter((x) => (x.channel ?? '').toLowerCase() === channel)
    if (rows.length === 0) return null
    const best = rows.reduce((a, b) => (Date.parse(b.captured_at) > Date.parse(a.captured_at) ? b : a))
    return best.status === 'granted' ? 'granted' : 'revoked'
  }
  const channels = {
    call: channelState({ hasAddress: !!c.phone, suppressed: r.suppressed.call, consent: latestConsent('call') }),
    sms: channelState({ hasAddress: !!c.phone, suppressed: r.suppressed.sms, consent: latestConsent('sms') }),
    email: channelState({ hasAddress: !!c.email, suppressed: r.suppressed.email, consent: latestConsent('email') }),
  }

  const counts: Partial<Record<ContactRecordSection, number>> = {
    activity: stream.length,
    coverage: r.policies.length,
    pipeline: r.opportunities.length + r.appointments.length,
    tasks: openTasks.length,
    notes: r.notes.length,
    documents: r.documents.length + openDocRequests.length,
  }

  const locality = [c.city, c.state].filter(Boolean).join(', ')
  const typeLabel = CONTACT_TYPE_LABEL[c.contact_type] ?? humanize(c.contact_type)

  return (
    <div className="space-y-5">
      <IdentityBand
        breadcrumb={[
          { label: 'FSA', href: '/app' },
          { label: 'Contacts', href: '/app/households' },
          { label: c.full_name },
        ]}
        monogram={initialsOf(c.full_name)}
        name={c.full_name}
        chips={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={archived ? 'draft' : 'active'}>{typeLabel}</Badge>
            {archived ? <Badge variant="draft">Archived</Badge> : null}
            {doNotContact ? <Badge variant="blocked">Do not contact</Badge> : null}
            {hasSecurities ? <SecuritiesChip /> : null}
          </div>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {c.title ? <span>{c.title}</span> : null}
            {c.title && c.company ? <span aria-hidden>·</span> : null}
            {c.company ? <span>{c.company}</span> : null}
            {(c.title || c.company) && locality ? <span aria-hidden>·</span> : null}
            {locality ? <span>{locality}</span> : null}
            {!c.title && !c.company && !locality ? <span>Contact record</span> : null}
          </span>
        }
        actions={
          <ContactHeaderActions
            id={c.id}
            name={c.full_name}
            status={c.status}
            telHref={dialHref('tel', c.phone)}
            smsHref={dialHref('sms', c.phone)}
            mailtoHref={mailHref(c.email)}
            phoneDisplay={phone}
            email={c.email}
            householdId={c.household_id}
            channels={{
              call: { state: channels.call, label: CHANNEL_STATE_LABEL[channels.call] },
              sms: { state: channels.sms, label: CHANNEL_STATE_LABEL[channels.sms] },
              email: { state: channels.email, label: CHANNEL_STATE_LABEL[channels.email] },
            }}
          />
        }
        facts={
          <>
            {c.dob ? (
              <Fact
                label="Date of birth"
                value={`${fmtDate(c.dob)}${age != null ? `  ·  ${age}` : ''}`}
                title={age != null ? `${fmtDate(c.dob)} — age ${age}` : undefined}
                mono
              />
            ) : null}
            <Fact label="Phone" value={phone} mono title={phone ?? undefined} copy={phone ? { value: phone, what: 'Phone number' } : null} />
            <Fact
              label="Email"
              value={c.email}
              title={c.email ?? undefined}
              wide
              copy={c.email ? { value: c.email, what: 'Email address' } : null}
            />
            {r.household ? (
              <Fact
                label="Household"
                value={r.household.primary_name}
                title={r.household.primary_name}
                href={`/app/households/${c.household_id}`}
              />
            ) : null}
            {r.agencyName ? (
              <Fact
                label="Referred by"
                value={r.agencyName}
                title={r.agencyName}
                href={c.agency_partnership_id ? `/app/agencies/${c.agency_partnership_id}` : null}
              />
            ) : null}
            {upcoming ? (
              <Fact
                label="Next up"
                value={`${fmtDateTime(upcoming.scheduled_at)} · ${relativeDay(upcoming.scheduled_at, now)}`}
                href={`/app/calendar/${upcoming.id}`}
                tone="attention"
              />
            ) : null}
            <Fact
              label="Last touch"
              value={snapshot.lastTouchAt ? `${timeAgo(snapshot.lastTouchAt)} ago` : 'Never logged'}
              href={`/app/contacts/${c.id}?s=activity`}
            />
          </>
        }
      />

      <div className="mx-auto max-w-[1600px] space-y-5">
        <AttentionStrip items={attention} />

        <div className="lg:flex lg:items-start lg:gap-6 xl:gap-8">
          <div className="min-w-0 space-y-5 lg:flex-1">
            <ContactSectionNav contactId={c.id} active={section} counts={counts} />
            {section === 'overview' ? (
              <Overview r={r} snapshot={snapshot} stream={stream} openTasks={openTasks} openOpps={openOpps} upcoming={upcoming} now={now} />
            ) : section === 'activity' ? (
              <Panel
                title="Activity"
                hint={`${stream.length} entries`}
                action={<ContactLogButton contactId={c.id} />}
              >
                <ContactStream entries={stream} initialLimit={14} emptyAction={<ContactLogButton contactId={c.id} />} />
              </Panel>
            ) : section === 'coverage' ? (
              <Coverage r={r} />
            ) : section === 'pipeline' ? (
              <Pipeline r={r} now={now} />
            ) : section === 'tasks' ? (
              <Tasks contactId={c.id} open={openTasks} done={doneTasks} />
            ) : section === 'notes' ? (
              <Notes r={r} />
            ) : section === 'documents' ? (
              <Documents r={r} openRequests={openDocRequests} />
            ) : (
              <Profile r={r} />
            )}
          </div>

          <aside
            aria-label="Contact reference"
            className="mt-5 w-full shrink-0 lg:mt-0 lg:w-[19rem] xl:w-[21rem]"
          >
            <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-elev-xs lg:sticky lg:top-4">
              <Reachability contact={c} channels={channels} suppressed={r.suppressed} doNotContact={doNotContact} />
              <KeyDates contact={c} upcoming={upcoming} lastTouchAt={snapshot.lastTouchAt} now={now} />
              <Related r={r} openOpps={openOpps.length} />
              <RailBand title="Record">
                <div className="divide-y">
                  <DataRow label="Type" value={typeLabel} />
                  <DataRow label="Status" value={humanize(c.status)} />
                  <DataRow label="Source" value={c.source ? humanize(c.source) : null} />
                  <DataRow label="Added by" value={c.created_by} />
                  <DataRow label="Updated" value={c.updated_at ? `${timeAgo(c.updated_at)} ago` : null} />
                </div>
                {c.tags.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    <MonoLabel className="text-[10px]">Tags</MonoLabel>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="outline" className="max-w-full truncate text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </RailBand>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

// ─── Stream assembly ──────────────────────────────────────────────────────────

function streamLabel(kind: string | null): string {
  const k = (kind ?? '').toLowerCase()
  return STREAM_KIND_LABEL[k] ?? humanize(kind) ?? 'Activity'
}

function buildStream(r: Record_): StreamEntry[] {
  const entries: StreamEntry[] = []
  for (const a of r.activities) {
    entries.push({
      id: `a-${a.id}`,
      kind: a.kind,
      title: streamLabel(a.kind),
      body: a.note,
      meta: a.actor ? `by ${a.actor}` : null,
      at: a.created_at,
    })
  }
  for (const m of r.messages) {
    entries.push({
      id: `m-${m.id}`,
      kind: m.channel,
      title: `${m.channel === 'sms' ? 'Text' : 'Email'} ${m.direction === 'inbound' ? 'received' : 'sent'}`,
      body: m.body,
      meta: m.recipient ? `${m.direction === 'inbound' ? 'from' : 'to'} ${m.recipient}` : null,
      at: m.created_at,
      status: m.delivery_status,
    })
  }
  for (const n of r.notes) {
    entries.push({
      id: `n-${n.id}`,
      kind: 'note',
      title: 'Note',
      body: n.body,
      meta: n.author_id ? `by ${n.author_id}` : null,
      at: n.created_at,
      pinned: n.is_pinned,
    })
  }
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({
  r,
  snapshot,
  stream,
  openTasks,
  openOpps,
  upcoming,
  now,
}: {
  r: Record_
  snapshot: ReturnType<typeof summarizeContact>
  stream: StreamEntry[]
  openTasks: Record_['tasks']
  openOpps: Record_['opportunities']
  upcoming: Record_['appointments'][number] | null
  now: number
}) {
  const c = r.contact
  const pinned = r.notes.filter((n) => n.is_pinned)
  const activePolicies = r.policies.filter((p) => p.status === 'active')
  const staleAppointments = r.appointments.filter((a) => isOpenAppointment(a) && (appointmentStart(a) ?? Infinity) < now)
  const lastTouchLabel = stream.length > 0 ? stream[0].title.toLowerCase() : null

  return (
    <div className="space-y-6">
      <Snapshot snapshot={snapshot} contactId={c.id} lastTouchLabel={lastTouchLabel} />

      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:items-start">
        <div className="contents xl:block xl:min-w-0 xl:space-y-6">
          <Panel
            className="order-1"
            title="Right now"
            hint="What is live on this relationship"
            action={
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link href={`/app/contacts/${c.id}?s=pipeline`}>
                  Pipeline <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            }
          >
            {!upcoming && openOpps.length === 0 && staleAppointments.length === 0 ? (
              <Nothing
                action={
                  <Button asChild size="sm">
                    <Link href={c.household_id ? `/app/reviews/new?household=${c.household_id}` : '/app/reviews/new'}>
                      Schedule a review
                    </Link>
                  </Button>
                }
              >
                Nothing in flight — no scheduled appointment and no open opportunity.
              </Nothing>
            ) : (
              <div className="space-y-2.5">
                {upcoming ? (
                  <Link
                    href={`/app/calendar/${upcoming.id}`}
                    className="group flex items-center gap-3.5 rounded-xl border border-primary/25 bg-primary-soft/40 p-3.5 transition-[border-color,box-shadow] duration-fast hover:border-primary/50 hover:shadow-elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <CalendarCheck className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">
                        Appointment {relativeDay(upcoming.scheduled_at, now)}
                      </span>
                      <span className="numeric block text-xs text-muted-foreground">{fmtDateTime(upcoming.scheduled_at)}</span>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </Link>
                ) : null}

                {staleAppointments.map((a) => (
                  <div key={a.id} className="flex items-center gap-3.5 rounded-xl border border-status-pending/40 bg-status-pending/[0.07] p-3.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-status-pending/15 text-status-pending">
                      <CalendarClock className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">Past appointment awaiting an outcome</span>
                      <span className="numeric block text-xs text-muted-foreground">{fmtDateTime(a.scheduled_at)}</span>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/app/calendar">Update</Link>
                    </Button>
                  </div>
                ))}

                {openOpps.map((o) => (
                  <Link
                    key={o.id}
                    href={`/app/opportunities/${o.id}`}
                    className={cn(
                      'group flex items-center gap-3.5 rounded-xl border bg-card p-3.5 transition-[border-color,box-shadow] duration-fast hover:border-primary/40 hover:shadow-elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      o.is_security && securitiesRowClass,
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Target className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                        {humanize(o.stage)}
                        {o.is_security ? <SecuritiesChip /> : null}
                      </div>
                      <span className="block text-xs text-muted-foreground">
                        {humanize(o.engagement ?? '')}
                        {o.updated_at ? ` · moved ${timeAgo(o.updated_at)} ago` : ''}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money value={num(o.expected_commission) || null} className="text-sm font-semibold" />
                      <span className="block text-[11px] text-muted-foreground">expected</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            className="order-3"
            title="Recent activity"
            action={
              stream.length > 5 ? (
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                  <Link href={`/app/contacts/${c.id}?s=activity`}>
                    Full timeline <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : null
            }
          >
            <ContactStream
              entries={stream.slice(0, 5)}
              filterable={false}
              initialLimit={5}
              emptyDescription="Log a call, text, email, or note and it appears here."
              emptyAction={<ContactLogButton contactId={c.id} />}
            />
          </Panel>

        </div>

        <div className="contents xl:block xl:min-w-0 xl:space-y-6">
          <Panel
            className="order-2"
            title="Open tasks"
            hint={openTasks.length ? `${openTasks.length} open` : undefined}
            action={<ContactTaskComposer contactId={c.id} variant="ghost" label="Add" />}
          >
            {openTasks.length === 0 ? (
              <Nothing action={<ContactTaskComposer contactId={c.id} variant="outline" />}>
                Nothing outstanding.
              </Nothing>
            ) : (
              <Surface>
                <ContactTaskList contactId={c.id} tasks={openTasks.slice(0, 5)} dense showComposer={false} />
                {openTasks.length > 5 ? (
                  <Link
                    href={`/app/contacts/${c.id}?s=tasks`}
                    className="block border-t px-3.5 py-2 text-center text-xs font-medium text-primary hover:bg-muted/50"
                  >
                    View all {openTasks.length} tasks
                  </Link>
                ) : null}
              </Surface>
            )}
          </Panel>

          <Panel
            className="order-4"
            title="Coverage"
            hint={activePolicies.length ? `${activePolicies.length} in force` : undefined}
            action={
              r.policies.length > 3 ? (
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                  <Link href={`/app/contacts/${c.id}?s=coverage`}>All {r.policies.length}</Link>
                </Button>
              ) : null
            }
          >
            {r.policies.length === 0 ? (
              <Nothing
                action={
                  c.household_id ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/app/policies/new?household=${c.household_id}`}>Record a policy</Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/app/contacts/${c.id}?s=profile`}>Link a household</Link>
                    </Button>
                  )
                }
              >
                {c.household_id
                  ? 'No policies on file for this household yet.'
                  : 'No coverage tracked — this contact is not linked to a household.'}
              </Nothing>
            ) : (
              <Surface>
                <ul className="divide-y">
                  {r.policies.slice(0, 3).map((p) => (
                    <li key={p.id} className={cn('px-3.5 py-2.5', p.is_security && securitiesRowClass)}>
                      <div className="flex items-baseline gap-3">
                        <Link
                          href={`/app/policies/${p.id}`}
                          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {p.product_name ?? 'Policy'}
                        </Link>
                        <Money value={p.face_amount == null ? null : num(p.face_amount)} className="shrink-0 text-sm font-semibold" />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Numeric>{p.policy_number ?? 'Unnumbered'}</Numeric>
                        <Badge variant={p.status === 'active' ? 'won' : p.status === 'lapsed' || p.status === 'cancelled' ? 'lost' : 'draft'}>
                          {p.status}
                        </Badge>
                        {p.is_security ? <SecuritiesChip /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Surface>
            )}
          </Panel>
          {pinned.length > 0 ? (
            <Panel className="order-5" title="Pinned notes">
              <ol className="relative space-y-3 border-l pl-5">
                {pinned.map((n) => (
                  <NoteItem key={n.id} note={n} />
                ))}
              </ol>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Snapshot({
  snapshot,
  contactId,
  lastTouchLabel,
}: {
  snapshot: ReturnType<typeof summarizeContact>
  contactId: string
  lastTouchLabel: string | null
}) {
  const items = [
    {
      label: 'Coverage in force',
      value: <Money value={snapshot.coverageInForce || null} />,
      hint: `${snapshot.activePolicies} active ${snapshot.activePolicies === 1 ? 'policy' : 'policies'}`,
      href: `/app/contacts/${contactId}?s=coverage`,
    },
    {
      label: 'Open pipeline',
      value: <Money value={snapshot.openPipelineValue || null} />,
      hint: `${snapshot.openOpportunities} open ${snapshot.openOpportunities === 1 ? 'opportunity' : 'opportunities'}`,
      href: `/app/contacts/${contactId}?s=pipeline`,
    },
    {
      label: 'Open tasks',
      value: <Numeric>{snapshot.openTasks}</Numeric>,
      hint: snapshot.overdueTasks > 0 ? `${snapshot.overdueTasks} overdue` : 'none overdue',
      tone: snapshot.overdueTasks > 0 ? ('bad' as const) : undefined,
      href: `/app/contacts/${contactId}?s=tasks`,
    },
    {
      label: 'Last touch',
      value: <Numeric>{snapshot.lastTouchAt ? `${timeAgo(snapshot.lastTouchAt)} ago` : '—'}</Numeric>,
      hint: lastTouchLabel ?? 'never logged',
      href: `/app/contacts/${contactId}?s=activity`,
    },
  ]

  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-elev-xs lg:grid-cols-4">
      {items.map((i, idx) => (
        <Link
          key={i.label}
          href={i.href}
          className={cn(
            'group px-4 py-3.5 transition-colors duration-fast hover:bg-sunken/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            idx % 2 === 1 && 'border-l',
            idx >= 2 && 'border-t lg:border-t-0',
            idx >= 1 && 'lg:border-l',
          )}
        >
          <p className="mono-label truncate text-[10px] text-muted-foreground">{i.label}</p>
          <p className={cn('mt-1 text-xl font-semibold leading-none tracking-tight', i.tone === 'bad' && 'text-status-lost')}>
            {i.value}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{i.hint}</p>
        </Link>
      ))}
    </div>
  )
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

function Coverage({ r }: { r: Record_ }) {
  const c = r.contact
  return (
    <div className="space-y-6">
      <Panel
        title="Policies & coverage"
        hint={`${r.policies.length} on file`}
        action={
          c.household_id ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/app/policies/new?household=${c.household_id}`}>Record policy</Link>
            </Button>
          ) : null
        }
      >
        {r.policies.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No policies on file"
            description={c.household_id ? 'Record a policy against the linked household.' : 'Link a household on the Profile tab to track coverage.'}
          />
        ) : (
          <Surface>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Face amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.policies.map((p) => (
                    <TableRow key={p.id} className={p.is_security ? securitiesRowClass : undefined}>
                      <TableCell>
                        <Link href={`/app/policies/${p.id}`} className="font-medium text-primary hover:underline">
                          {p.product_name ?? 'Policy'}
                        </Link>
                        {p.is_security ? <SecuritiesChip className="ml-2" /> : null}
                      </TableCell>
                      <TableCell>
                        <Numeric className="text-xs">{p.policy_number ?? '—'}</Numeric>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === 'active' ? 'won' : p.status === 'lapsed' || p.status === 'cancelled' ? 'lost' : 'draft'}>
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={p.face_amount == null ? null : num(p.face_amount)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Surface>
        )}
      </Panel>

      <Panel
        title="Household"
        hint={r.household ? r.household.primary_name : 'Not linked'}
        action={
          c.household_id ? (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <Link href={`/app/households/${c.household_id}`}>
                Open record <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null
        }
      >
        {r.members.length === 0 ? (
          <EmptyState
            icon={Users}
            title={c.household_id ? 'No household members recorded' : 'Not linked to a household'}
            description={
              c.household_id
                ? 'Add the spouse, dependents, joint owners, or beneficiaries on the household record.'
                : 'Linking a household connects policies, reviews, notes, and documents to this person.'
            }
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={c.household_id ? `/app/households/${c.household_id}/members/new` : '/app/households/new'}>
                  {c.household_id ? 'Add member' : 'Create a household'}
                </Link>
              </Button>
            }
          />
        ) : (
          <Surface>
            <ul className="divide-y">
              {r.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                  <Link
                    href={`/app/households/${c.household_id}/members/${m.id}`}
                    className="text-sm font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {m.full_name}
                  </Link>
                  <Badge variant="draft" className="capitalize">
                    {humanize(m.relationship ?? '—')}
                  </Badge>
                  <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    {m.phone ? <Numeric>{formatPhone(m.phone)}</Numeric> : null}
                    {m.email ? <span className="truncate">{m.email}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
        )}
      </Panel>

      {r.reviews.length > 0 ? (
        <Panel title="Financial reviews" hint={`${r.reviews.length} recorded`}>
          <Surface>
            <ul className="divide-y">
              {r.reviews.map((rev) => (
                <li key={rev.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                  <Link href={`/app/reviews/${rev.id}`} className="text-sm font-medium text-foreground hover:text-primary hover:underline">
                    {humanize(rev.type)}
                  </Link>
                  <Badge variant="draft">{humanize(rev.stage)}</Badge>
                  <span className="numeric ml-auto text-xs text-muted-foreground">{fmtDate(rev.scheduled_at) ?? 'Not scheduled'}</span>
                </li>
              ))}
            </ul>
          </Surface>
        </Panel>
      ) : null}
    </div>
  )
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

function Pipeline({ r, now }: { r: Record_; now: number }) {
  const c = r.contact
  return (
    <div className="space-y-6">
      <Panel
        title="Opportunities"
        hint={`${r.opportunities.filter((o) => isOpenOpportunity(o.stage)).length} open of ${r.opportunities.length}`}
        action={
          c.household_id ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/app/opportunities/new?household=${c.household_id}`}>New opportunity</Link>
            </Button>
          ) : null
        }
      >
        {r.opportunities.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No opportunities yet"
            description="Open one when a need surfaces from a review, a referral, or a conversation."
            action={
              c.household_id ? (
                <Button asChild size="sm">
                  <Link href={`/app/opportunities/new?household=${c.household_id}`}>New opportunity</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Surface>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Engagement</TableHead>
                    <TableHead>Last moved</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.opportunities.map((o) => (
                    <TableRow key={o.id} className={o.is_security ? securitiesRowClass : undefined}>
                      <TableCell>
                        <Link href={`/app/opportunities/${o.id}`} className="font-medium text-primary hover:underline">
                          {humanize(o.stage)}
                        </Link>
                        {o.is_security ? <SecuritiesChip className="ml-2" /> : null}
                        {!isOpenOpportunity(o.stage) ? <Badge variant="draft" className="ml-2">Closed</Badge> : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{humanize(o.engagement ?? '')}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{o.updated_at ? `${timeAgo(o.updated_at)} ago` : '—'}</TableCell>
                      <TableCell className="text-right">
                        <Money value={num(o.expected_commission) || null} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Surface>
        )}
      </Panel>

      <Panel
        title="Appointments"
        hint={`${r.appointments.length} on record`}
        action={
          <Button asChild size="sm" variant="outline">
            <Link href={c.household_id ? `/app/reviews/new?household=${c.household_id}` : '/app/reviews/new'}>Schedule</Link>
          </Button>
        }
      >
        {r.appointments.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No appointments"
            description="Scheduling a review creates the appointment and its prep task."
            action={
              <Button asChild size="sm">
                <Link href={c.household_id ? `/app/reviews/new?household=${c.household_id}` : '/app/reviews/new'}>Schedule a review</Link>
              </Button>
            }
          />
        ) : (
          <Surface>
            <ul className="divide-y">
              {r.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                  <Link href={`/app/calendar/${a.id}`} className="numeric text-sm font-medium text-foreground hover:text-primary hover:underline">
                    {fmtDateTime(a.scheduled_at) ?? 'Unscheduled'}
                  </Link>
                  <span className="text-xs text-muted-foreground">{relativeDay(a.scheduled_at, now)}</span>
                  <Badge variant={APPT_BADGE[a.status] ?? 'draft'} className="ml-auto">
                    {humanize(a.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Surface>
        )}
      </Panel>
    </div>
  )
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

function Tasks({ contactId, open, done }: { contactId: string; open: Record_['tasks']; done: Record_['tasks'] }) {
  const overdue = open.filter((t) => dueBucket(t.due_at) === 'overdue')
  return (
    <div className="space-y-6">
      <Panel
        title="Open tasks"
        hint={overdue.length > 0 ? `${overdue.length} overdue` : open.length ? `${open.length} open` : undefined}
        action={<ContactTaskComposer contactId={contactId} />}
      >
        {open.length === 0 ? (
          <ContactTaskList contactId={contactId} tasks={[]} />
        ) : (
          <Surface>
            <ContactTaskList contactId={contactId} tasks={open} showComposer={false} />
          </Surface>
        )}
      </Panel>

      {done.length > 0 ? (
        <Panel title="Completed" hint={`${done.length} done`}>
          <Surface className="opacity-90">
            <ContactTaskList contactId={contactId} tasks={done} showComposer={false} />
          </Surface>
        </Panel>
      ) : null}
    </div>
  )
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function Notes({ r }: { r: Record_ }) {
  const c = r.contact
  const pinned = r.notes.filter((n) => n.is_pinned)
  const rest = r.notes.filter((n) => !n.is_pinned)

  return (
    <div className="space-y-6">
      {c.notes ? (
        <Panel title="Profile note" hint="Stored on the contact record">
          <div className="rounded-xl border border-gold/30 bg-gold/[0.06] p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{c.notes}</p>
            <Link
              href={`/app/contacts/${c.id}?s=profile`}
              className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Edit on the Profile tab
            </Link>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Notes"
        hint={c.household_id ? `${r.notes.length} on the household` : 'Requires a linked household'}
        action={c.household_id ? <AddNoteButton householdId={c.household_id} /> : null}
      >
        {!c.household_id ? (
          <EmptyState
            title="Notes live on the household"
            description="Link this contact to a household and shared, pinnable notes become available here. Until then, use Log interaction to capture context on the timeline."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={`/app/contacts/${c.id}?s=profile`}>Link a household</Link>
              </Button>
            }
          />
        ) : r.notes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Capture the context the next conversation needs — preferences, family details, commitments."
            action={<AddNoteButton householdId={c.household_id} />}
          />
        ) : (
          <div className="space-y-5">
            {pinned.length > 0 ? (
              <div className="space-y-2">
                <MonoLabel>Pinned</MonoLabel>
                <ol className="relative space-y-3 border-l pl-5">
                  {pinned.map((n) => (
                    <NoteItem key={n.id} note={n} />
                  ))}
                </ol>
              </div>
            ) : null}
            {rest.length > 0 ? (
              <ol className="relative space-y-3 border-l pl-5">
                {rest.map((n) => (
                  <NoteItem key={n.id} note={n} />
                ))}
              </ol>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  )
}

// ─── Documents ────────────────────────────────────────────────────────────────

function Documents({ r, openRequests }: { r: Record_; openRequests: Record_['documentRequests'] }) {
  return (
    <div className="space-y-6">
      {r.documentRequests.length > 0 ? (
        <Panel title="Requested documents" hint={openRequests.length ? `${openRequests.length} outstanding` : 'all received'}>
          <Surface>
            <ul className="divide-y">
              {r.documentRequests.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                  <span className="text-sm font-medium text-foreground">{d.requirement}</span>
                  <Badge variant={d.status === 'received' ? 'won' : d.status === 'waived' ? 'draft' : 'pending'} className="ml-auto">
                    {humanize(d.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Surface>
        </Panel>
      ) : null}

      <Panel
        title="Documents"
        hint={`${r.documents.length} on file`}
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/app/uploads">Upload Center</Link>
          </Button>
        }
      >
        {r.documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Everything uploaded through the Upload Center for this contact or household appears here."
            action={
              <Button asChild size="sm">
                <Link href="/app/uploads">Open Upload Center</Link>
              </Button>
            }
          />
        ) : (
          <Surface>
            <ul className="divide-y">
              {r.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                  <Link href={`/app/documents/${d.id}`} className="text-sm font-medium text-foreground hover:text-primary hover:underline">
                    {d.classification ? humanize(d.classification) : 'Document'}
                  </Link>
                  <Badge variant="draft">v{d.version}</Badge>
                  <span className="numeric ml-auto text-xs text-muted-foreground">{fmtDate(d.created_at)}</span>
                </li>
              ))}
            </ul>
          </Surface>
        )}
      </Panel>
    </div>
  )
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function Profile({ r }: { r: Record_ }) {
  const c = r.contact
  const mailing = [c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' · ')
  return (
    <div className="space-y-6">
      <Panel title="Edit contact" hint="Saved changes apply immediately across the book">
        <div className="max-w-3xl">
          <ContactForm mode="edit" initial={c} />
        </div>
      </Panel>

      <Panel title="Stored on the record" hint="Read-only fields captured at import or by an automation">
        <Surface className="max-w-3xl">
          <div className="divide-y px-3.5">
            <DataRow label="Date of birth" value={fmtDate(c.dob)} mono />
            <DataRow label="Mailing address" value={mailing || null} />
            <DataRow
              label="Lines of business"
              value={c.lines_of_business && c.lines_of_business.length ? c.lines_of_business.map((l) => humanize(l)).join(', ') : null}
            />
            <DataRow label="Household" value={r.household?.primary_name} href={c.household_id ? `/app/households/${c.household_id}` : null} />
            <DataRow label="Referring agency" value={r.agencyName} href={c.agency_partnership_id ? `/app/agencies/${c.agency_partnership_id}` : null} />
            <DataRow label="Owner" value={c.owner_scope} mono />
            <DataRow label="Contact ID" value={c.id} mono />
            <DataRow label="Created" value={fmtDate(c.created_at)} mono />
            <DataRow label="Last updated" value={fmtDate(c.updated_at)} mono />
          </div>
        </Surface>
        <p className="max-w-3xl text-xs text-muted-foreground">
          Date of birth, mailing street, and lines of business are captured by the import mapper and are not editable from
          this form.
        </p>
      </Panel>
    </div>
  )
}

// ─── Rail bands ───────────────────────────────────────────────────────────────

const CHANNEL_BADGE: Record<ChannelState, 'won' | 'lost' | 'blocked' | 'draft'> = {
  granted: 'won',
  revoked: 'lost',
  suppressed: 'blocked',
  // No recorded consent is a fact, not an alarm — the dispatcher decides at send time.
  unknown: 'draft',
  missing: 'draft',
}

function Reachability({
  contact,
  channels,
  suppressed,
  doNotContact,
}: {
  contact: Record_['contact']
  channels: { call: ChannelState; sms: ChannelState; email: ChannelState }
  suppressed: Record_['suppressed']
  doNotContact: boolean
}) {
  const phone = formatPhone(contact.phone)
  const groups = [
    {
      key: 'phone',
      icon: Phone,
      target: phone,
      lines: [
        { label: 'Call', state: channels.call },
        { label: 'Text', state: channels.sms },
      ],
    },
    {
      key: 'email',
      icon: Mail,
      target: contact.email,
      lines: [{ label: 'Email', state: channels.email }],
    },
  ]

  return (
    <RailBand title="Reachability">
      <ul className="space-y-3">
        {groups.map((g) => {
          const Icon = g.icon
          return (
            <li key={g.key}>
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <p className="min-w-0 truncate text-[13px] text-foreground" title={g.target ?? undefined}>
                  {g.target ?? <span className="text-muted-foreground/70">Not on file</span>}
                </p>
              </div>
              <ul className="mt-1 space-y-1 pl-[1.375rem]">
                {g.lines.map((l) => (
                  <li key={l.label} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{l.label}</span>
                    <Badge variant={CHANNEL_BADGE[l.state]} className="shrink-0">
                      {CHANNEL_STATE_LABEL[l.state]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {doNotContact
          ? 'On do-not-contact. Automated outreach is suppressed; STOP is honored at send time by the dispatcher.'
          : 'Informational. Consent, quiet hours, and DNC are enforced by the dispatcher at send time.'}
      </p>
      {suppressed.sms || suppressed.email || suppressed.call ? (
        <Link href="/app/comms/suppression" className="mt-1.5 inline-block text-[11px] font-medium text-primary hover:underline">
          Review the suppression list →
        </Link>
      ) : null}
    </RailBand>
  )
}

function KeyDates({
  contact,
  upcoming,
  lastTouchAt,
  now,
}: {
  contact: Record_['contact']
  upcoming: Record_['appointments'][number] | null
  lastTouchAt: string | null
  now: number
}) {
  const age = ageFromDob(contact.dob, now)
  return (
    <RailBand title="Key dates">
      <div className="divide-y">
        <DataRow
          label={
            <span className="inline-flex items-center gap-1">
              <Cake className="h-3 w-3" aria-hidden />
              Date of birth
            </span>
          }
          value={contact.dob ? `${fmtDate(contact.dob)}${age != null ? ` · ${age}` : ''}` : null}
          mono
        />
        <DataRow label="Next appointment" value={upcoming ? fmtDateTime(upcoming.scheduled_at) : null} mono href={upcoming ? `/app/calendar/${upcoming.id}` : null} />
        <DataRow label="Last touch" value={lastTouchAt ? `${timeAgo(lastTouchAt)} ago` : null} />
        <DataRow label="In book since" value={fmtDate(contact.created_at)} mono />
      </div>
    </RailBand>
  )
}

function Related({ r, openOpps }: { r: Record_; openOpps: number }) {
  const c = r.contact
  const links = [
    c.household_id
      ? { href: `/app/households/${c.household_id}`, icon: Users, label: r.household?.primary_name ?? 'Household', meta: `${r.members.length} people` }
      : null,
    c.agency_partnership_id ? { href: `/app/agencies/${c.agency_partnership_id}`, icon: Building2, label: r.agencyName ?? 'Referring agency', meta: 'Partnership' } : null,
    { href: `/app/contacts/${c.id}?s=coverage`, icon: ShieldCheck, label: 'Policies', meta: `${r.policies.length}` },
    { href: `/app/contacts/${c.id}?s=pipeline`, icon: Target, label: 'Opportunities', meta: `${openOpps} open` },
    { href: `/app/contacts/${c.id}?s=documents`, icon: FileText, label: 'Documents', meta: `${r.documents.length}` },
  ].filter(Boolean) as { href: string; icon: React.ComponentType<{ className?: string }>; label: string; meta: string }[]

  return (
    <RailBand title="Related">
      <ul className="-mx-1.5 space-y-0.5">
        {links.map((l) => {
          const Icon = l.icon
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{l.label}</span>
                <span className="numeric shrink-0 text-[11px] text-muted-foreground">{l.meta}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </RailBand>
  )
}
