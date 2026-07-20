# Twilio MCP Server — Install Runbook

> **Purpose.** Wire the **Twilio Model Context Protocol (MCP) docs server** into the
> AI coding agents that work against this FSOS repo, so an agent can query Twilio's
> full API surface (1,800+ endpoints across 30+ products) and retrieve exact
> parameter/response schemas on demand instead of guessing from stale training data.
>
> **Status.** Twilio MCP is a **Public Beta** product (subject to change; not covered
> by Twilio Support Terms or SLA). We track it as a **dev-loop tooling aid only** —
> see the compliance note in §3.

---

## 1. What this is (and what it is NOT)

The Twilio MCP docs server is a **hosted, read-only, search-then-retrieve** aid:

| | |
|---|---|
| **URL** | `https://mcp.twilio.com/docs` |
| **Auth** | **None.** No Twilio account, API key, or Account SID required. |
| **Transport** | Streamable HTTP (remote) |
| **What it indexes** | Public Twilio/SendGrid/Segment OpenAPI specs + docs/support articles |
| **Tools exposed** | `twilio__search` (NL query → ranked API ops + docs + IDs), `twilio__retrieve` (ID → full parameter/response schema) |

**It is READ-ONLY.** The server does **not** execute Twilio API calls, does **not**
send SMS/email, and holds **no** credentials. It cannot touch this project's
Twilio account, phone numbers, messages, or any client data. It is a documentation
lookup surface, nothing more.

This is distinct from the **runtime** Twilio integration FSOS already ships
(`src/lib/comms/twilio.ts`, the `/api/webhooks/twilio/*` routes, and the
`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` /
`TWILIO_MESSAGING_SERVICE_SID` env vars). The MCP server does not change, read, or
have any access to those — it only helps an agent look up the correct Twilio API
shapes while editing that code.

---

## 2. Install

The repo ships project-scoped config for two agents. Both are committed, so anyone
cloning the repo gets the server; each agent still prompts the user to approve the
project MCP server on first use.

### Claude Code — `.mcp.json` (repo root, committed)

```json
{
  "mcpServers": {
    "twilio": {
      "type": "http",
      "url": "https://mcp.twilio.com/docs"
    }
  }
}
```

On next start, Claude Code detects the project server and asks you to approve it.
Verify with `/mcp` → the `twilio` server should list `twilio__search` and
`twilio__retrieve`.

**Alternative (per-user, not committed):**
```
claude mcp add --transport http twilio https://mcp.twilio.com/docs
```

Twilio also publishes this as a **Claude Connector** — searchable as "Twilio" in the
connectors directory of the Claude web/desktop/mobile apps — which is the right
path for the claude.ai chat surface (that sandbox is separate from this repo
session and does not read `.mcp.json`).

### Cursor — `.cursor/mcp.json` (committed)

```json
{
  "mcpServers": {
    "twilio": {
      "url": "https://mcp.twilio.com/docs"
    }
  }
}
```

Approve it in **Cursor → Settings → MCP** when prompted.

### Codex / other agents (per-user, not committed here)

Codex reads MCP servers from `~/.codex/config.toml`, not a repo file. Add:

```toml
[mcp_servers.twilio]
url = "https://mcp.twilio.com/docs"
```

Any MCP-capable agent can point at the same URL; no repo change needed.

---

## 3. Compliance note (why this is safe under the FSOS guardrails)

Per `CLAUDE.md` §2, new tooling is judged against the three non-negotiable
guardrails. The Twilio MCP **docs** server clears all three by construction, because
it can only return public documentation and cannot perform any action:

- **§2.1 Securities Firewall** — read-only doc lookup; stores nothing, sends nothing,
  and never touches the `ffs_case_ref` / `is_security` surface.
- **§2.2 AI Green-Zone / Red-Line** — it produces no client-facing message and makes
  no recommendation; it returns API schemas to a developer. The runtime Compliance
  Guardrail dispatcher (`src/lib/comms/*`) is unchanged and remains the only path
  that can emit an SMS/email.
- **§2.3 No Invented Farmers Data** — this is the opposite of invented data: it lets
  the agent fetch **exact, authoritative** Twilio API schemas instead of
  hallucinating endpoints or parameters.

Net risk profile: **lower** than the dev harnesses in
`docs/plugin-install-runbook.md` — no auth, no persistence, no code execution, no
write path. It is dev-loop tooling only and must never be treated as a runtime
integration.

---

## 4. Usage notes

- **Search then retrieve.** `twilio__search` first (natural-language query, pick
  `source="api"` for coding tasks); take the `id` from the best hit and pass it to
  `twilio__retrieve` for the full parameter/response schema. This two-step flow keeps
  context usage small.
- **Versioning.** When multiple API versions exist, search returns the **latest** by
  default (e.g. Programmable Messaging returns v1, not legacy v2010). Filter with the
  `version` / `product` parameters to pin an older one when you must.
- **Model-dependent quality.** Result quality depends on the agent's model — treat
  hits as candidates to confirm, not gospel.

---

## 5. Verification checklist

- [ ] `.mcp.json` present at repo root with the `twilio` HTTP server
- [ ] `.cursor/mcp.json` present with the `twilio` server
- [ ] Agent restarted; project MCP server approved on first-use prompt
- [ ] `/mcp` (Claude Code) shows `twilio` with `twilio__search` + `twilio__retrieve`
- [ ] A test `twilio__search` (e.g. "send an SMS message") returns ranked API ops
- [ ] No Twilio credentials were added anywhere (the docs server needs none)
