'use client'

import * as React from 'react'
import { Calendar, MapPin, Video, Users, ArrowRight, CalendarX } from 'lucide-react'
import type { PublicWorkshopCard } from '@/lib/workshops/public'

// Client-side filtering for the public workshop hub (/workshops). Operates over the
// server-loaded real cards (published-only) — filters by topic, format, and presenter.
// No data is fabricated here; it only narrows the real list.

const FORMAT_LABEL: Record<string, string> = { in_person: 'In person', virtual: 'Online', hybrid: 'Hybrid' }

function formatWhen(iso: string | null): string {
  if (!iso) return 'Date to be announced'
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function FormatBadge({ mode }: { mode: string }) {
  const Icon = mode === 'virtual' ? Video : mode === 'hybrid' ? Users : MapPin
  const cls = mode === 'virtual' ? 'wbadge wbadge--virtual' : mode === 'hybrid' ? 'wbadge wbadge--hybrid' : 'wbadge'
  return (
    <span className={cls}>
      <Icon aria-hidden /> {FORMAT_LABEL[mode] ?? 'In person'}
    </span>
  )
}

export function WorkshopHubFilters({ cards }: { cards: PublicWorkshopCard[] }) {
  const topics = React.useMemo(() => Array.from(new Set(cards.map((c) => c.topic))).sort(), [cards])
  const formats = React.useMemo(() => Array.from(new Set(cards.map((c) => c.delivery_mode))), [cards])
  const presenters = React.useMemo(
    () => Array.from(new Set(cards.flatMap((c) => c.presenters.map((p) => p.name)))).sort(),
    [cards],
  )

  const [topic, setTopic] = React.useState<string>('all')
  const [format, setFormat] = React.useState<string>('all')
  const [presenter, setPresenter] = React.useState<string>('all')

  const filtered = cards.filter((c) => {
    if (topic !== 'all' && c.topic !== topic) return false
    if (format !== 'all' && c.delivery_mode !== format) return false
    if (presenter !== 'all' && !c.presenters.some((p) => p.name === presenter)) return false
    return true
  })

  return (
    <div>
      <div className="wfilters">
        <div className="wfilters__group" role="group" aria-label="Filter by topic">
          <span className="wflabel">Topic</span>
          <button className="wchip" aria-pressed={topic === 'all'} onClick={() => setTopic('all')}>
            All
          </button>
          {topics.map((t) => (
            <button key={t} className="wchip" aria-pressed={topic === t} onClick={() => setTopic(t)} style={{ textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>
        {formats.length > 1 ? (
          <div className="wfilters__group" role="group" aria-label="Filter by format">
            <span className="wflabel">Format</span>
            <button className="wchip" aria-pressed={format === 'all'} onClick={() => setFormat('all')}>
              All
            </button>
            {formats.map((f) => (
              <button key={f} className="wchip" aria-pressed={format === f} onClick={() => setFormat(f)}>
                {FORMAT_LABEL[f] ?? f}
              </button>
            ))}
          </div>
        ) : null}
        {presenters.length > 1 ? (
          <div className="wfilters__group">
            <label className="wflabel" htmlFor="wpresenter">
              Presenter
            </label>
            <select id="wpresenter" className="wselect" value={presenter} onChange={(e) => setPresenter(e.target.value)}>
              <option value="all">All presenters</option>
              {presenters.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <p className="wcount" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? 'workshop' : 'workshops'}
      </p>

      {filtered.length === 0 ? (
        <div className="wempty reveal">
          <CalendarX aria-hidden />
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--navy)' }}>No workshops match those filters</p>
          <p style={{ margin: '6px 0 0' }}>Try clearing a filter, or check back soon for new sessions.</p>
        </div>
      ) : (
        <div className="wgrid">
          {filtered.map((c) => {
            const href = c.slug ? `/workshops/${c.slug}` : `/events/${c.workshop_id}`
            const orgs = Array.from(new Set(c.presenters.map((p) => p.org).filter(Boolean))) as string[]
            return (
              <a key={c.workshop_id} href={href} className="wcard reveal">
                <div className="wcard__top" aria-hidden />
                <div className="wcard__body">
                  <div className="wcard__row">
                    <span className="wtopic">{c.topic}</span>
                    <FormatBadge mode={c.delivery_mode} />
                  </div>
                  <h3>{c.title}</h3>
                  {c.description ? <p className="wcard__desc">{c.description}</p> : null}
                  <ul className="wcard__meta">
                    <li>
                      <Calendar aria-hidden /> {formatWhen(c.starts_at)}
                    </li>
                    {c.presenters.length > 0 ? (
                      <li className="wcard__pres">
                        <Users aria-hidden />{' '}
                        {c.presenters
                          .slice(0, 2)
                          .map((p) => p.name)
                          .join(', ')}
                        {orgs.length ? ` · ${orgs[0]}` : ''}
                      </li>
                    ) : null}
                  </ul>
                </div>
                <div className="wcard__foot">
                  {c.is_full ? (
                    <span className="wseats wseats--full">Waitlist only</span>
                  ) : c.seats_remaining != null ? (
                    <span className="wseats">{c.seats_remaining} seats left</span>
                  ) : (
                    <span className="wseats" style={{ color: 'var(--slate)' }}>
                      Open registration
                    </span>
                  )}
                  <span className="wcard__cta">
                    {c.is_full ? 'Join waitlist' : 'View & register'} <ArrowRight aria-hidden />
                  </span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
