# District 41 Master Reconciliation — Phase 1 & 2 Report

**Source:** `District 41 MASTER - Consolidated Operating File.xlsx` (as of 2026-08-06)
**Target:** `supabase-FSOS` (`ynxaqeejjmeilpwmuuie`)
**Run date:** 2026-08-07 · **Phases:** 1 (stage) + 2 (match & classify)
**Status:** ⛔ **STOPPED at the Phase 3 approval gate. No live table was written.**

Prerequisite: `D41-master-reconciliation-phase0.md`. Its §7.1 correction
(`'No agent on record'`) and §2 baseline corrections are applied throughout.

---

## 1. What was and was not done

| | |
|---|---|
| ✅ Phase 1 — staging built, **row counts reconcile exactly** | 12,551 / 12,551 |
| ✅ Phase 2 — decisions assigned for all key-based ranks | §3 |
| ✅ Fill-gain projection per field | §5 |
| ✅ `MATCH_AMBIGUOUS` enumerated | §4 |
| ✅ 25 before/after samples | §7 (renderer; PII kept out of the repo) |
| 🟡 Cross-grain ranks 3–5 — **sampled estimate, not exact** | §3.3 |
| ⛔ Phase 3 approval | not requested |
| ⛔ Phase 4 apply / Phase 5 verify | not started |

**Nothing was written to any live table.** `consents` is unchanged at 19,322,
`contacts.dob` still 0 populated, `dnc_entries` still 0.

### 1.1 Disclosed deviation — staging is local, not `stg_` tables

§4 asks for `stg_d41_*` tables in the database. This environment has no database
connection able to carry a 12,551-row load (Phase 0 §8), so staging was written as
newline-delimited JSON instead, in the exact record shape those tables need:

```
stg_d41_inforce.ndjson     7,246 rows    5.1 MB
stg_d41_conversion.ndjson  1,860 rows    1.8 MB
stg_d41_crosssell.ndjson   2,000 rows    1.3 MB
stg_d41_winback.ndjson     1,445 rows    0.8 MB
```

Every source column is retained verbatim under `src`; normalization lives in separate
`derived` fields; each record carries a `row_hash` (SHA-256) and its natural key. **The
staging files contain client PII and are not committed** — they live in the operator's
scratch directory only. When a connection exists these records load into `stg_` tables
unchanged; **Phase 4 cannot proceed until they do**, because `import_records` must
reference real staged rows.

---

## 2. Phase 1 — staging reconciles to the master exactly

| Tab | Master data rows | Staged | Match |
|---|---|---|---|
| In-Force Book | 7,246 | 7,246 | ✅ |
| Conversion Opportunities | 1,860 | 1,860 | ✅ |
| Cross-Sell Opportunities | 2,000 | 2,000 | ✅ |
| Win-Back Opportunities | 1,445 | 1,445 | ✅ |
| **Total** | **12,551** | **12,551** | ✅ |

This satisfies the §8 done-criterion "row counts reconcile to the master exactly
(7,246 / 1,860 / 2,000 / 1,445)".

---

## 3. Phase 2 — decisions

### 3.1 Contact-grain decisions

| Decision | Cross-sell | Win-back | In-force + conversion owners |
|---|---|---|---|
| `MATCH_EXACT` (natural key / policy number) | 0 | **1,344** | **~7,509–7,533** |
| `INSERT_NEW` | **~1,699** | **~73** | **~16–40** |
| `MATCH_AMBIGUOUS` | **18** (8 groups) | **40** | **62** |
| `EXCLUDE` | **6** | **2** | 0 |
| `MATCH_PROBABLE` (cross-grain, ranks 3–5) | ~70–90 *(est.)* | n/a | n/a |
| Staged records after collapse | 1,787 | 1,417 | 7,549 |

`MATCH_EXACT` for cross-sell is **0 by construction** — `crosssell_key` is null on
every live row, exactly as the brief's finding (a) states.

### 3.2 Policy-grain decisions

| Decision | Count |
|---|---|
| `MATCH_EXACT` on `policy_number` + `source_system='fnwl'` | **9,088** |
| `INSERT_NEW` | **4** (conversion-only rows) |
| `MATCH_AMBIGUOUS` | 0 |

Policies fan out from contacts and never merge — the unique index on
`policy_number where source_system='fnwl'` is a total conflict target here.

### 3.3 ⚠️ Ranks 3–5 are estimated, not exact — and why

Ranks 3–5 (email+surname, phone+surname, name+ZIP+address) need a row-by-row join
between 1,787 staged cross-sell records and 9,785 live contacts. That join cannot run
locally without extracting the live contact index, and cannot run server-side without
first loading staging into the database — the §1.1 blocker.

What is reported instead is a **400-key random-sample estimate** measured against live
contacts: **3.5% email hit rate, 2.3% phone hit rate**, extrapolating to roughly
**70–90 cross-sell households that already exist as contacts** (<5%).

That figure is an **upper bound on auto-linkable matches** — §5.1 ranks 3–4 additionally
require a surname match, which the sample did not test. **Do not approve cross-grain
auto-linking on this number.** It is sized to inform the insert projection, not to
authorize merges. The exact set comes from the staging join.

### 3.4 Revised write projection

| | Phase 0 estimate | Phase 2 |
|---|---|---|
| Cross-sell inserts | ~1,707 | **~1,699** |
| Win-back inserts | 75 | **~73** |
| Owner inserts | ~16–40 | ~16–40 |
| **Total contact inserts** | ~1,825 | **≈1,790–1,812** |
| Policy inserts | 4 | **4** |

Both circuit breakers hold comfortably: **≈1,800 inserts against a 2,500 limit**, and
inserts are not modifications so the 20%-of-live-rows rule (1,957) is not approached.
The brief's own ~2,578 estimate would have tripped the 2,500 breaker; the measured
figure does not. **Recommend leaving both breakers exactly as specified.**

---

## 4. `MATCH_AMBIGUOUS` — enumerated, none auto-applied

All 120 are held for row-level approval per §3 of the brief. Identified by hash and row
position rather than name, so this document carries no PII.

### 4.1 Cross-sell: 8 collapse groups spanning 2+ distinct streets (18 rows)

Same normalized name **and** same ZIP5, but a **different street address**. Under
`crosssell_key` these collide into one contact. They may be two genuinely different
households. Of 179 collapse groups, 171 agree on street (safe); these 8 do not.

### 4.2 Win-back: 40 records with no ZIP

`winback_key` degrades to `name|` with an empty ZIP segment, which is collision-prone by
construction. Recommend review rather than auto-insert. No win-back collapse group spans
multiple values, so these are the only win-back ambiguities.

### 4.3 Owner keys: 62 empty-ZIP collisions between in-force and conversion

The conversion export carries no ZIP, so `conversionOwnerKey()` produces `name|`. **449**
in-force owner keys also end in `|`, and **62** collide with a conversion owner key. The
same human keys two different ways depending on which export reached them first —
documented at `src/lib/import/conversionList.ts:247-253`. Policies cannot duplicate;
**contacts can**. Hold all 62.

---

## 5. Fill-gain projection — the largest finding in this reconciliation

Measured against live null-counts per cohort, paired with master availability.

### 5.1 🔴 The win-back cohort is almost entirely missing contact points

1,344 live contacts carry a `winback_key`. Their current state versus what the master
supplies for the 1,417 staged win-back records:

| Field | Live NULL | Master supplies | Max fill |
|---|---|---|---|
| `email` | **1,316 of 1,344 (98%)** | 863 | **~835** |
| `phone` | **1,276 of 1,344 (95%)** | 1,046 | **~1,020** |
| `zip` | 38 | 1,377 | ~38 |
| `state` | 64 | — | ~64 |
| `address` / `city` | 1,038 | **0 — column absent** | **0** |
| `lines_of_business` | 0 empty | 1,417 | union only |

**The win-back list was loaded without its contact points.** Only 28 of 1,344 have an
email in FSOS while the master carries one for 61% of them. This is the single largest
data-quality gain available here — roughly **835 emails and 1,020 phones**, all
fill-into-null, no overwrite.

Note the **Win-Back tab has no street or city column** (its address data is `Mailing
State` + `Zip Code` only). Those 1,038 null addresses **cannot** be filled from this
source. Any plan claiming otherwise is wrong about the schema.

### 5.2 Owner cohort (in-force + conversion)

7,231 live `owner:`-prefixed contacts:

| Field | Live NULL | Master supplies (owner grain) | Max fill |
|---|---|---|---|
| `email` | 5,806 | 1,409 | ≤1,409 |
| `phone` | 4,667 | 2,718 | ≤2,718 |
| `address` | 2,138 | in-force tab carries owner address | ≤2,138 |
| `zip` | 2,137 | — | ≤2,137 |
| `state` | 449 | — | ≤449 |
| `first_name` / `last_name` / `household_id` | 0 | — | **0 — nothing to fill** |

### 5.3 Cross-sell — all new rows, nothing to fill

1,787 staged records, all inserts: email 1,579 · phone 1,593 · street 1,786 ·
zip5 1,786 · `Active LOB` 1,787 · DNC-flagged 1.

### 5.4 `CONFLICT` is bounded and small

A `CONFLICT` is only possible where the live value is **non-null and differs**. Live
non-null counts cap it:

| Cohort | Max email conflicts | Max phone conflicts |
|---|---|---|
| Win-back (1,344) | **≤28** | **≤68** |
| Owners (7,231) | ≤1,425 | ≤2,564 |

The win-back ceiling of ≤96 total is negligible. The owner ceilings are upper bounds
before value comparison — the true count needs the staging join, and every non-applied
value goes to `import_records.rejected_values` (§4) so nothing is lost either way.

---

## 6. Rules applied in staging and classification

| Rule | Applied |
|---|---|
| §3 strip trailing `" Household"` before keying | ✅ both household-grain tabs |
| §3 set `custom.name_grain='household'` | ✅ staged on cross-sell + win-back |
| §5.2 de-duplicate **within** staging before live match | ✅ 207 + 26 rows collapsed, logged |
| §5.2 record what was collapsed | ✅ `collapsed_from` row hashes retained |
| §5.4 exclude 6 non-D41 cross-sell codes | ✅ staged then marked `EXCLUDE` |
| §5.4 `'No agent on record'` → leave `aor_code` null | ✅ 527 policies, corrected string |
| §5.3 use `Writing Producer Code (full)` (07/26 form) | ✅ present on 1,857 of 1,860 |
| §2.4 never write `dob` | ✅ never emitted; shape recorded as evidence |
| §5.3 `custom` merge not replace | ✅ jsonb merge — `custom` is `'{}'`, never NULL |
| §5.3 `tags` union + run tag | ✅ `d41-master-2026-08-06` |
| §5.3 `lines_of_business` union, inactive tagged distinctly | ✅ win-back `Inactive Agency LOB` kept separate |
| §6 no consent rows | ✅ none created, proposed, or modified |
| §6 no `is_security` | ✅ not set |
| §6 PII redaction | ✅ no names/addresses/phones/emails in any committed file |

The master's birth field shape is confirmed as `####-##-## ##:##:##` on all 1,857
populated rows — a **full datetime with a placeholder year**, not a month/day value.

---

## 7. Before/after samples (§2)

The brief asks for 25 proposed changes rendered before/after. Those lines are client PII,
so they are **not** committed. Render them locally:

```bash
export D41_MASTER_XLSX="/path/to/District 41 MASTER - Consolidated Operating File.xlsx"
python3 scripts/d41-recon/stage_and_classify.py --out /secure/scratch/d41 --samples 25
```

Verified: 25 samples emit, all `INSERT_NEW`, and **every `before` value is null** — which
is the expected shape, since no cross-sell household exists in FSOS today. Each `after`
carries name, email, phone, street, city, state, zip, `lines_of_business` from
`Active LOB`, the `d41-master-2026-08-06` tag, and a `custom` object with
`name_grain='household'`, `source_extract`, `source_asof`, `agency_normalized`,
`aor_code_full`.

---

## 8. Compliance position (§6) — unchanged and reinforced

- **No consent record was created, modified, or extended.** `consents` remains at 19,322.
- The measured picture strengthens the brief's §6 argument: **~95% of the 1,787
  cross-sell households do not exist in FSOS in any form.** They are strangers to the
  system, not existing life clients. The 19,322 retroactive bulk grants — disclosure text
  *"Prior express consent asserted by the licensed FSA (retroactive bulk grant)"*, none
  captured from a client — cannot reach them on any reading. **Loading them as contacts
  is a data operation; contacting them is a separate decision for the licensed FSA** under
  §12, TCPA prior-express-consent, and A2P/CTIA rules.
- One cross-sell record carries a **DNC/revoked flag**. It is staged and preserved, but
  this task writes nothing to `dnc_entries` (§2.2). Flag it to the operator: the flag
  exists in the source and should be honoured when consent is eventually decided.
- **Securities firewall:** `is_security` not set. No write to `opra_*`, `fna_*`, `nigo_*`,
  `rightbridge_reports`.
- **Not verified:** conversion eligibility, deadlines, and policy status are reproduced as
  supplied and remain unconfirmed downstream (ADR-020).

---

## 9. Decisions required before Phase 4

Carried from Phase 0 §11, plus new items:

1. **Accept the Phase 0 baseline corrections** (`winback_key` 1,344; `custom` is `'{}'`;
   `'No agent on record'`).
2. **Approve the 120 `MATCH_AMBIGUOUS` rows individually** — 8 cross-sell multi-street
   groups (§4.1), 40 no-ZIP win-back (§4.2), 62 owner-key collisions (§4.3). §3 requires
   row-level, not blanket, approval.
3. **Confirm breakers stay at 2,500 / 20%** — measured projection ≈1,800 (§3.4).
4. **Rule on the 2 `'Not mapped'` win-back rows** — currently `EXCLUDE`.
5. **Unblock the database path** (Phase 0 §8). Until staging lands in `stg_` tables,
   Phase 4 cannot populate `import_records`, and ranks 3–5 stay estimated.
6. **Note the win-back address gap** — 1,038 null addresses are *not* fillable from this
   source (§5.1). If they matter, they need a different extract.

Phase 3 approval has **not** been requested and Phase 4 has **not** begun.
