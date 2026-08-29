// tests/helpers/postgrest-shim.mjs
// TEST HARNESS ONLY — never imported by src/.
//
// A minimal PostgREST-compatible query builder backed by a real local Postgres
// (via psql). It exists so the REAL FSOS code path — processInbound() → tryAutoReply()
// → draftReply() → sendThroughGate() → dispatcher → gate — can be executed against a
// real database with real rows, real constraints, real unique indexes and real triggers,
// instead of being asserted against mocks.
//
// Design rule: FAIL LOUDLY. Any builder method or SQL shape this shim does not
// implement THROWS. It never silently returns an empty result set, because a silent
// empty result would make a test pass for the wrong reason — the exact "false green"
// this harness was written to avoid.
import { execFileSync } from 'node:child_process'

/**
 * A defect in the SHIM ITSELF (unsupported builder shape, unparseable output). It is
 * re-thrown out of the awaited builder so it crashes the test loudly, instead of being
 * shaped into a `{data:null,error}` that the code under test would quietly swallow into
 * an empty result — the false-green this harness exists to prevent.
 */
class HarnessError extends Error {
  constructor(m) { super(`shim: ${m}`); this.name = 'HarnessError' }
}

/** Quote a JS value as a Postgres literal. */
function lit(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v instanceof Date) return `'${v.toISOString()}'`
  if (Array.isArray(v) || typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

function ident(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new HarnessError(`unsafe identifier ${name}`)
  return `"${name}"`
}

/**
 * Explicit FK registry for the ONE supported embed shape (`alias:table!inner(cols)`).
 * Keyed `${baseTable}.${refTable}` → [localCol, foreignCol]. Unknown embeds fail loud —
 * add the pair here (with the real FK) rather than guessing a join.
 */
const EMBED_FKS = {
  'workshop_sessions.workshops': ['workshop_id', 'workshop_id'],
}

/** Split a PostgREST select list on top-level commas (embed parens kept intact). */
function splitTopLevel(s) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

export function makeShim({ host, port, db, user = 'postgres', asRole = null }) {
  const queries = []

  function raw(sql) {
    const args = ['-u', 'postgres', '--', 'psql', '-h', host, '-p', String(port), '-U', user, '-d', db,
      '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql]
    return execFileSync('runuser', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  }

  /**
   * Run a SELECT-shaped statement and return parsed JSON rows. `cte` carries an optional
   * data-modifying WITH clause, which Postgres requires at the TOP level of the statement
   * (it cannot sit inside the json_agg sub-select).
   */
  function rows(sql, cte = '') {
    queries.push(cte + sql)
    const prefix = asRole ? `set local role ${asRole}; ` : ''
    const wrapped = `begin; ${prefix}${cte}select coalesce(jsonb_agg(__t), '[]'::jsonb)::text from (${sql}) __t; commit;`
    const out = raw(wrapped)
    // psql emits BEGIN / COMMIT command tags around the result. jsonb_agg renders on a
    // single line (json_agg does not), so exactly one line is the JSON payload.
    const line = out.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('[')).pop()
    if (line === undefined) throw new HarnessError(`no JSON result for\n${sql}\n→ ${out.slice(0, 800)}`)
    try {
      return JSON.parse(line)
    } catch {
      throw new HarnessError(`could not parse result for\n${sql}\n→ ${out.slice(0, 800)}`)
    }
  }

  function exec(sql) {
    queries.push(sql)
    const prefix = asRole ? `set local role ${asRole}; ` : ''
    raw(`begin; ${prefix}${sql}; commit;`)
    return []
  }

  class Builder {
    constructor(table) {
      this.table = table
      this.op = null
      this.cols = '*'
      this.wants = false // a .select() was chained → RETURNING
      this.filters = []
      this.orders = []
      this._limit = null
      this._range = null
      this.payload = null
      this.conflict = null
      this.mode = null // 'maybeSingle' | 'single' | null
      this.countMode = null // 'exact' when .select(_, {count}) was used
      this.headOnly = false // .select(_, {head:true}) → rows suppressed, count only
    }

    // ── operations ──────────────────────────────────────────────────────────
    select(cols = '*', opts) {
      // PostgREST's count/head form: `.select('id', { count: 'exact', head: true })` returns
      // { data: null, count: N }. The frequency resolver (policy-resolver.ts) is built on it,
      // and its caller fails OPEN on error — so a shim that threw here would silently disable
      // every frequency cap and report "no cap applied" as if it were the product's behavior.
      if (opts && opts.count) {
        if (opts.count !== 'exact') throw new HarnessError(`select({count:'${opts.count}'}) not implemented`)
        this.countMode = opts.count
        this.headOnly = opts.head === true
      }
      this.cols = cols
      if (this.op === null) this.op = 'select'
      else this.wants = true
      return this
    }
    insert(payload) { this.op = 'insert'; this.payload = payload; return this }
    update(payload) { this.op = 'update'; this.payload = payload; return this }
    upsert(payload, opts = {}) {
      this.op = 'upsert'
      this.payload = payload
      this.conflict = opts.onConflict ?? null
      return this
    }
    delete() { this.op = 'delete'; return this }

    // ── filters ─────────────────────────────────────────────────────────────
    eq(c, v) { this.filters.push(`${ident(c)} = ${lit(v)}`); return this }
    neq(c, v) { this.filters.push(`${ident(c)} <> ${lit(v)}`); return this }
    gt(c, v) { this.filters.push(`${ident(c)} > ${lit(v)}`); return this }
    gte(c, v) { this.filters.push(`${ident(c)} >= ${lit(v)}`); return this }
    lt(c, v) { this.filters.push(`${ident(c)} < ${lit(v)}`); return this }
    lte(c, v) { this.filters.push(`${ident(c)} <= ${lit(v)}`); return this }
    is(c, v) { this.filters.push(`${ident(c)} is ${v === null ? 'null' : lit(v)}`); return this }
    ilike(c, pat) { this.filters.push(`${ident(c)}::text ilike ${lit(pat)}`); return this }
    like(c, pat) { this.filters.push(`${ident(c)}::text like ${lit(pat)}`); return this }
    in(c, vals) {
      if (!Array.isArray(vals)) throw new HarnessError('.in() needs an array')
      if (vals.length === 0) { this.filters.push('false'); return this }
      this.filters.push(`${ident(c)} in (${vals.map(lit).join(',')})`)
      return this
    }
    not(c, opName, v) {
      if (opName === 'is') { this.filters.push(`${ident(c)} is not ${v === null ? 'null' : lit(v)}`); return this }
      if (opName === 'eq') { this.filters.push(`${ident(c)} <> ${lit(v)}`); return this }
      if (opName === 'in') {
        // PostgREST list-literal form: .not('status', 'in', '("a","b")') — used by the
        // workshop comms engine. Parse the ("v1","v2") literal; anything else fails loud.
        const m = typeof v === 'string' && v.match(/^\((.*)\)$/)
        if (!m) throw new HarnessError(`.not(_, 'in', ${JSON.stringify(v)}) — expected a ("a","b") list literal`)
        const vals = m[1].length === 0 ? [] : m[1].split(',').map((s) => {
          const t = s.trim()
          const q = t.match(/^"(.*)"$/)
          if (!q) throw new HarnessError(`.not(_, 'in') list item ${t} is not double-quoted`)
          return q[1]
        })
        if (vals.length === 0) return this // not-in-empty-set matches everything
        this.filters.push(`${ident(c)} not in (${vals.map(lit).join(',')})`)
        return this
      }
      throw new HarnessError(`.not(_, '${opName}') not implemented`)
    }
    textSearch(c, q, opts = {}) {
      const fn = opts.type === 'websearch' ? 'websearch_to_tsquery' : 'plainto_tsquery'
      const cfg = opts.config ? `${lit(opts.config)}::regconfig, ` : ''
      this.filters.push(`${ident(c)} @@ ${fn}(${cfg}${lit(q)})`)
      return this
    }
    overlaps(c, vals) { this.filters.push(`${ident(c)} && ${lit(vals)}::text[]`); return this }
    contains(c, vals) { this.filters.push(`${ident(c)} @> ${lit(vals)}::jsonb`); return this }
    or() { throw new HarnessError('.or() not implemented — add it if the path under test needs it') }
    filter() { throw new HarnessError('.filter() not implemented') }
    rpc() { throw new HarnessError('.rpc() not implemented') }

    // ── modifiers ───────────────────────────────────────────────────────────
    order(col, opts = {}) {
      const dir = opts.ascending === false ? 'desc' : 'asc'
      const nulls = opts.nullsFirst === true ? ' nulls first' : ''
      this.orders.push(`${ident(col)} ${dir}${nulls}`)
      return this
    }
    limit(n) { this._limit = n; return this }
    range(from, to) { this._range = [from, to]; return this }
    maybeSingle() { this.mode = 'maybeSingle'; return this }
    single() { this.mode = 'single'; return this }

    // ── SQL construction ────────────────────────────────────────────────────
    get whereSql() { return this.filters.length ? ` where ${this.filters.join(' and ')}` : '' }
    get tailSql() {
      let s = ''
      if (this.orders.length) s += ` order by ${this.orders.join(', ')}`
      if (this._range) s += ` limit ${this._range[1] - this._range[0] + 1} offset ${this._range[0]}`
      else if (this._limit != null) s += ` limit ${this._limit}`
      return s
    }
    /**
     * PostgREST's select list ("id, conversation_id") → SQL. ONE embed shape is supported —
     * `alias:table!inner(cols)` — against an explicit FK registry (EMBED_FKS below); every
     * other embedded/aggregate form fails loud. The embed renders as a nested jsonb object
     * (like PostgREST) and !inner adds an EXISTS so parentless rows are excluded.
     */
    get colSql() {
      const c = String(this.cols).trim()
      if (c === '*' || c === '') return '*'
      if (!/[()]/.test(c)) return c.split(',').map((s) => ident(s.trim())).join(', ')
      const parts = splitTopLevel(c)
      const cols = []
      for (const part of parts) {
        const m = part.match(/^(\w+):(\w+)!inner\(([^)]*)\)$/)
        if (!m) {
          if (/[()]/.test(part)) throw new HarnessError(`embedded/aggregate select not implemented: ${part}`)
          cols.push(ident(part))
          continue
        }
        const [, alias, refTable, refColsRaw] = m
        const fk = EMBED_FKS[`${this.table}.${refTable}`]
        if (!fk) throw new HarnessError(`embed ${this.table} → ${refTable} not in EMBED_FKS registry — add the FK pair`)
        const [localCol, foreignCol] = fk
        const refCols = refColsRaw.split(',').map((s) => ident(s.trim())).join(', ')
        cols.push(
          `(select to_jsonb(__e) from (select ${refCols} from ${ident(refTable)} ` +
            `where ${ident(refTable)}.${ident(foreignCol)} = ${ident(this.table)}.${ident(localCol)} limit 1) __e) as ${ident(alias)}`,
        )
        // !inner semantics: the base row is excluded when the embedded parent is absent.
        this.filters.push(
          `exists (select 1 from ${ident(refTable)} where ${ident(refTable)}.${ident(foreignCol)} = ${ident(this.table)}.${ident(localCol)})`,
        )
      }
      return cols.join(', ')
    }
    rowsPayload() { return Array.isArray(this.payload) ? this.payload : [this.payload] }
    insertSql() {
      const rs = this.rowsPayload()
      const cols = [...new Set(rs.flatMap((r) => Object.keys(r)))]
      const values = rs.map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`).join(', ')
      return `insert into ${ident(this.table)} (${cols.map(ident).join(', ')}) values ${values}`
    }

    // ── execution ───────────────────────────────────────────────────────────
    async run() {
      let data = []
      let count = null
      if (this.op === 'select') {
        if (this.countMode) {
          // The count applies to the FILTERED set, before limit/offset — as PostgREST does.
          const c = rows(`select count(*)::int as n from ${ident(this.table)}${this.whereSql}`)
          count = c[0]?.n ?? 0
          if (this.headOnly) return { data: null, count, error: null }
        }
        data = rows(`select ${this.colSql} from ${ident(this.table)}${this.whereSql}${this.tailSql}`)
      } else if (this.op === 'insert') {
        const sql = this.insertSql()
        if (this.wants) data = rows(`select ${this.colSql} from __r`, `with __r as (${sql} returning *) `)
        else exec(sql)
      } else if (this.op === 'upsert') {
        if (!this.conflict) throw new HarnessError('upsert requires onConflict')
        const target = this.conflict.split(',').map((s) => ident(s.trim())).join(', ')
        const rs = this.rowsPayload()
        const cols = [...new Set(rs.flatMap((r) => Object.keys(r)))]
        const setCols = cols.filter((c) => !this.conflict.split(',').map((s) => s.trim()).includes(c))
        const doUpdate = setCols.length
          ? `do update set ${setCols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`
          : 'do nothing'
        const sql = `${this.insertSql()} on conflict (${target}) ${doUpdate}`
        if (this.wants) data = rows(`select ${this.colSql} from __r`, `with __r as (${sql} returning *) `)
        else exec(sql)
      } else if (this.op === 'update') {
        const set = Object.entries(this.payload).map(([c, v]) => `${ident(c)} = ${lit(v)}`).join(', ')
        const sql = `update ${ident(this.table)} set ${set}${this.whereSql}`
        if (this.wants) data = rows(`select ${this.colSql} from __r`, `with __r as (${sql} returning *) `)
        else exec(sql)
      } else if (this.op === 'delete') {
        const sql = `delete from ${ident(this.table)}${this.whereSql}`
        if (this.wants) data = rows(`select ${this.colSql} from __r`, `with __r as (${sql} returning *) `)
        else exec(sql)
      } else {
        throw new HarnessError(`no operation set for ${this.table}`)
      }

      if (this.mode === 'maybeSingle') return { data: data[0] ?? null, count, error: null }
      if (this.mode === 'single') {
        if (data.length !== 1) return { data: null, count, error: { message: 'expected exactly one row' } }
        return { data: data[0], count, error: null }
      }
      return { data, count, error: null }
    }

    then(resolve, reject) {
      return this.run().then(resolve, (err) => {
        // A shim defect must NEVER be disguised as a database error — the code under test
        // would swallow it into an empty result and the assertion would pass for the wrong
        // reason. Crash instead.
        if (err instanceof HarnessError) return reject(err)
        // A genuine Postgres error is surfaced the way supabase-js does ({data:null,error})
        // so the code under test takes its real error branch.
        try { return resolve({ data: null, error: { message: err.message } }) } catch (e) { return reject(e) }
      })
    }
  }

  /**
   * supabase-js `.rpc(fn, params)` → calls a SQL function with NAMED args and returns its
   * result as { data, error } (data = the function's return value). Scalars are serialized via
   * lit(); an array arg is emitted as a Postgres ARRAY[...] cast (uuid[] when every element is a
   * uuid, else text[]) — the jsonb serialization lit() uses for objects is wrong for a uuid[]
   * function parameter. Used by the comms suppression path (comm_suppression_apply) in the e2e.
   */
  function rpc(fn, params = {}) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fn)) throw new HarnessError(`unsafe rpc function ${fn}`)
    const args = Object.entries(params).map(([k, v]) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) throw new HarnessError(`unsafe rpc arg ${k}`)
      let sqlVal
      if (Array.isArray(v)) {
        if (v.length === 0) sqlVal = "'{}'::text[]"
        else {
          const uuidish = v.every((x) => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))
          sqlVal = `array[${v.map(lit).join(',')}]::${uuidish ? 'uuid[]' : 'text[]'}`
        }
      } else {
        sqlVal = lit(v)
      }
      return `${k} := ${sqlVal}`
    })
    return new Promise((resolve, reject) => {
      try {
        // The function may be SECURITY DEFINER and data-modifying; rows() runs it inside a
        // begin/commit and json_agg's its single-row result → [{ r: <jsonb> }].
        const out = rows(`select ${fn}(${args.join(', ')}) as r`)
        resolve({ data: out.length ? out[0].r : null, error: null })
      } catch (err) {
        // A shim defect must crash (never be disguised as a DB error the code swallows);
        // a genuine Postgres error is surfaced the supabase-js way ({ data:null, error }).
        if (err instanceof HarnessError) return reject(err)
        resolve({ data: null, error: { message: err.message } })
      }
    })
  }

  return {
    from: (table) => new Builder(table),
    rpc,
    /** Escape hatch for assertions — raw SQL straight to the database. */
    sql: (s) => rows(s),
    exec: (s) => exec(s),
    queries,
  }
}
