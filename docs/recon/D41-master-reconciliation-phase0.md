# District 41 Master Reconciliation — Phase 0 Preflight Report

**Source:** `District 41 MASTER - Consolidated Operating File.xlsx` (as of 2026-08-06)
**Target:** `supabase-FSOS` (`ynxaqeejjmeilpwmuuie`)
**Run date:** 2026-08-07 · **Phase:** 0 (preflight) — **read-only, nothing written**
**Status:** ⛔ **Stopped at the Phase 3 approval gate, plus two §9 stop conditions hit.**

---

## 0. Bottom line

Phase 0 is complete. Nothing was written to any table — live, staging, or otherwise.

Three things need an operator decision before Phase 1 can start:

1. **The brief's §1 baseline is wrong in two places**, and one of them (§5.4's
   `'No agent of record'`) is a string that matches **zero** rows in the master. Coding
   the filter from the brief verbatim would assign an agent of record to **527 policies
   that have none**.
2. **The expected write volume is ~30% smaller than the brief projects** — about
   **1,825 inserts, not 2,578**. The 2,500 circuit breaker does *not* need raising.
   The brief's "171 short / 407 short" figures compare a contact count to a policy
   count, which is the §3 grain trap.
3. **This environment has no direct database connection** — only the Supabase MCP
   `execute_sql` tool. Bulk-loading 12,551 staging rows through it is not practical.
   Phase 1 needs a connection string or a service key.

The good news: **every natural-key format was found in code**, including
`crosssell_key`, which the brief expected might not exist. No key format was guessed.

---

## 1. Key derivation — located in code, not inferred (§0.1)

All formats below are read from the live repository. `crosssell_key` **does** have a
producer, so the brief's "stop and ask" condition does not apply.

| Key | Producer | Formula |
|---|---|---|
| `households.book_owner_key` | `src/lib/import/inforceBook.ts:99` `ownerKey()` | `lower(trim(collapse_ws(name)))` + `\|` + zip5 |
| `contacts.book_key` (in-force owner) | `src/app/api/app/book/import/route.ts:149` | `'owner:'` + `ownerKey(name, zip)` |
| `contacts.book_key` (joint / serving agent) | `src/app/api/app/book/import/route.ts:76` | `'joint:'` / `'agent:'` + same |
| `contacts.book_key` (conversion owner) | `src/lib/import/conversionList.ts:284` `conversionOwnerKey()`, used at `.../conversions/import/route.ts:228` | `'owner:'` + `ownerKey(name, '')` → **trailing `\|`, empty ZIP** |
| `contacts.crosssell_key` | `src/lib/import/crossSellList.ts:244` | `nameKey(name)` + `\|` + zip5 |
| `contacts.winback_key` | `src/lib/import/winBackList.ts:267` | `nameKey(name)` + `\|` + zip5 |

with

- `nameKey(s)` = `s.toLowerCase().replace(/[^a-z]/g, '')` — **strips spaces and digits**
  (`crossSellList.ts:167`, `winBackList.ts:88`)
- `normZip(s)` = first 5-digit run (`crossSellList.ts:145`)
- household-grain names have `/\s+Household\s*$/i` stripped **before** keying
  (`crossSellList.ts:203`, `winBackList.ts:227`)

### 1.1 The two key families are normalized differently — this is load-bearing

`book_key` **keeps spaces** (`owner:rachel hope ponce|78413`); `crosssell_key` and
`winback_key` **strip them** (`adolfoaleman|78414`). That is not drift to be tidied up —
it is the as-built contract behind three live unique indexes. Any Phase 1 code must use
the repo functions verbatim. Re-deriving them by hand is the failure mode this brief
exists to prevent.

**Recommendation (`CLAUDE.md` §6):** the Phase 1 loader should import the existing
parsers and `resolveContact()` / `mergeFields()` from `src/lib/import/` rather than
re-implement them. `scripts/d41-recon/parse_master.py` is a faithful port used to
*verify* Phase 0 read-only; it must not become a second production implementation.

---

## 2. Live counts — verified, with two corrections to the brief (§0.2)

| Dimension | Brief §1 | Measured 2026-08-07 | Verdict |
|---|---|---|---|
| `contacts` total / live | 9,801 / 9,785 | 9,801 / 9,785 | ✅ |
| `book_key` populated | 7,731 | 7,731 | ✅ |
| `crosssell_key` populated | 0 | 0 | ✅ |
| **`winback_key` populated** | **1,038** | **1,344** | ⚠️ **corrected** |
| no natural key | 1,032 | 1,032 | ✅ |
| `dob` populated | 0 | 0 | ✅ |
| **`custom` populated** | **0** | **9,801 (all `'{}'`)** | ⚠️ **clarified** |
| `household_id` populated | 9,731 | 9,731 | ✅ |
| `household_policies` | 9,088 | 9,088 | ✅ |
| `consents` | 19,322 | 19,322 | ✅ |
| `dnc_entries` | 0 | 0 | ✅ |

### 2.1 `winback_key` is 1,344, not 1,038 — and the extra 306 are a *good* sign

1,038 rows carry `source='winback_life'`. A further **306 rows carry a `winback_key`
while keeping `source='fnwl_book'`** — the win-back importer matched existing book
contacts and stamped the key on them instead of inserting duplicate people. That is
precisely the cross-grain linking §5.2 asks for, already working in production.

The brief's §1 counted only `source='winback_life'`, so it under-reports the win-back
load by 306 and over-states the remaining gap.

### 2.2 `custom` is `'{}'`, not `NULL` — this changes the merge predicate

All 9,801 rows have a non-null, empty `custom`. The brief's "0" meant "0 with content",
which is true. But it means a fill-nulls-only guard written as `custom is null` will
**never fire**. §5.3's "merge, never replace" must be implemented as a jsonb merge
(`custom || excluded.custom`, or key-wise `jsonb_set`), which is what the brief intends.

### 2.3 No concurrent writer — the §9 "counts have drifted" trigger does not apply

`max(created_at)` = **2026-08-04**, `max(updated_at)` = **2026-08-05**. Both predate the
brief's 2026-08-06 authoring date. Nobody has written since. The two deltas above are
measurement differences in the brief, not drift, so I continued rather than halting —
but they are corrections the operator should accept explicitly before Phase 1.

---

## 3. In-force policy overlap — fully explained (§0.3)

The brief asks for this before any policy write is proposed.

```
  7,246   In-Force Book tab      (distinct policy numbers)
+ 1,860   Conversion tab         (distinct policy numbers)
=  9,106
-    14   appear on BOTH tabs    ← the overlap
=  9,092  distinct policies in the master
-  9,088  loaded in household_policies
=      4  absent
```

Verified by set checksum, then bisected by policy-number prefix without moving policy
numbers into the report. The DB set is a **strict subset** of the master union, and all
**4 missing policies are conversion-tab-only rows** (prefix buckets `219`, `271`, `308`,
`906`, one each).

**Conclusion: the In-Force Book tab is fully loaded. Policy-side work is 4 inserts, not
1,842.** The apparent 9,088-vs-9,106 discrepancy was the 14-policy overlap plus these 4.

---

## 4. Grain analysis — the brief's finding (b) needs restating (§3)

The brief reports conversion "171 short" and win-back "407 short". Both compare a
**contact** count to a **row/policy** count. Corrected:

| | Master rows | Master **distinct contacts** | In DB | Actually short |
|---|---|---|---|---|
| In-Force (policy grain) | 7,246 | 5,845 owners | — | — |
| Conversion (policy grain) | 1,860 | 1,766 owners | — | — |
| **In-force + conversion owners combined** | 9,106 | **7,549** | **7,534** | **≈16–40** |
| Cross-sell (household grain) | 2,000 | 1,787 in scope | 0 | 1,787 |
| Win-back (household grain) | 1,445 | 1,419 | 1,344 | **75** |

Owner and win-back gaps were measured by hash-bucket comparison (count + checksum per
bucket) so no names or keys left the database. For win-back, `Σ|bucket delta|` equals
the net delta exactly (75), which is consistent with the DB set being a strict subset —
i.e. **1,344 exact key matches, 75 inserts**. The owner-key comparison bounds the
difference at **≥16 master-only and ≥1 DB-only**; the exact figure needs the staging load.

### 4.1 A key-format asymmetry that will look like duplicates

Conversion owner keys always end in `|` (no ZIP in that export). **449** in-force owner
keys also end in `|`, and **62** of those collide with a conversion owner key. The code
comment at `conversionList.ts:247-253` already documents this: the same human can key
two ways depending on which export reached them first. Policies never duplicate (unique
on `policy_number`), but **contacts can**. These 62 belong in `MATCH_AMBIGUOUS` for
row-level review, not auto-merge.

---

## 5. Staging-internal duplicates (§5.2) — de-duplicate *before* matching live

### Cross-sell
- 2,000 rows → **6 excluded** as non-District-41 (exactly the six codes in §5.4:
  `253013`, `3552AC`, `366035`, `419931`, `FWS1272`, `FWS1273`; each row carries the
  code in both the AOR and principal column). The tab's own `In District 41?` column
  independently flags the same 6.
- 1,994 in scope → **1,787 distinct `crosssell_key`**, so **207 rows collapse** across
  179 keys.
  - **197 of the 207 share an identical street** → almost certainly the same household.
  - **10 collapse across *different* streets** → same name + same ZIP, different address.
    These must **not** be silently merged; they are `MATCH_AMBIGUOUS`.
- 1 row has no ZIP → key degrades to `name|`.
- The tab's own `Duplicate Account Name?` flags 442 rows — that is name-only, so it is
  a much looser signal than the 179 name+ZIP key collisions. Do not use it as the
  dedupe key.

### Win-back
- 1,445 rows → **1,419 distinct `winback_key`**; **26 rows collapse** across 25 keys.
- **40 rows have no ZIP** → key degrades to `name|`, which is collision-prone by
  construction. Recommend routing all 40 to review rather than auto-inserting.
- 0 rows carry an excluded code, but **2 rows are `In District 41? = 'Not mapped'`** —
  not covered by the brief. Recommend `EXCLUDE` pending an operator call.

---

## 6. Revised write projection — the circuit breaker does **not** need raising

| Bucket | Brief estimate | Measured projection |
|---|---|---|
| Cross-sell contacts | ~2,000 | **~1,707** (1,787 distinct − ~80 that match a live contact) |
| Win-back contacts | ~407 | **75** |
| Conversion / in-force owner contacts | ~171 | **~16–40** |
| **Total contact inserts** | **~2,578** | **≈1,800–1,825** |
| Policy inserts | (unstated) | **4** |

The brief's estimate exceeded its own 2,500 breaker and anticipated needing to tune it.
**It does not** — the measured projection sits comfortably under both the 2,500 insert
limit and the 20%-of-live-rows limit (1,957 rows). I recommend **leaving both breakers
exactly as specified**. If a Phase 2 run projects materially more than ~1,900 inserts,
that is evidence of a key-derivation bug and should abort rather than be waved through.

### 6.1 Cross-sell / live-contact overlap is low — measured, not assumed

A 400-key random sample of in-scope cross-sell contact points against live contacts:

| Signal | Sample hits | Rate | Extrapolated |
|---|---|---|---|
| Email exact | 14 / 400 | 3.5% | ~55 of 1,584 |
| Phone exact | 9 / 400 | 2.3% | ~36 of 1,595 |

Union is roughly **70–90 cross-sell households that already exist as contacts** — under
5%. This is an upper bound on auto-linkable matches: §5.1 ranks 3–4 additionally require
a last-name match, which this sample did not test.

**This is a sampled estimate, not an exact count.** The exact figure comes from the
Phase 2 staging join. It is reported here because it bears directly on §6 below.

---

## 7. Findings the operator must act on

### 7.1 🔴 `'No agent of record'` matches zero rows — the real string is `'No agent on record'`

The brief's §5.4 exclusion says `Agency Mapping Basis = 'No agent of record'` (527
policies). The master's actual value is **`'No agent on record'`** — *on*, not *of*.

The count is right: **527 policies**. But a filter coded from the brief verbatim matches
**0 rows**, and those 527 policies would silently pick up an `aor_code` the master does
not support — exactly the §2.5 prohibition ("absence in the extract is not evidence of
absence in reality").

Full `Agency Mapping Basis` distribution:

| Value | Rows |
|---|---|
| `Agency code map` | 6,158 |
| `No agent on record` | **527** |
| `Producer name map` | 217 |
| `In-force producer name only` | 203 |
| `2026 Directory (no opportunity records)` | 141 |

### 7.2 🔴 The DOB trap is worse than the brief describes

`Insured Birth (Mo/Day — NO YEAR)` is populated on **1,857** conversion rows (the brief
says 1,855). Every populated cell has the shape `####-##-## #` — a **full datetime with a
placeholder year**, not a month/day string. Writing it to `contacts.dob` would produce
1,857 confidently-wrong dates of birth carrying a fabricated year.

§2.4 already forbids this. Confirmed and reinforced: **never write `dob`.** If birth
month/day has operational value, `custom->>'birth_month_day'` as `MM-DD` only.

### 7.3 🟡 Conversion `Record Status` — only 3 dropped rows

| Value | Rows |
|---|---|
| `Present in both extracts` | 1,854 |
| `Dropped from 08/06 extract (conversion window closed)` | **3** |
| `New in 08/06 extract` | 3 |

The §5.4 "dropped" rule affects 3 rows, not a large set. **1,857 rows carry
`Writing Producer Code (full)`**; the 3 that do not are the dropped ones — so §5.3's
"use the 07/26 full form" is satisfiable for every row that may create anything.

### 7.4 🟡 `conv_stage` has RLS disabled — reported, not touched (§7)

Confirmed: `public.conv_stage`, `relrowsecurity = false`, **0 policies**. Anyone with
the anon key can read or write every row. Not fixed, per instruction.

Related, and worth an explicit note: **`consents` has RLS *enabled* with 0 policies.**
That is deny-all for anon/authenticated and safe — but it means the table is reachable
only by `service_role`, so any future consent UI will need a policy written deliberately.

---

## 8. ⛔ Blocker: no database connection for Phase 1

There is no `DATABASE_URL`, no service key, and no `.env.local` in this environment. The
only database path is the Supabase MCP `execute_sql` tool, which takes SQL inline.

Phase 1 requires staging **12,551 rows × up to 29 source columns each, verbatim**
(§4). Pushing that through inline SQL is neither practical nor reviewable, and Phase 4's
500-row batched transactions have the same problem.

**Phase 0 was completed without it** by computing keys locally and comparing against the
database using hash-bucket checksums — which also kept every name, address, phone and
email out of this report (§6 PII).

**To proceed, one of:**
- a pooler connection string / service key so a script under `scripts/` can run the load; or
- authorization to drive the existing importer routes (`/api/app/{book,conversions,crosssell,winback}/import`),
  which is the §6-preferred path since it reuses the real key functions; or
- explicit acceptance of a slow chunked MCP load for staging only.

---

## 9. What is NOT done, and why

| Definition-of-done item | Status |
|---|---|
| Phase 0 preflight; keys located in code | ✅ Complete |
| Live counts verified | ✅ Complete (2 corrections above) |
| In-force overlap explained | ✅ Complete |
| Unique indexes confirmed | ✅ All 4 present |
| Staging tables loaded | ⛔ Blocked — §8 |
| Phase 2 decision report | 🟡 Projected, not exact — needs staging |
| Operator approval | ⛔ Not requested yet |
| Apply / idempotency / rollback | ⛔ Not started (correctly — gated) |
| `conv_stage` RLS reported | ✅ §7.4 |

**Nothing was written.** No live table, no staging table, no schema change, no consent
row, no `service_role` mutation. `consents` remains at 19,322, `contacts.dob` at 0
populated, `dnc_entries` at 0.

---

## 10. Compliance notes carried forward (§6)

- **Consent: unchanged and untouched.** This reconciliation creates no consent basis. The
  measured overlap in §6.1 sharpens the point: **95%+ of the 1,787 cross-sell households
  do not exist in FSOS at all** and have no prior relationship. The 19,322 retroactive
  bulk grants — disclosure text *"Prior express consent asserted by the licensed FSA
  (retroactive bulk grant)"*, none captured from a client — cannot extend to them on any
  reading. Loading them as contacts is a data operation; contacting them is a separate
  decision for the licensed FSA under §12 and TCPA.
- **Securities firewall:** `is_security` not set, not proposed. No write to `opra_*`,
  `fna_*`, `nigo_*`, `rightbridge_reports`.
- **Not verified:** conversion eligibility, deadlines, and policy status are reproduced
  as supplied. Loading them does not verify them; anything client-facing must treat them
  as unconfirmed (`CLAUDE.md` §4.3, ADR-020).
- **PII:** this report contains no names, addresses, phones or emails. Cross-database
  comparison used 48-bit hashes; the workbook was never copied into the repo.

---

## 11. Decisions requested

1. **Accept the two §1 corrections** (`winback_key` 1,344; `custom` is `'{}'` not null).
2. **Confirm `'No agent on record'`** as the §5.4 exclusion string (527 policies).
3. **Confirm the breakers stay at 2,500 / 20%** — no raise needed (§6).
4. **Rule on the 10 different-street cross-sell collisions** and the **62 empty-ZIP
   owner-key collisions** — recommend `MATCH_AMBIGUOUS`, row-level review.
5. **Rule on 40 no-ZIP win-back rows** and **2 `'Not mapped'`** rows — recommend review /
   exclude.
6. **Unblock Phase 1** by choosing an option in §8.

Phases 1–5 remain unstarted pending 1–6.
