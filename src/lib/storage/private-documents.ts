// src/lib/storage/private-documents.ts
// One implementation of "put a file in the private `documents` bucket and hand out a
// short-lived signed URL for it." The bucket is created in migration 001 with
// public=false; nothing in FSOS may build a public URL to it.
//
// This module exists so the Compliance Intelligence pipeline and the AI Knowledge
// Library do not each grow their own copy of the path-building / signing rules
// (CLAUDE.md §6: extend one subsystem, never clone it). It is deliberately data-free —
// no table names, no domain logic — so importing it never couples two bounded
// contexts together. Each caller supplies its own prefix and owns its own table.

import type { SupabaseClient } from '@supabase/supabase-js'

/** The private bucket from migration 001. Never public; signed URLs only. */
export const PRIVATE_DOCUMENTS_BUCKET = 'documents'

/** Default signed-URL lifetime. Long enough for a working session, short enough to expire. */
export const DEFAULT_SIGNED_URL_TTL = 60 * 60 * 12 // 12h

// supabase-js's generic client; the storage API is untyped by table generics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

/**
 * Sanitize a user-supplied filename into an object-name-safe segment. Strips path
 * separators, control characters, and anything outside `[A-Za-z0-9._-]` so a crafted
 * filename can never traverse out of its prefix or collide with a control path.
 */
export function safeObjectName(filename: string): string {
  const base = (filename || '').split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^a-z0-9._-]/gi, '_').replace(/^\.+/, '_').slice(0, 120)
  return cleaned || 'file'
}

/**
 * Build a collision-resistant object path: `<prefix>/<scope>/<ts>-<safe-name>`.
 * `scope` groups objects (a case id, a date folder, …). Passing null yields the
 * literal `unassigned` segment rather than omitting it, so every object keeps the
 * same three-segment shape and nothing is ever written to the prefix root.
 */
export function buildObjectPath(
  prefix: string,
  scope: string | null,
  filename: string,
  ts: number,
): string {
  return `${prefix}/${scope ?? 'unassigned'}/${ts}-${safeObjectName(filename)}`
}

/** Fresh short-lived signed URL for a stored object, or null if it can't be signed. */
export async function createSignedUrl(
  db: Db,
  storagePath: string,
  ttl: number = DEFAULT_SIGNED_URL_TTL,
): Promise<string | null> {
  if (!storagePath) return null
  try {
    const { data } = await db.storage.from(PRIVATE_DOCUMENTS_BUCKET).createSignedUrl(storagePath, ttl)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}

/**
 * Best-effort removal of stored objects. Used to roll back an orphaned upload when
 * the metadata insert fails, and to clean up bytes on a permanent delete. Never
 * throws: a storage cleanup failure must not turn a successful DB operation into a
 * 500 — it is reported to the caller so the route can log it.
 */
export async function removeObjects(db: Db, paths: string[]): Promise<{ ok: boolean; error: string | null }> {
  const targets = paths.filter(Boolean)
  if (!targets.length) return { ok: true, error: null }
  try {
    const { error } = await db.storage.from(PRIVATE_DOCUMENTS_BUCKET).remove(targets)
    return { ok: !error, error: error?.message ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Storage removal failed' }
  }
}
