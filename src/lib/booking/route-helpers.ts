// src/lib/booking/route-helpers.ts
// Maps a booking-config service ConfigResult failure to a client-safe HTTP response.
// Keeps NextResponse mapping out of the service layer (config.ts stays framework-free).

import { NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/http'
import type { ConfigResult } from './config'

/** Turn a `{ ok:false, kind, message }` into the right status; logs internal errors. */
export function configErrorToResponse(res: Extract<ConfigResult<unknown>, { ok: false }>, label?: string): NextResponse {
  switch (res.kind) {
    case 'not_found':
      return NextResponse.json({ error: res.message }, { status: 404 })
    case 'conflict':
      return NextResponse.json({ error: res.message }, { status: 409 })
    default:
      // 'error' = a DB/internal failure → generic message, logged server-side (§16.1).
      return internalErrorResponse(res.message, { label })
  }
}
