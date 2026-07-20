import * as React from 'react'
import { MessageSquareText, Eye, CalendarClock, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Section } from './section'
import { Reveal } from './Reveal'

const COMMITMENTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: MessageSquareText,
    title: 'Plain-language guidance',
    body: 'You’ll always understand your options in clear terms — no jargon, no pressure to decide before you’re ready.',
  },
  {
    icon: Eye,
    title: 'Transparent recommendations',
    body: 'You’ll know the “why” behind every suggestion, including trade-offs, so the decision is genuinely yours.',
  },
  {
    icon: CalendarClock,
    title: 'Responsive, ongoing service',
    body: 'Timely follow-up and regular reviews as your life changes — a relationship, not a one-time sale.',
  },
  {
    icon: ShieldCheck,
    title: 'Your privacy, respected',
    body: 'Your information is handled securely and used only to serve you. You control how we reach you.',
  },
]

export function Commitments() {
  return (
    <Section id="commitments" tone="sunken">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <div>
          <p className="mono-label text-primary">What you can expect</p>
          <h2
            className="mt-3 font-bold tracking-[-0.02em] text-foreground text-balance"
            style={{ fontSize: 'clamp(1.7rem, 3.4vw, 2.6rem)', lineHeight: 1.08 }}
          >
            A standard of service you can count on
          </h2>
          <p className="mt-4 max-w-md text-[1.05rem] leading-relaxed text-muted-foreground">
            Rather than post testimonials, here is the experience Markist commits to for every client — so you know
            exactly what working together looks like.
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            Verified client stories may appear here in the future, shared only with each client’s written consent and
            the required disclosures.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {COMMITMENTS.map((c, i) => (
            <Reveal
              as="li"
              key={c.title}
              delay={(i % 2) * 80}
              className="rounded-2xl border border-border bg-card p-6 shadow-elev-xs"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10">
                <c.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">{c.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>
  )
}
