import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { MonoLabel, Money } from '@/components/ui/typography'
import type { ShellData, AgentState } from '@/lib/data/shell'

/*
 * The character panels that make the shell feel like Markist's own tool
 * (docs/design-system.md §5.1 + §5.3) — carried forward from the legacy Command
 * Center. Rendered inside the dark shell, so they read the shell-* tokens.
 */

// ─── §5.1 Identity lockup — top of sidebar ────────────────────────────────────

export function IdentityLockup({ portalLabel }: { portalLabel: string }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-primary text-lg font-semibold text-primary-foreground shadow-elev-md ring-1 ring-white/10">
        M
      </div>
      <div className="min-w-0">
        <div className="truncate text-[17px] font-semibold leading-tight text-shell-foreground">Markist</div>
        <MonoLabel muted={false} className="text-shell-muted">
          {portalLabel}
        </MonoLabel>
      </div>
    </div>
  )
}

// ─── Shared panel chrome ──────────────────────────────────────────────────────

function Panel({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className="space-y-2">
      <MonoLabel muted={false} className="px-1 text-shell-muted">
        {label}
      </MonoLabel>
      <div className={cn('rounded-lg border border-shell-border bg-shell-raised p-3', className)}>{children}</div>
    </section>
  )
}

const DOT: Record<AgentState, string> = {
  running: 'bg-status-won',
  idle: 'bg-accent',
  escalated: 'bg-gold',
}

// ─── §5.3A AI AGENTS — LIVE STATUS ────────────────────────────────────────────

export function AiLiveStatusPanel({
  agents,
  escalations,
}: {
  agents: ShellData['agents']
  escalations: number
}) {
  return (
    <Panel label="AI Agents">
      <MonoLabel muted={false} className="mb-2 text-shell-muted">
        Live Status
      </MonoLabel>
      <ul className="space-y-1.5">
        {agents.map((a) => (
          <li key={a.key} className="flex items-center gap-2 text-[13px] text-shell-foreground/90">
            <span
              className={cn('h-2 w-2 shrink-0 rounded-full', a.isGuardrail ? 'bg-status-won' : DOT[a.state])}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <span className="numeric text-xs text-shell-muted">
              {a.isGuardrail ? '✓' : a.active > 0 ? a.active : '—'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-shell-border pt-2">
        <Link href="/app/ai" className="mono-label text-accent hover:underline">
          Open AI Operations →
        </Link>
        {escalations > 0 ? (
          <Link
            href="/app/ai/escalations"
            className="numeric rounded-[4px] bg-gold/15 px-1.5 py-0.5 text-[11px] font-medium text-gold hover:bg-gold/25"
          >
            {escalations} escalated
          </Link>
        ) : null}
      </div>
    </Panel>
  )
}

// ─── §5.3B CURRENT GDC TIER (gold — the signature card) ────────────────────────

export function GdcTierPanel({ tier }: { tier: ShellData['tier'] }) {
  return (
    <Link href="/app/commissions" className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg">
      <section className="space-y-2">
        <MonoLabel muted={false} className="px-1 text-shell-muted">
          Current GDC Tier
        </MonoLabel>
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-3">
          <div className="numeric text-[22px] font-semibold leading-none text-gold">
            {tier.label} — {tier.rateLabel}
          </div>
          <div className="mt-1 text-xs text-shell-muted">{tier.range} GDC</div>
          <span className="mt-2 inline-flex h-[22px] items-center rounded-[4px] border border-gold/40 bg-gold/15 px-2 font-mono text-[10px] font-medium uppercase tracking-wider text-gold">
            config default — verify
          </span>
        </div>
      </section>
    </Link>
  )
}

// ─── §5.3C FFS KEY CONTACTS — QUICK ACCESS ────────────────────────────────────

function telHref(tel: string): string {
  return `tel:${tel.replace(/[^\d+]/g, '')}`
}

export function FfsContactsPanel({ contacts }: { contacts: ShellData['contacts'] }) {
  return (
    <Panel label="FFS Key Contacts">
      <MonoLabel muted={false} className="mb-2 text-shell-muted">
        Quick Access
      </MonoLabel>
      <ul className="space-y-2.5">
        {contacts.map((c) => (
          <li key={`${c.role}-${c.tel}`} className="space-y-0.5">
            <div className="text-[11px] text-shell-muted">{c.role}</div>
            <div className="text-[13px] text-shell-foreground">{c.name}</div>
            <a href={telHref(c.tel)} className="numeric text-xs text-accent hover:underline">
              {c.tel}
              {'ext' in c && c.ext ? ` ${c.ext}` : ''}
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ─── Composed panel stack for the FSA sidebar ─────────────────────────────────

export function ShellCharacterPanels({ data }: { data: ShellData }) {
  return (
    <div className="space-y-4">
      <AiLiveStatusPanel agents={data.agents} escalations={data.escalations} />
      <GdcTierPanel tier={data.tier} />
      <FfsContactsPanel contacts={data.contacts} />
    </div>
  )
}
