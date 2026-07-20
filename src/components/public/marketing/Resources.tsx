import * as React from 'react'
import Link from 'next/link'
import { CalendarDays, HelpCircle, MessagesSquare, ArrowRight, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Section, SectionIntro } from './section'
import { Reveal } from './Reveal'

const RESOURCE_LINKS: { icon: LucideIcon; title: string; body: string; href: string; cta: string; external?: boolean }[] = [
  {
    icon: CalendarDays,
    title: 'Educational workshops',
    body: 'Attend a no-pressure session on retirement, life insurance, and planning basics.',
    href: '/events',
    cta: 'See upcoming workshops',
  },
  {
    icon: HelpCircle,
    title: 'Common questions',
    body: 'Straight answers to the questions people ask most before they get started.',
    href: '#faq',
    cta: 'Read the FAQ',
  },
  {
    icon: MessagesSquare,
    title: 'Ask Markist directly',
    body: 'Have a specific question? Send a message and get a personal response.',
    href: '#contact',
    cta: 'Get in touch',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How much life insurance do I actually need?',
    a: 'It depends on your income, debts, dependents, and goals. In a consultation we walk through a simple needs analysis together so the number is grounded in your real situation — not a rule of thumb.',
  },
  {
    q: 'When should I start planning for retirement?',
    a: 'The earlier the better, but it is rarely too late to improve your position. We look at where you stand today and build a strategy for income and protection that fits your timeline.',
  },
  {
    q: 'What is the difference between term and permanent life insurance?',
    a: 'Term covers you for a set period at a lower cost; permanent coverage lasts your lifetime and can build value. The right fit depends on your goals — we compare the options in plain language.',
  },
  {
    q: 'How do investments and annuities fit into a plan?',
    a: 'They are tools for growth and dependable income. Securities are offered through Farmers Financial Solutions, LLC (Member FINRA & SIPC). Any specific recommendation is made personally through the appropriate licensed, supervised channel.',
  },
  {
    q: 'Is there any cost or obligation to talk?',
    a: 'No. The initial consultation is complimentary and there is no obligation. It is simply a conversation about your goals and how I may be able to help.',
  },
  {
    q: 'How is my personal information protected?',
    a: 'Information is handled in access-controlled systems with encryption in transit, and documents live in a private repository. You choose how we contact you and can opt out at any time.',
  },
]

export function Resources() {
  return (
    <Section id="resources" tone="canvas">
      <SectionIntro
        kicker="Learn & explore"
        title="Educational resources"
        lead="General information to help you make confident decisions. This content is educational only — not individualized legal, tax, investment, or financial advice."
      />

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {RESOURCE_LINKS.map((r, i) => (
          <Reveal
            key={r.title}
            delay={i * 70}
            className="group flex flex-col rounded-2xl border border-border bg-card p-6 shadow-elev-xs transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-elev-md"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10">
              <r.icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-foreground">{r.title}</h3>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
            {r.href.startsWith('/') ? (
              <Link
                href={r.href}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
              >
                {r.cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ) : (
              <a
                href={r.href}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
              >
                {r.cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </a>
            )}
          </Reveal>
        ))}
      </div>

      {/* FAQ — native details/summary: accessible, keyboard-friendly, no JS needed. */}
      <div id="faq" className="mx-auto mt-16 max-w-3xl scroll-mt-24">
        <h3 className="text-center text-xl font-bold tracking-tight text-foreground">Frequently asked questions</h3>
        <div className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="text-[0.975rem]">{item.q}</span>
                <Plus className="h-5 w-5 shrink-0 text-primary transition-transform duration-300 group-open:rotate-45" aria-hidden />
              </summary>
              <div className="px-5 pb-5 text-[0.95rem] leading-relaxed text-muted-foreground">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  )
}
