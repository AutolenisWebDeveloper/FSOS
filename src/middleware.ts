import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { evaluateAccess, toRoles, type Role, type SessionClaims } from '@/lib/auth/rbac'

// Two responsibilities, in order:
//  1. The legacy command center at "/" is RETIRED. "/" now redirects to the
//     official dashboard at /app (which enforces the portal auth below). The
//     old HTTP Basic gate is gone with it.
//  2. The coarse portal gate (middleware-auth.md §4) for /app, /admin,
//     /compliance, /partner, /client, /super — auth redirect + role + MFA. Fine-
//     grained row authorization stays in RLS + layout guards (never here).

export const config = {
  // Everything except Next internals, static assets, and API routes (which
  // enforce their own auth / cron secrets).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|icon.svg|api/).*)'],
}

/** Decode the `aal` claim from a Supabase access-token JWT without a network call. */
function aalFromJwt(token: string | undefined): string | null {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    return typeof json.aal === 'string' ? json.aal : null
  } catch {
    return null
  }
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // (1) The legacy command center at "/" is retired — send everyone to the
  // official /app dashboard, which then enforces the portal auth gate below.
  if (path === '/') {
    return NextResponse.redirect(new URL('/app', req.url))
  }

  // (2) Portal gate. Build a response we can attach refreshed auth cookies to.
  const res = NextResponse.next()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  let session: SessionClaims | null = null
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          for (const { name, value, options } of list) res.cookies.set({ name, value, ...options })
        },
      },
    })
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const {
        data: { session: sess },
      } = await supabase.auth.getSession()
      const aal = aalFromJwt(sess?.access_token)
      const roles: Role[] = toRoles((user.app_metadata as Record<string, unknown> | undefined)?.roles)
      const mfaSatisfied = aal === 'aal2'
      session = { userId: user.id, roles, mfaSatisfied, stepUpFresh: mfaSatisfied }
    }
  }

  const decision = evaluateAccess(path, session)
  if (decision.action === 'allow') return res
  if (decision.action === 'redirect') {
    return NextResponse.redirect(new URL(decision.to, req.url))
  }
  // forbid → rewrite to /403 (never a blank page).
  return NextResponse.rewrite(new URL('/403', req.url))
}
