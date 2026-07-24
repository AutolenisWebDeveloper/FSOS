'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SOCIAL_PLATFORMS } from '@/lib/social/adapters'
import { PLATFORM_LABELS } from '@/lib/social/labels'

// Register a platform account. Live OAuth (which stores the encrypted credential)
// activates with each platform's slice; here we register the account so it appears
// in the roster as `not_configured` until credentials are connected.
export function ConnectChannel() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState<string>(SOCIAL_PLATFORMS[0])
  const [displayName, setDisplayName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const resp = await fetch('/api/social/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform,
          display_name: displayName || undefined,
          external_account_id: accountId || undefined,
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        setError(body.error || 'Could not register the account. Please try again.')
        return
      }
      setOpen(false)
      setDisplayName('')
      setAccountId('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        Register account
      </Button>
    )
  }

  return (
    <div className="w-full rounded-lg border border-shell-border bg-card p-4 sm:w-[28rem]">
      <p className="mb-3 text-sm font-semibold text-foreground">Register a platform account</p>
      <div className="space-y-3">
        <div>
          <Label htmlFor="social-platform">Platform</Label>
          <select
            id="social-platform"
            className="mt-1 w-full rounded-md border border-shell-border bg-background px-3 py-2 text-sm"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="social-display-name">Display name (optional)</Label>
          <Input
            id="social-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Markist FSA — YouTube"
          />
        </div>
        <div>
          <Label htmlFor="social-account-id">Account / handle (optional)</Label>
          <Input
            id="social-account-id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Platform account id or handle"
          />
        </div>
        {error ? (
          <p className="text-sm text-status-lost" role="alert">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Registering adds the account to the roster. Connecting live credentials (OAuth) activates
          publishing once platform API access is obtained.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Register
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DisconnectChannel({ id, platformLabel }: { id: string; platformLabel: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  function disconnect() {
    startTransition(async () => {
      const resp = await fetch(`/api/social/channels/${id}`, { method: 'DELETE' })
      if (resp.ok) router.refresh()
      setConfirming(false)
    })
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Disconnect
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Disconnect {platformLabel}?</span>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      <Button variant="destructive" size="sm" onClick={disconnect} disabled={pending}>
        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
        Confirm
      </Button>
    </div>
  )
}
