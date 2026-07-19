# Seed Corpus — What's In It and What You Must Add

`seed_corpus.json` is the starting knowledge base. 20 chunks, each tagged with an `authority_type`
(the tier hierarchy) and a `section_ref` (for citation). This is what the system "knows" on day one.

## What I seeded (public sources, grounded)

| Tier | Chunks | Covers |
|---|---|---|
| FINRA_RULE | 2330(b)(1)(A), 2330(b)(1)(B), 2330(b)(2), 2330(c), 2111, breakpoints/ROA, 2010, 4511, RN 22-18 | The core VA/suitability/signature rules your NIGOs touch |
| SEC_RULE | Reg BI care obligation, Reg BI reasonably-available-alternatives | The best-interest standard behind "notes not good enough" |
| STATE_REQUIREMENT | TX 28 TAC replacement, NAIC #613 | Texas + model replacement forms/signatures |
| SUITABILITY_STANDARD | 2024 Report VA rationale, 2024 Report data-integrity, 1035 loan/boot, buffered/limited-protection | The objective "good enough" standard + the data-consistency + tax rules |
| FORM_INSTRUCTION | Form 311883 eSignature Terms | Confirmed from a real NIGO |
| FFS_PROCEDURE | **STUB** | **Empty — you must upload** |
| CARRIER_REQUIREMENT | **STUB** | **Empty — you must upload** |

## The two things only YOU can add (and why they matter most)

**1. FFS_PROCEDURE — your firm's actual internal documents.**
Upload: the FFS compliance manual, WSPs, FCB bulletins (like the 0513-25 one your Wesner NIGO cited),
Docupace submission procedures, the 326349 Reg BI Supplement.

Why this is the highest-value upload: the system's single most powerful move is telling you *"this NIGO
maps to FFS firm policy, not a FINRA rule."* It can only do that with certainty if it can retrieve the
actual FFS procedure and show the requirement lives there (firm policy), not in any FINRA_RULE chunk.
Without your FFS docs, the system correctly says "not supported by any FINRA/SEC/state rule in the
library — appears to be firm policy or preference," which is already useful — but WITH your FFS docs it
can say "this is FFS Procedure §X, a firm policy, not a FINRA requirement," which is airtight.

**2. CARRIER_REQUIREMENT — per-carrier submission guides.**
Upload: Pacific Life, Athene, MassMutual, Equitable, FNWL submission and form requirements.

Why: some NIGOs are carrier conditions, not FINRA rules (e.g., Pacific Life accepting a 1035-with-loan
only if the ceding carrier permits carryover). Distinguishing carrier requirements from FINRA
requirements is part of your core ask, and it needs the carrier docs in the library.

## The verification step before external use

Every FINRA/SEC/state chunk is marked `verbatim: false` — it's indexed with correct section_refs but
paraphrased for retrieval. Before any chunk grounds a response you send to Farmers, load the verbatim
rule text from the primary source (finra.org, sec.gov, TX TAC) and flip `verbatim: true`. The system's
no-invention guardrail means it will cite the section_ref; you want the underlying text to be exact when
it leaves your desk.

## How it grows

Every NIGO you resolve, every response that works, every outcome — logged to `nigo_cases`/`nigo_issues`
and retrievable. Every governing document you upload — added to the library. The system gets sharper
with use. The seed is the floor, not the ceiling.
