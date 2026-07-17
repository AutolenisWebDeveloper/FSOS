'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, GitMerge, X, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { patchJson, firstFieldError } from '@/lib/client/api'

export interface ReviewCandidate { id: string; full_name: string; email: string | null; phone: string | null; contact_type: string }
export interface ReviewItem {
  id: string
  confidence: string
  conflict: boolean
  matchedBy: string[]
  incoming: Record<string, unknown>
  raw: Record<string, unknown>
  source: string
  filename: string | null
  candidates: ReviewCandidate[]
}

export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<Set<string>>(new Set())

  async function act(id: string, action: 'merge' | 'create' | 'skip', targetId?: string) {
    setBusy(id)
    const res = await patchJson(`/api/app/imports/review/${id}`, { action, ...(targetId ? { target_contact_id: targetId } : {}) })
    setBusy(null)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(action === 'merge' ? 'Merged into contact.' : action === 'create' ? 'Contact created.' : 'Skipped.')
    setDone((d) => new Set(d).add(id))
    router.refresh()
  }

  const visible = items.filter((i) => !done.has(i.id))

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{visible.length} record{visible.length === 1 ? '' : 's'} awaiting review.</p>
      {visible.map((item) => {
        const name = String(item.incoming.full_name ?? '—')
        const email = item.incoming.email ? String(item.incoming.email) : null
        const phone = item.incoming.phone ? String(item.incoming.phone) : null
        return (
          <Card key={item.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {name}
                <Badge variant="draft" className="text-[10px]">{item.confidence}</Badge>
                {item.conflict ? <Badge variant="lost" className="text-[10px]"><AlertTriangle className="mr-1 h-3 w-3" />conflict</Badge> : null}
                <span className="text-xs font-normal text-muted-foreground">from {item.filename || item.source}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {[email, phone].filter(Boolean).join(' · ') || 'no email or phone'}
                {item.matchedBy.length ? <> · matched on {item.matchedBy.join(', ')}</> : null}
              </div>

              {item.candidates.length ? (
                <div>
                  <p className="mb-1 text-xs font-medium">Possible matches</p>
                  <div className="space-y-1.5">
                    {item.candidates.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                        <div>
                          <span className="font-medium">{c.full_name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(' · ') || c.contact_type}</span>
                        </div>
                        <Button size="sm" variant="outline" disabled={busy === item.id} onClick={() => act(item.id, 'merge', c.id)}>
                          <GitMerge className="h-4 w-4" /> Merge here
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No existing contact matched reliably.</p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" disabled={busy === item.id} onClick={() => act(item.id, 'create')}><UserPlus className="h-4 w-4" /> Create new contact</Button>
                <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => act(item.id, 'skip')}><X className="h-4 w-4" /> Skip</Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
