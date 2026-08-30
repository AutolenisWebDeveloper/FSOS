'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  Check,
  Copy,
  Ellipsis,
  Link2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/archetypes/overlays'
import { patchJson, deleteJson, firstFieldError } from '@/lib/client/api'
import { cn } from '@/lib/utils'
import { ContactActionMenu, ContactActionMenuItem, ContactActionMenuSeparator } from './ContactActionMenu'
import { ContactLogButton } from './ContactLogButton'
import { ContactTaskComposer } from './ContactTasks'

/*
 * The Contact Record's primary action cluster, on the navy identity band.
 *
 * Hierarchy is deliberate. "Reach out" is ONE joined brand control with three
 * targets, so the band has a single visual primary instead of three competing
 * fills; work actions sit beside it as outlines; administration (archive,
 * delete, copy, related records) lives in the overflow.
 *
 * Channel actions hand off to the FSA's OWN phone / messaging / mail client via
 * tel:, sms:, mailto:. They are person-to-person, so they deliberately do NOT
 * touch the campaign dispatcher, and this component adds no send path of its own.
 * A suppressed or opted-out channel stays reachable — matching the record's
 * informational-consent convention — but is tinted and announced so the FSA
 * cannot miss it.
 */

export interface ChannelAvailability {
  state: 'granted' | 'revoked' | 'suppressed' | 'unknown' | 'missing'
  label: string
}

export function ContactHeaderActions({
  id,
  name,
  status,
  telHref,
  smsHref,
  mailtoHref,
  phoneDisplay,
  email,
  householdId,
  channels,
}: {
  id: string
  name: string
  status: string
  telHref: string | null
  smsHref: string | null
  mailtoHref: string | null
  phoneDisplay: string | null
  email: string | null
  householdId: string | null
  channels: { call: ChannelAvailability; sms: ChannelAvailability; email: ChannelAvailability }
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const archived = status === 'archived'

  async function setStatus(next: 'active' | 'archived') {
    setBusy(true)
    const res = await patchJson(`/api/app/contacts/${id}`, { status: next })
    setBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(next === 'archived' ? 'Contact archived.' : 'Contact restored.')
    router.refresh()
  }

  async function remove() {
    setBusy(true)
    const res = await deleteJson(`/api/app/contacts/${id}`)
    setBusy(false)
    setConfirmDelete(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Contact deleted.')
    router.push('/app/households')
  }

  async function copy(value: string | null, what: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${what} copied`)
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}`)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={`Reach ${name}`}
          className="inline-flex h-9 items-stretch overflow-hidden rounded-md shadow-sm ring-1 ring-inset ring-white/10"
        >
          <ChannelSegment href={telHref} icon={Phone} label="Call" availability={channels.call} />
          <ChannelSegment href={smsHref} icon={MessageSquare} label="Text" availability={channels.sms} />
          <ChannelSegment href={mailtoHref} icon={Mail} label="Email" availability={channels.email} />
        </div>

        <Button asChild size="sm" variant="outline" className={shellOutline}>
          <Link href={householdId ? `/app/reviews/new?household=${householdId}` : '/app/reviews/new'}>
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Link>
        </Button>
        <ContactTaskComposer contactId={id} className={shellOutline} />
        <ContactLogButton contactId={id} className={shellOutline} label="Log" />

        <ContactActionMenu label={`More actions for ${name}`} trigger={<Ellipsis className="h-4 w-4" aria-hidden />}>
          {phoneDisplay ? (
            <ContactActionMenuItem onSelect={() => copy(phoneDisplay, 'Phone number')}>
              <Copy /> Copy phone number
            </ContactActionMenuItem>
          ) : null}
          {email ? (
            <ContactActionMenuItem onSelect={() => copy(email, 'Email address')}>
              <Copy /> Copy email address
            </ContactActionMenuItem>
          ) : null}
          <ContactActionMenuItem onSelect={() => copy(typeof window === 'undefined' ? null : window.location.href, 'Record link')}>
            <Link2 /> Copy link to this record
          </ContactActionMenuItem>
          <ContactActionMenuSeparator />
          {householdId ? (
            <>
              <ContactActionMenuItem onSelect={() => router.push(`/app/opportunities/new?household=${householdId}`)}>
                <Target /> New opportunity
              </ContactActionMenuItem>
              <ContactActionMenuItem onSelect={() => router.push(`/app/households/${householdId}`)}>
                <UserRound /> Open household record
              </ContactActionMenuItem>
            </>
          ) : (
            <ContactActionMenuItem onSelect={() => router.push('/app/households/new')}>
              <Plus /> Create a household
            </ContactActionMenuItem>
          )}
          <ContactActionMenuSeparator />
          <ContactActionMenuItem disabled={busy} onSelect={() => setStatus(archived ? 'active' : 'archived')}>
            {archived ? <ArchiveRestore /> : <Archive />} {archived ? 'Restore contact' : 'Archive contact'}
          </ContactActionMenuItem>
          <ContactActionMenuItem destructive disabled={busy} onSelect={() => setConfirmDelete(true)}>
            <Trash2 /> Delete contact
          </ContactActionMenuItem>
        </ContactActionMenu>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${name}?`}
        consequence="The contact is removed from every working view. Linked policies, opportunities, and appointments are detached, not deleted. This cannot be undone from the UI."
        confirmLabel="Delete contact"
        destructive
        typedConfirmation="DELETE"
        pending={busy}
        onConfirm={remove}
      />
    </>
  )
}

const shellOutline =
  'h-9 border-shell-border/70 bg-shell-raised/50 text-shell-foreground shadow-none hover:border-accent/60 hover:bg-shell-raised hover:text-shell-foreground focus-visible:ring-accent focus-visible:ring-offset-shell'

function ChannelSegment({
  href,
  icon: Icon,
  label,
  availability,
}: {
  href: string | null
  icon: React.ComponentType<{ className?: string }>
  label: string
  availability: ChannelAvailability
}) {
  const blocked = availability.state === 'revoked' || availability.state === 'suppressed'
  const base =
    'inline-flex items-center gap-1.5 px-3 text-[13px] font-medium transition-[background,filter] duration-fast border-l border-white/15 first:border-l-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent'

  if (!href) {
    return (
      <span
        aria-disabled="true"
        title={`No ${label.toLowerCase()} destination on file`}
        className={cn(base, 'cursor-not-allowed bg-shell-raised/70 text-shell-muted')}
      >
        <Icon className="h-4 w-4 opacity-60" aria-hidden /> {label}
        <span className="sr-only">— nothing on file</span>
      </span>
    )
  }

  return (
    <a
      href={href}
      title={`${label} — ${availability.label}`}
      className={cn(
        base,
        blocked
          ? 'bg-[hsl(var(--status-blocked))] text-white hover:brightness-110'
          : 'brand-fill text-primary-foreground hover:brightness-110 active:brightness-95',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden /> {label}
      {blocked ? (
        <span aria-hidden className="ml-0.5 h-1.5 w-1.5 rounded-full bg-white/90" title={availability.label} />
      ) : null}
      <span className="sr-only">— {availability.label}</span>
    </a>
  )
}

/** Inline copy-to-clipboard affordance used beside identity values. */
export function CopyValue({ value, what, className }: { value: string; what: string; className?: string }) {
  const [done, setDone] = React.useState(false)
  React.useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1600)
    return () => clearTimeout(t)
  }, [done])

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          toast.success(`${what} copied`)
        } catch {
          toast.error(`Could not copy the ${what.toLowerCase()}`)
        }
      }}
      aria-label={`Copy ${what.toLowerCase()}`}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-shell-muted opacity-0 transition-[opacity,color,background] duration-fast',
        'hover:bg-shell-raised hover:text-shell-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'group-hover/fact:opacity-100 group-focus-within/fact:opacity-100',
        done && 'text-status-won opacity-100',
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  )
}
