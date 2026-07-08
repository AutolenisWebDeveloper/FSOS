import { NextRequest, NextResponse } from 'next/server'

// Gates the internal command-center UI (served at "/") behind HTTP Basic auth.
// Public client/agency routes (/[slug], /forms/*, /upload/*) and API routes are
// NOT matched here — API routes enforce their own per-branch auth via
// requireInternalAuth(), and the public pages are meant to be reachable.
//
// Protection activates only when FSOS_ADMIN_PASSWORD is set, so existing
// deployments keep working until the owner opts in by setting the env vars.

export const config = {
  matcher: ['/'],
}

export function middleware(req: NextRequest) {
  const expectedPass = process.env.FSOS_ADMIN_PASSWORD
  if (!expectedPass) return NextResponse.next()

  const expectedUser = process.env.FSOS_ADMIN_USER || 'markist'
  const header = req.headers.get('authorization') || ''

  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      const idx = decoded.indexOf(':')
      const user = decoded.slice(0, idx)
      const pass = decoded.slice(idx + 1)
      if (user === expectedUser && pass === expectedPass) {
        return NextResponse.next()
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
