'use client'

// Public upcoming-workshops index (/events). Lists open workshops with links to
// their registration pages (/events/[id]).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Calendar, MapPin, ArrowRight, Sunrise, ShieldCheck, RefreshCw, Briefcase, LineChart } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PublicPage, PublicAlert } from '@/components/public/PublicShell'
import { Skeleton } from '@/components/ui/skeleton'

interface EventItem {
  workshop_id: string
  title: string
  topic: string
  scheduled_at: string | null
  location: string | null
}

const TOPIC_ICON: Record<string, LucideIcon> = {
  retirement: Sunrise,
  life: ShieldCheck,
  opra: RefreshCw,
  business: Briefcase,
  general: LineChart,
}

export default function EventsIndex() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/events')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setEvents(d.events || []))
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <PublicPage>
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Upcoming workshops</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Free educational sessions on retirement, life, and financial planning.
        </p>

        <div className="mt-6 space-y-3">
          {loading && (
            <div role="status" aria-busy className="space-y-3">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <span className="sr-only">Loading workshops…</span>
            </div>
          )}

          {err && <PublicAlert>Could not load workshops: {err}</PublicAlert>}

          {!loading && !err && events.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-elev-xs">
              No upcoming workshops right now — check back soon.
            </div>
          )}

          {!loading && !err && events.map((e) => {
            const Icon = TOPIC_ICON[e.topic] || Calendar
            const when = e.scheduled_at
              ? new Date(e.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
              : 'Date TBA'
            return (
              <Link
                key={e.workshop_id}
                href={`/events/${e.workshop_id}`}
                className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-elev-xs transition-all hover:border-primary/40 hover:shadow-elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground">{e.title}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{when}</span>
                  </div>
                  {e.location && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{e.location}</span>
                    </div>
                  )}
                </div>
                <span className="mt-1 flex items-center gap-1 whitespace-nowrap text-sm font-medium text-primary">
                  Register
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </PublicPage>
  )
}
