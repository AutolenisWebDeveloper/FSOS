'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/social/adapters'
import { PLATFORM_LABELS, PLATFORM_BODY_LIMITS } from '@/lib/social/labels'

interface Variant {
  platform: string
  body: string
  hashtags: string[]
}

export function DraftEditor() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['youtube'])
  const [campaignTag, setCampaignTag] = useState('')
  const [link, setLink] = useState('')

  // AI assist state
  const [topic, setTopic] = useState('')
  const [aiVariants, setAiVariants] = useState<Variant[]>([])
  const [aiFlags, setAiFlags] = useState<string[]>([])
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()

  function togglePlatform(p: SocialPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  async function draftWithAI() {
    setError(null)
    setAiMessage(null)
    setDrafting(true)
    try {
      const resp = await fetch('/api/social/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, platforms, campaign_tag: campaignTag || undefined }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'AI drafting is unavailable right now.')
        return
      }
      setAiVariants(data.variants || [])
      setAiFlags(data.flags || [])
      setAiMessage(data.needsReview ? data.message || 'This draft needs extra review before use.' : null)
    } finally {
      setDrafting(false)
    }
  }

  function applyVariant(v: Variant) {
    setBody(v.hashtags.length ? `${v.body}\n\n${v.hashtags.join(' ')}` : v.body)
  }

  function save() {
    setError(null)
    if (!body.trim()) {
      setError('Add some content before saving.')
      return
    }
    if (platforms.length === 0) {
      setError('Choose at least one target platform.')
      return
    }
    startSave(async () => {
      const resp = await fetch('/api/social/content', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title || undefined,
          body,
          platforms,
          campaign_tag: campaignTag || undefined,
          link: link || undefined,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || 'Could not save the draft.')
        return
      }
      router.push(`/app/social/content/${data.content.id}`)
    })
  }

  const previews = useMemo(
    () =>
      platforms.map((p) => ({
        platform: p,
        limit: PLATFORM_BODY_LIMITS[p],
        over: body.length > PLATFORM_BODY_LIMITS[p],
      })),
    [platforms, body],
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        {/* AI assist */}
        <div className="rounded-lg border border-shell-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Draft with AI
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Grounded in your knowledge library. The AI drafts variants for your review — it never publishes or recommends a product.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Topic for AI draft"
              placeholder="Topic, e.g. how term life conversion works"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <Button type="button" variant="secondary" onClick={draftWithAI} disabled={drafting || !topic.trim() || platforms.length === 0}>
              {drafting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1 h-4 w-4" aria-hidden />}
              Draft
            </Button>
          </div>
          {aiMessage ? (
            <p className="mt-3 flex items-start gap-2 rounded-md border border-status-assumption/40 bg-status-assumption/10 p-2 text-xs text-status-assumption">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {aiMessage}
                {aiFlags.length ? ` (${aiFlags.join(', ')})` : ''}
              </span>
            </p>
          ) : null}
          {aiVariants.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {aiVariants.map((v, i) => (
                <li key={i} className="rounded-md border border-shell-border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">{PLATFORM_LABELS[v.platform as SocialPlatform] ?? v.platform}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => applyVariant(v)}>
                      Use this
                    </Button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{v.body}</p>
                  {v.hashtags.length ? <p className="mt-1 text-xs text-primary">{v.hashtags.join(' ')}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Editor */}
        <div className="space-y-3 rounded-lg border border-shell-border bg-card p-4">
          <div>
            <Label htmlFor="content-title">Title (optional)</Label>
            <Input id="content-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Internal title" />
          </div>
          <div>
            <Label htmlFor="content-body">Content</Label>
            <textarea
              id="content-body"
              className="mt-1 min-h-[180px] w-full rounded-md border border-shell-border bg-background px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your post, or draft one with AI above."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="content-campaign">Campaign / topic tag (optional)</Label>
              <Input id="content-campaign" value={campaignTag} onChange={(e) => setCampaignTag(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="content-link">Link (optional)</Label>
              <Input id="content-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Target platforms</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SOCIAL_PLATFORMS.map((p) => {
                const on = platforms.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    aria-pressed={on}
                    className={
                      'rounded-md border px-3 py-1 text-sm ' +
                      (on ? 'border-primary bg-primary-soft text-primary' : 'border-shell-border bg-background text-muted-foreground')
                    }
                  >
                    {PLATFORM_LABELS[p]}
                  </button>
                )
              })}
            </div>
          </fieldset>
          {error ? (
            <p className="text-sm text-status-lost" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save draft
            </Button>
          </div>
        </div>
      </div>

      {/* Previews */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">Platform previews</p>
        {previews.length === 0 ? (
          <p className="text-sm text-muted-foreground">Select a platform to preview.</p>
        ) : (
          previews.map((pv) => (
            <div key={pv.platform} className="rounded-lg border border-shell-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{PLATFORM_LABELS[pv.platform]}</span>
                <span className={'text-xs ' + (pv.over ? 'text-status-lost' : 'text-muted-foreground')}>
                  {body.length}/{pv.limit}
                </span>
              </div>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">{body || 'Nothing to preview yet.'}</p>
              {pv.over ? <p className="mt-1 text-xs text-status-lost">Over the {PLATFORM_LABELS[pv.platform]} limit — trim before scheduling.</p> : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
