'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserCircle2, Settings, LogOut, Loader2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getBrowserClient } from '@/lib/supabase/browser'

/**
 * Topbar account menu (shared across every portal). Renders the inert profile
 * affordance as a real dropdown: the signed-in identity, a link to settings, and
 * a working sign-out that clears the cookie-backed Supabase session and returns
 * to /login. Self-contained on the client — reads the current user on mount so
 * the server shell doesn't need to thread identity through every portal layout.
 */
export function ProfileMenu({ settingsHref }: { settingsHref?: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState<string | null>(null)
  const [role, setRole] = React.useState<string | null>(null)
  const [signingOut, setSigningOut] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  // Load the current identity once (best-effort; menu still works if it fails).
  React.useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const supabase = getBrowserClient()
        const { data } = await supabase.auth.getUser()
        if (!alive) return
        setEmail(data.user?.email ?? null)
        const roles = (data.user?.app_metadata as Record<string, unknown> | undefined)?.roles
        const first = Array.isArray(roles) ? String(roles[0] ?? '') : ''
        setRole(first ? first.replace(/_/g, ' ') : null)
      } catch {
        /* Supabase not configured / offline — leave identity blank. */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Close on outside-click and Escape.
  React.useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function signOut() {
    setSigningOut(true)
    try {
      await getBrowserClient().auth.signOut()
    } catch {
      /* Even if the network call fails, still route to login. */
    }
    router.replace('/login')
    router.refresh()
  }

  const initial = (email?.trim()?.[0] ?? 'M').toUpperCase()

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg px-1.5 text-shell-muted transition-colors hover:bg-shell-raised hover:text-shell-foreground',
          open && 'bg-shell-raised text-shell-foreground',
        )}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xs font-semibold text-primary-foreground ring-1 ring-white/10">
          {initial}
        </span>
        <UserCircle2 className="hidden h-4 w-4 md:block" strokeWidth={1.75} aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 origin-top-right animate-fade-in-up overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          {/* Identity */}
          <div className="flex items-center gap-3 rounded-lg px-2.5 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-sm font-semibold text-primary-foreground ring-1 ring-white/10">
              {initial}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{email ?? 'Signed in'}</div>
              {role ? <div className="mono-label text-muted-foreground">{role}</div> : null}
            </div>
          </div>

          <div className="my-1 h-px bg-border" />

          {settingsHref ? (
            <Link
              href={settingsHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-muted"
            >
              <Settings className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <span className="flex-1">Settings</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            )}
            <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
