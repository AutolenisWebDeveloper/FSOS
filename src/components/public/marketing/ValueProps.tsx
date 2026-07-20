import * as React from 'react'
import { UserCog, BadgeCheck, Layers, Sparkles, HeartHandshake, Compass } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Section, SectionIntro } from './section'
import { Reveal } from './Reveal'

const VALUES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: UserCog,
    title: 'Personalized strategies',
    body: 'Plans built around your goals, your family, and what actually matters to you — never a one-size template.',
  },
  {
    icon: BadgeCheck,
    title: 'Licensed professional',
    body: 'Guidance from a life- and securities-licensed Farmers Financial Services Agent you can talk to directly.',
  },
  {
    icon: Layers,
    title: 'Insurance & investments',
    body: 'Protection and growth strategies coordinated in one relationship, so the pieces work together.',
  },
  {
    icon: Sparkles,
    title: 'AI-assisted experience',
    body: 'Technology handles reminders, follow-up, and organization — so your time with Markist stays high-value.',
  },
  {
    icon: HeartHandshake,
    title: 'Long-term relationship',
    body: 'Ongoing reviews and service as your life changes — not a single transaction and a handshake.',
  },
  {
    icon: Compass,
    title: 'Clear, trusted guidance',
    body: 'Plain-language explanations and honest options, so every decision is one you understand and own.',
  },
]

export function ValueProps() {
  return (
    <Section id="why" tone="canvas">
      <SectionIntro
        kicker="Why work with Markist"
        title="A planning partner, not a policy vendor"
        lead="The difference clients notice: real guidance, coordinated solutions, and a relationship that keeps working long after the paperwork is signed."
      />
      <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {VALUES.map((v, i) => (
          <Reveal
            as="li"
            key={v.title}
            delay={(i % 3) * 70}
            className="group flex flex-col gap-3 bg-card p-6 transition-colors hover:bg-primary-soft/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10 transition-colors group-hover:bg-primary group-hover:text-white">
              <v.icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="text-[1.05rem] font-semibold text-foreground">{v.title}</h3>
            <p className="text-[0.925rem] leading-relaxed text-muted-foreground">{v.body}</p>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}
