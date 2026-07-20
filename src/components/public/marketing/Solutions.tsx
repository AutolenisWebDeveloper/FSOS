import * as React from 'react'
import {
  Shield,
  Sunrise,
  TrendingUp,
  GraduationCap,
  PiggyBank,
  Briefcase,
  Scale,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Section, SectionIntro } from './section'
import { Reveal } from './Reveal'
import { Button } from '@/components/ui/button'
import { bookingUrl } from '@/lib/site'

const SOLUTIONS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Shield, title: 'Life Insurance', body: 'Term and permanent coverage matched to your family, income, and goals.' },
  { icon: Sunrise, title: 'Retirement Planning', body: 'Strategies to help build income you can rely on through retirement.' },
  { icon: TrendingUp, title: 'Investment Solutions', body: 'Goals-aligned strategies built around your timeline and risk tolerance.' },
  { icon: GraduationCap, title: 'College Planning', body: 'Save with intention for a child’s or grandchild’s education.' },
  { icon: PiggyBank, title: 'Annuities', body: 'Options that can create dependable, lasting retirement income.' },
  { icon: Briefcase, title: 'Business Protection', body: 'Protect your business, your people, and your continuity plans.' },
  { icon: Scale, title: 'Estate & Legacy Planning', body: 'Coordinate protection so your legacy passes the way you intend.' },
  { icon: ClipboardCheck, title: 'Financial Reviews', body: 'A clear, no-pressure look at where you stand and your options.' },
]

export function Solutions() {
  const book = bookingUrl()
  const external = book.startsWith('http')
  return (
    <Section id="solutions" tone="sunken">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <SectionIntro
          kicker="Solutions for every stage of life"
          title="Comprehensive solutions to protect what matters"
          lead="From your first policy to a full retirement strategy — coordinated guidance that grows with you."
        />
        <Button asChild variant="outline" className="shrink-0">
          <a href="#contact">
            Talk through your options
            <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </Button>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SOLUTIONS.map((s, i) => (
          <Reveal
            as="li"
            key={s.title}
            delay={(i % 4) * 60}
            className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-elev-xs transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-elev-lg"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/10 transition-colors group-hover:bg-primary group-hover:text-white">
              <s.icon className="h-6 w-6" aria-hidden />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            <a
              href="#contact"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            >
              Learn more
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              <span className="sr-only"> about {s.title}</span>
            </a>
          </Reveal>
        ))}
      </ul>

      <p className="mt-8 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Estate and legacy planning is offered as planning coordination and education — it is not legal or tax advice.
        Please consult a qualified attorney or tax professional for those matters. Product availability varies by state
        and is subject to the issuing company’s rules.
      </p>

      <div className="mt-2 sm:hidden">
        <Button asChild variant="destructive" size="lg" className="w-full">
          <a href={book} target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}>
            Schedule a consultation
          </a>
        </Button>
      </div>
    </Section>
  )
}
