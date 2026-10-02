// tests/helpers/memdb.mjs
// A STATEFUL in-memory stand-in for the supabase-js PostgREST chain, for tests that drive many
// production writers and readers against one evolving state (tests/optout-consent-property.test.mjs).
// Not a test file (tests/helpers/ is not discovered by scripts/run-tests.mjs).
//
// Unlike workshop-harness fakeDb (scripted responses), every write here lands and every read sees
// it: insert / upsert (onConflict, ignoreDuplicates) / update / delete, filters eq neq in is lt lte
// gt gte ilike not.is or(simple), order, limit, maybeSingle / single, head counts, and one embed
// (household_members → consents). Unique keys and column defaults are declared per table. The
// clock is injected (`now()`), so `created_at` / `captured_at` defaults follow the test's clock.
// snapshot() / restore() copy the whole state, which lets a test walk a tree of event sequences.
//
// Honesty note: this proves code behavior against PostgREST-shaped semantics; it is not Postgres.

const UNIQUE = {
  dnc_entries: ['contact', 'channel'],
  consents: ['member_id', 'channel'],
  comm_consent_purposes: ['member_id', 'channel', 'purpose'],
}
const DEFAULT_TS = {
  dnc_entries: ['created_at'],
  comm_contact_consents: ['captured_at', 'created_at'],
  consents: ['captured_at', 'updated_at'],
  comm_consent_purposes: ['captured_at', 'updated_at'],
  comm_messages: ['created_at'],
  comm_conversations: ['created_at', 'last_message_at'],
}
const ID_COL = { customers: 'customer_id', agency_referrals: 'referral_id', workshop_registrations: 'reg_id' }

const likeToRe = (pat) =>
  new RegExp('^' + String(pat).split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\_]/g, '\\$&')).join('.*') + '$', 'i')

const cmp = (a, b) => (a == null ? (b == null ? 0 : -1) : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0)

export function memDb({ now = () => new Date().toISOString(), failOn = null } = {}) {
  let tables = {}
  let seq = 0
  const calls = []
  const rows = (t) => (tables[t] ??= [])

  function parseOr(expr) {
    // "a.eq.x,b.ilike.%y" → predicates OR'ed
    return expr.split(',').map((part) => {
      const [col, op, ...rest] = part.split('.')
      const val = rest.join('.')
      return (r) => test(r, op, col, val)
    })
  }
  function test(r, op, col, v) {
    const x = r[col]
    switch (op) {
      case 'eq': return x === v || (x != null && v != null && String(x) === String(v))
      case 'neq': return !(x === v || String(x) === String(v))
      case 'in': return Array.isArray(v) && v.some((y) => y === x || String(y) === String(x))
      case 'is': return v === null ? x == null : x === v
      case 'lt': return x != null && cmp(x, v) < 0
      case 'lte': return x != null && cmp(x, v) <= 0
      case 'gt': return x != null && cmp(x, v) > 0
      case 'gte': return x != null && cmp(x, v) >= 0
      case 'ilike': case 'like': return x != null && likeToRe(v).test(String(x))
      default: throw new Error(`memdb: unsupported filter ${op}`)
    }
  }

  function withDefaults(table, row) {
    const r = { ...row }
    const idc = ID_COL[table] ?? 'id'
    if (r[idc] == null) r[idc] = `${table}-${++seq}`
    for (const c of DEFAULT_TS[table] ?? []) if (r[c] === undefined) r[c] = now()
    return r
  }
  function conflictKey(table, opts) {
    if (opts?.onConflict) return opts.onConflict.split(',').map((s) => s.trim())
    return UNIQUE[table] ?? null
  }

  const db = {
    calls,
    snapshot() { return { tables: JSON.parse(JSON.stringify(tables)), seq } },
    restore(s) { tables = JSON.parse(JSON.stringify(s.tables)); seq = s.seq },
    rows: (t) => rows(t),
    seed(table, list) { for (const r of list) rows(table).push(withDefaults(table, r)) },
    from(table) {
      const st = { table, method: 'select', filters: [], ors: [], payload: null, opts: null, order: [], limit: null, select: null, head: false, count: null, wantRows: false }
      calls.push(st)
      const match = (r) => st.filters.every(([op, c, v]) => test(r, op, c, v)) && st.ors.every((ps) => ps.some((p) => p(r)))
      const project = (r) => {
        const out = { ...r }
        const emb = /consents\(([^)]*)\)/.exec(st.select ?? '')
        if (emb && table === 'household_members') out.consents = rows('consents').filter((c) => c.member_id === r.id).map((c) => ({ ...c }))
        return out
      }
      function run() {
        if (failOn && failOn(st)) return { data: null, error: { message: `memdb: injected failure on ${table}.${st.method}` } }
        let affected = []
        if (st.method === 'select') {
          affected = rows(table).filter(match)
          for (const [col, asc] of [...st.order].reverse()) affected = [...affected].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]))
          if (st.limit != null) affected = affected.slice(0, st.limit)
          if (st.head) return { data: null, error: null, count: affected.length }
          return { data: affected.map(project), error: null, count: st.count ? affected.length : null }
        }
        if (st.method === 'insert') {
          const list = Array.isArray(st.payload) ? st.payload : [st.payload]
          const key = UNIQUE[table]
          for (const p of list) {
            if (key && rows(table).some((r) => key.every((k) => r[k] === p[k]))) {
              return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${table}` } }
            }
          }
          affected = list.map((p) => withDefaults(table, p))
          rows(table).push(...affected)
        } else if (st.method === 'upsert') {
          const list = Array.isArray(st.payload) ? st.payload : [st.payload]
          const key = conflictKey(table, st.opts)
          for (const p of list) {
            const hit = key ? rows(table).find((r) => key.every((k) => r[k] === p[k])) : null
            if (hit) {
              if (st.opts?.ignoreDuplicates) continue
              Object.assign(hit, p)
              affected.push(hit)
            } else {
              const r = withDefaults(table, p)
              rows(table).push(r)
              affected.push(r)
            }
          }
        } else if (st.method === 'update') {
          affected = rows(table).filter(match)
          for (const r of affected) Object.assign(r, st.payload)
        } else if (st.method === 'delete') {
          affected = rows(table).filter(match)
          tables[table] = rows(table).filter((r) => !affected.includes(r))
        }
        return { data: st.wantRows ? affected.map(project) : null, error: null }
      }
      const chain = {
        select(cols, o) { st.select = cols ?? '*'; if (o?.head) st.head = true; if (o?.count) st.count = o.count; if (st.method !== 'select') st.wantRows = true; return chain },
        insert(p) { st.method = 'insert'; st.payload = p; return chain },
        upsert(p, o) { st.method = 'upsert'; st.payload = p; st.opts = o ?? null; return chain },
        update(p) { st.method = 'update'; st.payload = p; return chain },
        delete() { st.method = 'delete'; return chain },
        eq(c, v) { st.filters.push(['eq', c, v]); return chain },
        neq(c, v) { st.filters.push(['neq', c, v]); return chain },
        in(c, v) { st.filters.push(['in', c, v]); return chain },
        is(c, v) { st.filters.push(['is', c, v]); return chain },
        lt(c, v) { st.filters.push(['lt', c, v]); return chain },
        lte(c, v) { st.filters.push(['lte', c, v]); return chain },
        gt(c, v) { st.filters.push(['gt', c, v]); return chain },
        gte(c, v) { st.filters.push(['gte', c, v]); return chain },
        ilike(c, v) { st.filters.push(['ilike', c, v]); return chain },
        like(c, v) { st.filters.push(['like', c, v]); return chain },
        not(c, op, v) {
          if (op !== 'is') throw new Error('memdb: only not.is is supported')
          st.ors.push([(r) => !test(r, 'is', c, v)])
          return chain
        },
        or(expr) { st.ors.push(parseOr(expr)); return chain },
        order(c, o) { st.order.push([c, o?.ascending !== false]); return chain },
        limit(n) { st.limit = n; return chain },
        range(a, b) { st.limit = b - a + 1; return chain },
        maybeSingle: async () => {
          const r = run()
          if (r.error) return r
          const list = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data]
          if (list.length > 1) return { data: null, error: { message: 'memdb: maybeSingle matched several rows' } }
          return { data: list[0] ?? null, error: null }
        },
        single: async () => {
          const r = run()
          if (r.error) return r
          const list = Array.isArray(r.data) ? r.data : []
          return list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: 'memdb: single matched 0 or several rows' } }
        },
        then(resolve, reject) {
          try { resolve(run()) } catch (e) { reject ? reject(e) : resolve({ data: null, error: { message: String(e) } }) }
        },
      }
      return chain
    },
    rpc: async () => ({ data: null, error: { message: 'memdb: rpc unsupported' } }),
  }
  return db
}
