# FSOS Compliance Intelligence — COMPLETE PACKAGE (Start Here)

This is the full system: a RAG-based compliance engine that helps you complete RightBridge reports,
prepare paperwork, write and strengthen case notes, review documentation, and resolve NIGOs — grounded
in a knowledge library you own and grow.

Read this file first. It tells you exactly what each file is, which are current, and the order to
build in. **Nothing here overlaps or conflicts once you follow this index.**

---

## THE COMPLETE FILE LIST (9 files, 3 groups)

### GROUP 1 — BUILD THESE (the current, active system)

| # | File | What it is | Use it for |
|---|------|-----------|-----------|
| 1 | `FSOS_Compliance_Intelligence_Blueprint.md` | **THE MASTER ARCHITECTURE.** Data model, 9-step NIGO pipeline, authority-tier hierarchy, guardrails, build order. | The single source of truth. Everything else supports this. Put in repo at `docs/compliance/`. |
| 2 | `objective_standard.md` | The FINRA-grounded checklist of what a suitability note MUST contain — the definition of "good enough." | The note engine writes to this; the NIGO analyzer checks against it. Put in repo at `docs/compliance/`. |
| 3 | `seed_corpus.json` | The starting knowledge base — 20 authority-tagged, citation-referenced rule chunks. | Load into the vector DB. Put in repo at `data/`. |
| 4 | `CORPUS_README.md` | Explains the corpus + what YOU must upload (FFS/carrier docs). | Read once, then act on the "what to upload" section. |
| 5 | `claude_code_build_prompts.md` | 7 sequenced, copy-paste prompts that build the whole system against your repo. | Hand to Claude Code one prompt at a time, in order. |

### GROUP 2 — WORKING TOOL (use right now, no build needed)

| # | File | What it is | Use it for |
|---|------|-----------|-----------|
| 6 | `nigo_shield.html` | A functioning demo — open in a browser, run a NIGO through Door A (pre-flight) and Door B (fix). In-memory only. | Immediate value while the full system is being built. Proves the concept. |

### GROUP 3 — BACKGROUND / SUPERSEDED (keep for reference, do NOT build from)

| # | File | What it is | Status |
|---|------|-----------|--------|
| 7 | `FSOS_Compliance_Intelligence_Spec.md` | First-pass RAG architecture. | **Superseded by #1.** The Blueprint is the fuller version. Reference only. |
| 8 | `FSOS_NIGO_Engine_Design.md` | Original narrower NIGO-engine schema design. | **Superseded by #1.** Some schema detail still useful as reference. |
| 9 | `nigo_rules_seed.md` | Rule catalog derived from your real Hinojosa/Wesner NIGOs. | **Folded into #3 (seed_corpus.json).** Useful as the human-readable version of why each rule exists. |

**Rule of thumb:** build from Group 1, use Group 2 today, read Group 3 only if you want the history of
how the design evolved. If two files ever seem to disagree, **the Blueprint (#1) wins.**

---

## THE BUILD SEQUENCE (exact order)

**Step 0 — Put files in the repo:**
```
docs/compliance/FSOS_Compliance_Intelligence_Blueprint.md
docs/compliance/objective_standard.md
data/seed_corpus.json
```

**Step 1 — Open Claude Code with the FSOS repo. Run the 7 prompts IN ORDER from
`claude_code_build_prompts.md`:**
```
Prompt 1 → database schema + pgvector          (build clean before continuing)
Prompt 2 → corpus loader + document ingestion   (loads seed_corpus.json)
Prompt 3 → NIGO analysis engine (the core)      (the 9-step pipeline)
Prompt 4 → RightBridge report ingestion
Prompt 5 → note authoring + paperwork checklist
Prompt 6 → NIGO history + pattern analytics
Prompt 7 → Command Center UI
```
Do not start a prompt until the prior one builds with zero errors.

**Step 2 — After the build, two mandatory actions (from the prompts file):**
1. Verify the FINRA/SEC/state chunks against primary sources; flip `verbatim: true`.
2. Upload your FFS internal docs + carrier guides via the Knowledge Library tab. **This is the highest-
   value action** — it's what lets the system say "this NIGO is FFS policy, not FINRA" with a citation.

---

## WHAT THE FINISHED SYSTEM DOES (your requirements → where they live)

| Your requirement | Delivered by |
|---|---|
| Complete RightBridge reports | Prompt 4 (ingestion + consistency) + Prompt 5 (fill guidance) |
| Prepare paperwork | Prompt 5 (checklist route) |
| Write / strengthen case notes | Prompt 5 (note route) + objective_standard.md |
| Review documentation | Prompt 3 STEP 5 + Prompt 4 consistency engine |
| Resolve NIGOs | Prompt 3 (the 9-step analyze pipeline) |
| Centralized knowledge library | Prompts 1-2 (schema + ingestion) |
| Distinguish FINRA vs FFS vs carrier vs preference | The authority_type hierarchy (Blueprint §2.1, Prompt 3 STEP 3) |
| Validity: valid/partial/duplicative/inconsistent/unsupported/needs-clarification | Prompt 3 STEP 4 |
| Cite every conclusion; never invent | Prompt 3 STEP 8 (verify gate) |
| Flag uncited NIGOs | Prompt 3 (unsupported → request citation) |
| Store history + improve over time | Prompt 3 STEP 9 + Prompt 6 |

---

## THE THREE THINGS THAT PROTECT YOU (do not skip)

1. **Honest validity.** The system calls a valid NIGO valid. That honesty is the weapon — your
   pushbacks on the "one fund family" and "already-satisfied" NIGOs only land because the same system
   tells you plainly when Farmers has you dead to rights. A tool that rationalizes every NIGO walks you
   into an audit.

2. **No invented citations.** The verify gate (Prompt 3 STEP 8) blocks any rule number or requirement
   not present in a retrieved library chunk. This is what keeps you from sending Farmers a fabricated
   FINRA cite that blows up.

3. **The e-signature flag.** The corpus includes RN 22-18. If a case file shows a client signing from a
   rep-domain email (as your Hinojosa DocuSign did), the system flags it as ENFORCEMENT risk, not a
   routine NIGO. Route those to Ryan Anderson.

---

## WHAT YOU STILL NEED TO SUPPLY (the system can't cite what it hasn't seen)

- FFS compliance manual, WSPs, FCB bulletins (e.g., 0513-25)
- Carrier submission guides (Pacific Life, Athene, MassMutual, Equitable, FNWL)
- Form instructions (311883, replacement notices, 1035 forms, applications)
- Your prior NIGOs + the responses that worked + final outcomes (seed the history)
- Completed RightBridge reports (so it learns the report structure)

Upload these through the Knowledge Library tab once built. The FINRA/SEC/state foundation is seeded;
the FFS-internal and carrier layers are yours to add — and they're what make the system airtight.
```
