# Deferred Plugin Install Runbook

> **Purpose.** Exact, hardened steps to install four Claude Code plugins —
> **Impeccable**, **Superpowers**, **claude-mem**, and **Task Observer** — into the
> Claude Code session that runs against this FSOS repo.
>
> **Where this runs.** Plugin install is a **terminal-side `/plugin` operation** in
> your Claude Code session. It cannot be performed from a claude.ai chat sandbox
> (that environment is ephemeral and separate from your repo session), and none of
> these four are in the claude.ai plugin catalog — they ship from their own
> git-repo marketplaces. Paste the commands below into your Claude Code session at
> the root of this repo.

---

## 0. Sequencing gate

Per the compliance-first "clean build, then deploy, then tooling" rule, tooling
like this is deferred until the build is clean and deployed.

- **Build gate: CLEAR.** `npm run build` compiles successfully (exit 0). The
  referral-route fix (`const query = supabaseAdmin` → `getDb()`) is already on
  `main`; `supabaseAdmin` no longer appears anywhere in application code. There is
  no build blocker to clear before installing.
- **Deploy gate: verify separately.** Confirm the current `main` is deployed to
  Vercel before running any persistence plugin against a real session.

None of these four plugins touch the build or the deploy path, so installing them
does not change application behavior. The risk they carry is **data-at-rest**
(the two persistence plugins) and **code execution via hooks** — addressed in §3.

---

## 1. How install works

A plugin bundles skills, subagents, hooks, and/or MCP servers. You install it from
a **marketplace** — a git repo carrying a `.claude-plugin/marketplace.json`
manifest at its root. Non-default marketplaces are added manually with
`/plugin marketplace add <owner>/<repo>`, then you install with
`/plugin install <name>@<marketplace>`.

**Scope** determines availability and is a **compliance decision** here, not a
convenience one:

| Scope | Location | Use for |
|---|---|---|
| user | `~/.claude/` | The two persistence plugins (keeps their stores out of the repo tree) |
| project | shared via version control | The two dev-loop harnesses (fine to share) |
| local | current repo only | — |

---

## 2. Install runbook

### ⚠️ Verify the marketplace slugs before running

`/plugin marketplace add` **clones and can execute the target repo's code.** The
owner/repo pairs below are the commonly-cited sources but are **NOT verified from
inside this repo**. Per the FSOS "no invented / unverified external data" posture,
**open each project's README and confirm the owner/repo before adding it.** Do not
paste these on faith.

| Plugin | Candidate marketplace slug — **verify first** |
|---|---|
| Impeccable | `pbakaus/impeccable` |
| Superpowers | `obra/superpowers` |
| claude-mem | `thedotmack/claude-mem` |
| Task Observer | `rebelytics/one-skill-to-rule-them-all` |

### Step 1 — register the marketplaces (after verifying each slug)

```
/plugin marketplace add pbakaus/impeccable
/plugin marketplace add obra/superpowers
/plugin marketplace add thedotmack/claude-mem
/plugin marketplace add rebelytics/one-skill-to-rule-them-all
```

### Step 2 — install

The exact `<name>@<marketplace>` suffix is manifest-declared and varies by plugin,
so **do not guess it.** Run `/plugin`, open **Discover**, and install each from the
browser (or use the `name@marketplace` string the manager displays).

- **Impeccable, Superpowers** → **project scope** is fine.
- **claude-mem, Task Observer** → **user scope** (rationale in §3).

### Step 3 — reload and verify

```
/reload-plugins
/plugin        → Installed tab → confirm all four enabled
```

---

## 3. Mandatory hardening — before claude-mem or Task Observer see any session with client data

Both persist conversation/observation content to disk. On a codebase carrying
client PII, suitability notes, and NIGO data, that store is **regulated
data-at-rest**. Complete all four steps before either plugin runs against a real
session.

1. **Install at user scope (`~/.claude/`), not project scope.** Keeps persistence
   artifacts out of the repo working tree so they can't be committed or shared
   through the FSOS remote.
2. **Disable cloud sync.** Force local-only stores; no external persistence of
   session content. Verify the plugin does not ship memory off-box by default.
3. **Confirm store paths resolve outside the repo, then gitignore them anyway**
   (belt-and-suspenders):
   ```gitignore
   .claude-mem/
   **/observations/
   **/*.mem
   ```
4. **Wrap sensitive outputs in the plugin's skip/ignore tags** so client PII,
   suitability rationale, and compliance material are never written to the
   memory/observation store.

Neither persistence plugin — and neither dev harness — should ever touch the
outreach or PII surface. They are **dev-loop tooling only**; per the compliance
posture their review cost stays contained as long as they never run against
client-facing workflows.

---

## 4. Risk profile

| Plugin | Type | Compliance concern | Action |
|---|---|---|---|
| Impeccable | Code-quality harness | Low; bundled hooks run shell commands | Review hooks before enabling |
| Superpowers | Planning / subagent harness | Low; can spawn subagents + hooks (context + command exec) | Review hooks; watch context cost |
| claude-mem | Session persistence | **High** — persists conversation content | Full hardening (§3) |
| Task Observer | Observation persistence | **High** — persists task/observation data | Full hardening (§3) |

---

## 5. Verification checklist

- [ ] Build green on `main` (`npm run build`, exit 0) — **confirmed**
- [ ] Current `main` deployed to Vercel — verify before persistence plugins run
- [ ] Each marketplace owner/repo confirmed against its README before `marketplace add`
- [ ] Hooks reviewed for Impeccable + Superpowers before enabling
- [ ] claude-mem + Task Observer installed at **user scope**
- [ ] Cloud sync disabled on both persistence plugins
- [ ] Store paths resolve outside the repo; gitignore entries added anyway
- [ ] Sensitive outputs wrapped in skip/ignore tags
- [ ] `/reload-plugins` run; all four show enabled in `/plugin` → Installed
