---
description: Adversarial review of the current diff in a fresh context via the implementation-reviewer subagent.
argument-hint: [optional: base ref, defaults to the upstream branch or main]
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git merge-base:*), Read, Grep, Glob, Task
---

Review the pending changes. Base ref hint: **$ARGUMENTS**

1. Establish the diff. Default base is the branch's upstream, else `origin/main`:
   `git merge-base HEAD origin/main` then `git diff <base>...HEAD --stat` and the full patch.
   Include untracked files — `git status --short` — they are part of the change and a plain
   `git diff` will not show them.

2. **Delegate the review to the `implementation-reviewer` subagent**, which runs in a fresh
   context. This is the whole point: the context that wrote the code is the worst judge of it,
   because it already believes its own reasoning. Pass the subagent the full diff, the stated
   objective, and the list of untracked files.

3. When the review returns, do **not** reflexively agree. For each finding, decide:
   - **Valid** → fix it, and say what you changed.
   - **Invalid** → say why, with `file:line` evidence that refutes it.
   - **Out of scope** → note it as follow-up work; do not silently expand the change.

   A reviewer finding is not a blocker and not an order. It is a claim to be checked. Do not
   perform agreement, and do not implement a suggestion you believe is wrong.

4. Re-run `/verify` if you changed anything.

Report: findings raised, findings fixed, findings rejected with reasons, and the residual risk
you are knowingly accepting.
