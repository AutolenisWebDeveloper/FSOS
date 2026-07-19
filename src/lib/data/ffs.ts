// src/lib/data/ffs.ts
// Loader for the config-driven FFS key-contacts directory (docs/legacy-port.md §2.4).
// Feeds the sidebar QUICK ACCESS panel (design-system.md §5.3C) and the
// /super/config/ffs-contacts editor. Contacts are config, never hard-coded.

import { load } from '@/lib/data/query'

export interface FfsContact {
  id: string
  slug: string
  role: string
  name: string | null
  phone: string
  hours: string | null
  note: string | null
  active: boolean
  sort: number
}

type LoadOutcome =
  | { ok: false; notConfigured: boolean; message: string }
  | { ok: true; contacts: FfsContact[] }

/** All FFS contacts ordered for display. `activeOnly` for the sidebar panel. */
export async function loadFfsContacts(activeOnly = false): Promise<LoadOutcome> {
  const res = await load<FfsContact[]>((db) => {
    let q = db
      .from('ffs_contacts')
      .select('id, slug, role, name, phone, hours, note, active, sort')
      .order('sort', { ascending: true })
      .order('role', { ascending: true })
    if (activeOnly) q = q.eq('active', true)
    return q
  }, [])

  if (!res.ok) return { ok: false, notConfigured: res.kind === 'not_configured', message: res.message }
  return { ok: true, contacts: res.data }
}
