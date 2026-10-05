---
name: fsos-human-handoff
description: Use when working on transfers to people, transfer routing, licensing checks, whisper summaries, callbacks, the FSA incoming-transfer and notification screens, or live listen-in/take-over.
---

# FSOS human handoff

## Target resolution (server-side, never by the model)
reason → required capability/license (securities → registered rep) → client's assigned FSA → office → on-duty and licensed per the synced roster → available → target. Order: assigned FSA → office ring group → licensed-rep queue (regulated topics) → voicemail + callback task.

Securities topics go only to registered, on-duty reps checked against the roster before dialing. No licensed rep available → callback task with high priority, never an unlicensed person.

## Handoff packet (same for transfers and callbacks)
caller and assurance level · reason for call and workflow · what the AI did (verification, facts read, actions, tasks) · facts already stated, each with its source · why it handed off (asked, securities, suitability, rollover, complaint, failed verification, unsupported action, system fallback) · relevant context · next human action. The whisper is read from this packet; the AI states what it did not say (e.g. "no recommendation given").

## Failed transfer
No answer → approved voicemail where allowed → callback item with owner, due time (SLA), priority, source call link, transcript → FSA notification (no client details on the lock screen; quiet hours except transfers).

## Screens
Incoming AI transfer (mobile: accept, send to licensed-rep queue, decline → voicemail + task), FSA notifications, Callbacks & voicemail queue, Live calls listen-in and take-over.

## Exit (Stage 3)
≥ 98% correct targets; 100% of securities transfers to registered reps; median connect ≤ 20 s at the pilot office; callback SLA met for two weeks.
