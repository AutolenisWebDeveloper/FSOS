import * as React from 'react'
import { CalendarCheck, Search, PenTool, LineChart } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Section, SectionIntro } from './section'
import { Reveal } from './Reveal'

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: CalendarCheck, title: 'Schedule a consultation', body: 'Choose a convenient time to talk through what’s on your mind — no pressure, no obligation.' },
  { icon: Search, title: 'Analyze your goals', body: 'We review your family, financial situation, priorities, and concerns together.' },
  { icon: PenTool, title: 'Build your strategy', body: 'You get personalized recommendations aligned with your needs and objectives.' },
  { icon: LineChart, title: 'Protect & grow', body: 'We implement the agreed strategy and keep an ongoing service relationship.' },
]

export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="canvas">
      <SectionIntro
        align="center"
        kicker="How it works"
        title="A simple process, designed around you"
        lead="Four clear steps from first conversation to an ongoing plan that keeps working."
      />

      <ol className="relative mt-14 grid gap-8 md:grid-cols-4">
        {/* Connecting rail (desktop) */}
        <div aria-hidden className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
        {STEPS.map((s, i) => (
          <Reveal as="li" key={s.title} delay={i * 90} className="relative flex flex-col items-center text-center md:items-center">
            <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-card text-primary shadow-elev-md ring-1 ring-border">
              <s.icon className="h-6 w-6" aria-hidden />
              <span className="numeric absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white ring-2 ring-background">
                {i + 1}
              </span>
            </div>
            <h3 className="mt-5 text-base font-semibold text-foreground">{s.title}</h3>
            <p className="mt-1.5 max-w-[15rem] text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </Reveal>
        ))}
      </ol>

      <p className="mx-auto mt-10 max-w-xl text-center text-xs text-muted-foreground">
        Every plan is personalized. This process describes how we work together and does not imply any guaranteed
        outcome.
      </p>
    </Section>
  )
}
