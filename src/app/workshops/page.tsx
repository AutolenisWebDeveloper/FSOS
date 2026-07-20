import type { Metadata } from 'next'
import Link from 'next/link'
import { Calendar, MapPin, Video, ArrowRight, Users } from 'lucide-react'
import { getDb } from '@/lib/supabase/client'
import { PublicPage, PublicAlert } from '@/components/public/PublicShell'

export const metadata: Metadata = { title: 'Educational Workshops — Markist Financial Services' }
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface HubItem {
  workshop_id: string
  slug: string | null
  title: string
  topic: string
  delivery_mode: string | null
  scheduled_at: string | null
  location: string | null
}

// Public workshop hub (/workshops). Lists PUBLISHED workshops only (the compliance
// publish gate is the single door). Extends the public shell — same brand identity as the
// rest of the FSOS public surface. Educational events only.
export default async function WorkshopsHubPage() {
  let items: HubItem[] = []
  let loadError = false
  try {
    const db = getDb()
    const { data } = await db
      .from('workshops')
      .select('workshop_id, slug, title, topic, delivery_mode, scheduled_at, location')
      .eq('status', 'published')
      .order('scheduled_at', { ascending: true })
    items = (data as HubItem[]) ?? []
  } catch {
    loadError = true
  }

  return (
    <PublicPage>
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Educational workshops</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Free educational sessions on retirement, life insurance, and financial planning. In person and online.
        </p>

        <div className="mt-6 space-y-3">
          {loadError ? (
            <PublicAlert>We couldn&apos;t load workshops right now. Please try again shortly.</PublicAlert>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-elev-xs">
              No upcoming workshops right now — check back soon.
            </div>
          ) : (
            items.map((w) => {
              const href = w.slug ? `/workshops/${w.slug}` : `/events/${w.workshop_id}`
              const when = w.scheduled_at
                ? new Date(w.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
                : 'Date TBA'
              const Icon = w.delivery_mode === 'virtual' ? Video : w.delivery_mode === 'hybrid' ? Users : MapPin
              const place = w.delivery_mode === 'virtual' ? 'Online' : w.delivery_mode === 'hybrid' ? 'In person + online' : w.location
              return (
                <Link
                  key={w.workshop_id}
                  href={href}
                  className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-elev-xs transition-all hover:border-primary/40 hover:shadow-elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{w.title}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{w.topic}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{when}</span>
                    </div>
                    {place ? (
                      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{place}</span>
                      </div>
                    ) : null}
                  </div>
                  <span className="mt-1 flex items-center gap-1 whitespace-nowrap text-sm font-medium text-primary">
                    Details
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </PublicPage>
  )
}
