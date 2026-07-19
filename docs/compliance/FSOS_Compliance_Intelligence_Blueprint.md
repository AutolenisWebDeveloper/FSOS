# FSOS Compliance Intelligence System — Master Build Blueprint

A single intelligent system that assists with RightBridge, paperwork, case notes, documentation
review, and NIGO resolution — grounded in a knowledge library you own and continuously grow.

This document is the build specification. It maps every requirement you listed to a concrete
component, defines the data model, the processing pipeline, the guardrails, and the build order.

---

## 1. What the system is (one sentence)

A retrieval-augmented compliance engine that stores your governing documents and case history,
understands each NIGO against the *actual* rules, tells you which authority each issue maps to,
distinguishes real requirements from house preferences, and helps you correct paperwork, strengthen
notes, and draft a professional, cited response — never inventing a rule or a citation.

---

## 2. The Knowledge Library (the foundation everything reads from)

Everything the system "knows" lives here. You upload; the system ingests, chunks, embeds, and indexes.
Every answer it ever gives is grounded in and cited to these documents.

### 2.1 Source categories (with an authority hierarchy — this is critical)

The system must **distinguish among source types**, because that distinction is your core leverage.
Each stored document is tagged with its `authority_type`, which sets how binding it is:

| authority_type | Binding force | Examples | Can a NIGO be based on this? |
|---|---|---|---|
| `FINRA_RULE` | Law (regulatory) | Rule 2330, Reg BI, 2111, 2010, 4511, 3110, breakpoint guidance | Yes — highest authority |
| `SEC_RULE` | Law (regulatory) | 17 CFR 240.15l-1 (Reg BI), 17a-3/17a-4 | Yes |
| `STATE_REQUIREMENT` | Law (state) | TX 28 TAC replacement provisions, NAIC #275/#613 as adopted | Yes |
| `CARRIER_REQUIREMENT` | Contractual | Pacific Life / Athene / MassMutual submission & form rules | Yes — but carrier-specific, not FINRA |
| `FORM_INSTRUCTION` | Procedural | Form 311883 instructions, RightBridge field rules | Yes |
| `FFS_PROCEDURE` | Firm policy | FFS compliance manual, WSPs, 326349 disclosure | Yes — but it's FIRM policy, not FINRA |
| `SUITABILITY_STANDARD` | Derived | The objective-standard checklist (Reg BI care obligation elements) | Yes |
| `INTERNAL_PREFERENCE` | Reviewer opinion | "Not good enough," undocumented reviewer feel | **No — this is the flag** |

**Why the hierarchy is the whole point:** when a NIGO lands, the system's most valuable output is
telling you *which tier* the requirement actually sits in. "FINRA requires one fund family" collapses
the moment the system shows the requirement isn't in any `FINRA_RULE` document — it's at best
`FFS_PROCEDURE`, and possibly `INTERNAL_PREFERENCE`. That reclassification is your leverage, and it's
only possible because the library tags authority type.

### 2.2 What you upload into it

- Applicable FINRA rules (the ~15 governing VUL/VA/MF/529 — targeted, not the whole rulebook)
- Reg BI / SEC rule text
- FFS compliance manuals, WSPs, bulletins (FCB), the 326349 Reg BI Supplement
- Product guidelines and carrier submission requirements (per carrier)
- Forms + their instructions (311883, replacement notices, 1035 forms, applications)
- State requirements (TX 28 TAC, NAIC models as adopted)
- Operational procedures (Docupace workflow, submission checklists)
- **Your prior NIGOs + the responses + corrections + final outcomes** (the case history)
- **Completed RightBridge reports** (structure, fields, disclosures, workflow)

### 2.3 Storage (fits your existing Supabase)

```
Supabase (pgvector extension):

knowledge_documents        -- one row per uploaded document
  doc_id, title, authority_type, source_org, effective_date,
  product_scope[], state_scope[], carrier, uploaded_at, file_ref

knowledge_chunks           -- chunked + embedded passages for retrieval
  chunk_id, doc_id, chunk_text, embedding vector(1536),
  authority_type,           -- inherited from parent doc (drives the hierarchy)
  section_ref               -- e.g. "2330(b)(1)(A)" for precise citation

nigo_cases                 -- your NIGO history (the memory)
  case_id, work_item, client_ref, product, carrier, reviewer,
  raw_nigo_text, received_at, round_number,
  outcome,                  -- resolved|rejected|escalated|withdrawn
  lessons_learned, resolved_at

nigo_issues                -- each NIGO split into individual issues
  issue_id, case_id, seq, issue_text,
  matched_chunk_ids[],      -- the authority passages it maps to
  authority_type,           -- what tier the requirement actually sits in
  validity,                 -- valid|partially_valid|duplicative|inconsistent|
                            --   unsupported|needs_clarification
  resolution, response_text

rightbridge_reports        -- learned report structure + per-case values
  report_id, case_id, report_type,  -- product_profiler|life_wizard
  parsed_fields jsonb,      -- every field + value extracted
  scoring_flags jsonb,      -- green/yellow/red per axis
  uploaded_at
```

---

## 3. The processing pipeline (what happens when a NIGO comes in)

You paste or upload the NIGO. The system runs this sequence. Every step maps to one of your
requirements.

```
STEP 1 — PARSE
  Split the NIGO into discrete issues. One NIGO email often has 3-5 separate requests.
  → produces nigo_issues rows (seq 1..n)

STEP 2 — RETRIEVE (per issue)
  Semantic-search knowledge_chunks for the passages that actually govern this issue.
  Pull the top matches ACROSS authority types — so we see whether a FINRA_RULE, an
  FFS_PROCEDURE, a CARRIER_REQUIREMENT, or nothing matches.
  → matched_chunk_ids[]

STEP 3 — CLASSIFY AUTHORITY (your "distinguish among requirements")
  For each issue, determine the HIGHEST authority tier that actually supports it:
    - Supported by a FINRA_RULE / SEC_RULE / STATE_REQUIREMENT → it's law
    - Only by FFS_PROCEDURE → it's firm policy (say so)
    - Only by CARRIER / FORM → carrier/form requirement (say so)
    - By nothing in the library → unsupported / internal preference (FLAG IT)
  → authority_type per issue

STEP 4 — VALIDATE (your validity determination)
  Assign each issue a validity status:
    valid | partially_valid | duplicative | inconsistent | unsupported | needs_clarification
  Logic:
    - The requirement exists AND the file doesn't meet it        → valid
    - Exists but overreaches what the rule requires              → partially_valid
    - Already answered elsewhere in the file / a prior round     → duplicative
    - Contradicts another NIGO item or a prior approval          → inconsistent
    - No governing authority found                                → unsupported
    - Can't tell without more info                                → needs_clarification

STEP 5 — REVIEW THE FILE (your documentation review)
  Cross-check the case's RightBridge report + forms + notes + disclosures for:
    missing | incomplete | inaccurate | inconsistent | conflicting | unclear | unsupported
  Especially: note-vs-RightBridge contradictions (risk tolerance, IVA/MVA, premium, loan).
  → concrete findings per document

STEP 6 — EXPLAIN + INSTRUCT (your "explain what must be corrected")
  For each issue: plain-English explanation of WHY it was raised, WHAT is wrong/missing,
  and EXACTLY what to correct/revise/complete/clarify/add/remove.

STEP 7 — DRAFT (your response generation)
  Produce the appropriate artifact per issue:
    - valid            → corrected paperwork + hardened note, to the objective standard
    - partially_valid  → corrected note + response noting what the rule actually requires
    - duplicative      → response pointing to where the file already answers it (w/ doc ref)
    - inconsistent     → clarification request naming the contradiction
    - unsupported      → response requesting the specific rule/procedure citation
    - needs_clarify    → clarification request naming exactly what's needed

STEP 8 — CITE + VERIFY (your citation + no-invention requirements)
  Every conclusion carries the specific citation (section_ref) from the retrieved chunk.
  VERIFY GATE: before any response ships, confirm each citation traces to a real retrieved
  chunk. If a claim can't be grounded in a retrieved passage → the system does NOT assert it;
  it states "insufficient authority in the library to confirm this" and asks you to upload the
  governing document. NO fabricated rules, citations, or facts. Ever.

STEP 9 — LOG (your continuous-improvement record)
  Store the NIGO, the analysis, the response, and (later) the outcome + lessons learned.
  Future NIGOs retrieve against this history — the system gets sharper with every case.
```

---

## 4. The assist functions (before AND after submission)

Beyond NIGO resolution, the same knowledge base powers the proactive side:

### 4.1 RightBridge assistance
- **Field guidance:** for each RightBridge field, retrieve the form instruction + the FINRA/suitability
  standard behind it, and explain what a correct, consistent entry looks like.
- **Consistency check:** once a report is uploaded, cross-check every field against the case notes and
  other forms — catch the Aggressive-vs-Moderate, IVA-"No"-while-exiting-a-segment contradictions
  BEFORE submission.
- **Learned structure:** the more completed reports you upload, the better it understands the workflow,
  the scoring logic, and what trips a caution/red.

### 4.2 Paperwork preparation
- Retrieve the form instructions + carrier requirements for the specific transaction, produce a
  complete checklist of required forms/fields/signatures, flag what's missing before you submit.

### 4.3 Note authoring & strengthening
- Draft or harden case notes, suitability notes, replacement explanations, transaction descriptions,
  and compliance explanations **against the objective standard** (the U1–U8 + product add-ons checklist),
  so every note visibly satisfies every applicable element — pre-armored against a subjective reviewer.

### 4.4 Documentation review
- Pre-submission pass over the whole package: missing/incomplete/inaccurate/inconsistent/conflicting/
  unclear/unsupported — the same STEP 5 logic, run proactively instead of reactively.

---

## 5. Guardrails (non-negotiable — these protect YOU)

1. **No invention.** Rules, citations, facts, interpretations — if it's not grounded in a retrieved
   library passage, the system doesn't assert it. The verify gate (STEP 8) enforces this.
2. **Insufficiency is a valid answer.** When the library lacks the governing document, the system says
   "insufficient authority to confirm — upload [document type]" rather than guessing.
3. **Honest validity.** The system must call `valid` when a NIGO is valid. A tool that rationalizes every
   NIGO trains you to fight valid supervision and invites an audit. The honesty is the weapon: your
   push-backs win *because* the system also tells you plainly when they've got you.
4. **Authority tier is always stated.** Every conclusion says which tier the requirement sits in
   (FINRA law vs. firm policy vs. carrier vs. unsupported). This is the anti-"house-policy-as-FINRA" core.
5. **Flag uncited NIGOs.** When a NIGO doesn't name the rule/procedure/form behind a request, the system
   flags it and drafts the request for the specific citation. An unciteable requirement can't be verified.
6. **This is a drafting and analysis aid, not the compliance principal.** Genuinely novel or contested
   calls still route to Ryan Anderson. The system makes you fast, grounded, and cited — not a substitute
   for the licensed supervisor on gray-area judgment.

---

## 6. Build order (phased, honest about where each lives)

| Phase | What | Where it's built |
|---|---|---|
| 1 | Knowledge library schema + ingestion (upload → chunk → embed → tag authority_type) | FSOS repo / Supabase pgvector |
| 2 | Seed the FINRA/Reg BI/2024-Report/326349 corpus + the objective-standard checklist | Corpus assembly (startable now) |
| 3 | NIGO analysis pipeline (STEPS 1-9) as `/api/compliance/analyze` | FSOS repo (getDb, force-dynamic, nodejs) |
| 4 | RightBridge report ingestion + consistency engine | FSOS repo |
| 5 | Note authoring / hardening + paperwork checklist | FSOS repo |
| 6 | NIGO history + pattern analytics (authority-tier breakdown over time) | FSOS repo |
| 7 | Command Center "Compliance Intelligence" UI (inline styles) | fsos_command_center.jsx |

---

## 7. What I can do right now vs. what needs the repo

**Now, in this environment:**
- Assemble the seed knowledge corpus (Phase 2) — the real FINRA rule texts + Reg BI + the 2024 examiner
  rubric + FFS 326349 + the objective standard, chunked and tagged with authority_type, ready to load.
- Write the exact Claude Code build prompts for Phases 1, 3-7 so nothing is lost handing it to the repo.

**Needs your live FSOS repo + Supabase (Claude Code):**
- The pgvector schema, the ingestion routes, the analysis API, the UI — all against your real stack,
  following your getDb/force-dynamic/inline-styles rules.

**Needs YOU to provide (the library is only as good as what's in it):**
- Your FFS compliance manuals, WSPs, FCB bulletins, carrier requirement docs, form instructions.
  The system can't cite an FFS procedure it's never seen. The FINRA/SEC/state side I can seed; the
  FFS-internal and carrier side has to come from your documents.
