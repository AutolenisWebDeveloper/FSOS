---
description: Trace a subsystem end-to-end and produce an evidence table. Changes nothing.
argument-hint: <subsystem, route, bug, or question>
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git diff:*), Bash(git show:*), Bash(rg:*), Bash(ls:*), Bash(find:*), Bash(sed:*), Bash(wc:*)
---

Investigate: **$ARGUMENTS**

This is a **read-only** command. Do not edit, create, or delete any file. Do not run tests,
builds, or migrations. If you find yourself wanting to change something, stop and report it
as a finding instead.

Follow FSOS's investigation-before-implementation contract:

1. **Restate the objective in one sentence.** If the request is ambiguous, say which reading
   you are taking and why.

2. **Trace the path end-to-end** and name the exact files and functions at each hop:
   `UI → route → readJson()/validation → service → data model + RLS → tests`
   Not every hop exists for every subject; say which ones do not and why.

3. **Produce an evidence table.** One row per material claim:

   | # | Claim | Evidence (`file:line`) | Confidence |
   |---|-------|------------------------|------------|

   Cite `file:line` for every architecture conclusion, security or authorization boundary,
   database/RLS behavior, API contract, business-workflow behavior, and any existing
   functionality that a change would touch. Routine narration needs no citation.

   Confidence is one of **VERIFIED** (you read the code), **ASSUMPTION** (stated, unproven),
   or **UNVERIFIED** (needs live infrastructure or access you do not have). A Supabase claim
   sourced from a migration file is an ASSUMPTION about the live database, not a VERIFIED
   fact — say so.

4. **State what you would reuse vs. create**, and name what must be preserved. FSOS's rule is
   reuse → extend → consolidate → create only what is missing. If a capability already exists,
   name the file that has it.

5. **List the open questions** that would change the implementation, separating the ones you
   can resolve from repository evidence (resolve them and say so) from the ones that need an
   owner decision (ask them).

End with: **what you did NOT verify, and why.** "I have not verified that" is a correct
answer here; guessing is not.
