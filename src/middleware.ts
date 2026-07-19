import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { evaluateAccess, toRoles, type Role, type SessionClaims } from '@/lib/auth/rbac'
import { unconfiguredInternalAuthAllowed } from '@/lib/auth/config-gate'

// Two responsibilities, in order:
//  1. Legacy: the internal command center at "/" stays behind HTTP Basic auth
//     (unchanged from the original FSOS — activates only when FSOS_ADMIN_PASSWORD
//     is set). Legacy modules are intentionally left untouched.
//  2. New: the coarse portal gate (middleware-auth.md §4) for /app, /admin,
//     /compliance, /partner, /client, /super — auth redirect + role + MFA. Fine-
//     grained row authorization stays in RLS + layout guards (never here).

export const config = {
  // Everything except Next internals, static assets, and API routes (which
  // enforce their own auth / cron secrets).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|icon.svg|api/).*)'],
}

function legacyBasicAuth(req: NextRequest): NextResponse | null {
  const expectedPass = process.env.FSOS_ADMIN_PASSWORD
  if (!expectedPass) {
    // No password configured: fail CLOSED in production (challenge with no valid
    // credential = locked until one is set); allow local/dev to pass through.
    if (unconfiguredInternalAuthAllowed()) return null
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="FSOS Command Center", charset="UTF-8"' },
    })
  }
  const expectedUser = process.env.FSOS_ADMIN_USER || 'markist'
  const header = req.headers.get('authorization') || ''
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      const idx = decoded.indexOf(':')
      if (decoded.slice(0, idx) === expectedUser && decoded.slice(idx + 1) === expectedPass) {
        return null // authorized → continue
      }
    } catch {
      /* fall through to challenge */
    }
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="FSOS Command Center", charset="UTF-8"' },
  })
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

  // (1) Legacy command center at "/".
  if (path === '/') {
    const challenge = legacyBasicAuth(req)
    return challenge ?? NextResponse.next()
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
