# KID-501 evidence — Chatwoot Agents inbox: two-way relay

Architecture, tests, and incidents. The chosen mechanism is a **pull-based
relay driven by a Paperclip routine** (no webhook ingest; the failed push path
was built, measured, and retired). Operational runbook:
[`docs/CHATWOOT_AGENTS_RELAY.md`](../CHATWOOT_AGENTS_RELAY.md). Runner script:
[`scripts/agents-relay/relay.mjs`](../../scripts/agents-relay/relay.mjs)
(commit `462e14b`).

No tokens, message bodies, or credential-bearing URL fragments appear in this
document; quoted threads are referenced by id only.

## Mechanism decision (push tried first, rejected on measured facts)

- Chatwoot → public HTTPS reaches `kiddyapp.net` and `*.vercel.app` (KID-472/480
  production webhook works), so a Vercel receiver was viable for the ingest
  hop.
- A Vercel probe function (`fetch` to the Paperclip host
  `mika.taile62724.ts.net`) always failed; the Paperclip API is tailnet-only.
  Therefore a Vercel receiver could never create Paperclip tasks or fire a
  routine trigger.
- A Paperclip routine **webhook trigger** was created and fired successfully
  from the sandbox (run `b7f0bf1d-…` 2026-11-07T03:12:59Z, `status`:
  issue_created), but Chatwoot cannot present the Bearer secret its fire
  endpoint requires, and Chatwoot never delivered a run against the
  unauthenticated `none` mode URL (no routine run observed after four
  message_created events in the Agents inbox) — the tailnet host is not
  reachable from the Chatwoot host either.
- Therefore: the Chatwoot account webhook was deleted, the routine webhook
  triggers were deleted, and the relay settled on the **routine-only pull
  design**: `schedule` trigger `*/5 * * * *` UTC, `coalesce_if_active`,
  `skip_missed`, run issues parented to KID-502.

## Provisioned and consulted identifiers

- Chatwoot host `http://192.168.1.60:3000`, account `1`, inbox `2`
  ("Agents", API channel). Inbox 1 (KiddyAPP widget) is never relayed.
- Mapped conversations with contact identifier
  `paperclip-agent-<agentId>` and conversation `custom_attributes`
  `{ paperclip_agent_id, agent_name }`: 14 QA, 15 Ledger, 16 Wren,
  17 Pentester, 18 Mika, 19 Cody, 20 Noor.
- Company secret `chatwoot` = the operator's (user 1) Chatwoot access token.
- Paperclip routine `Chatwoot Agents-inbox relay tick`
  (`1c9b6485-f815-4501-a7b6-af683e015a2b`), trigger
  `100a121a-e643-4e79-ba56-f6c07a6c6c1f`, assigned to Cody, project
  `6818d57f-20ed-4b77-93d5-60640e214757`.
- Relay state = issue document `relay_state` on KID-502
  (`c2e626d9-5323-498c-b282-8c922b4ca06b`), schema v2 (cursors, seen[],
  ledger, closedLedger, meta), saved with `baseRevisionId` (409 fails loudly).

## Round-trip verification

### A2 — Cody (conversation 19) — full round trip, single heartbeat

Timeline (all 2026-11-07):

| t (UTC) | event |
| --- | --- |
| 03:16:37 | relay task created for Chatwoot message 122 (operator self-test) → `cw-relay:cw-msg:19:122` |
| 03:16-03:24 | agent answered on the task (2 comments); tick mirrored the agent reply into conversation 19 as an incoming message (message 123), ledger entry marked closed with `lastMirroredCommentId` set |
| 03:24, 03:29 | later ticks confirmed no replays/duplicates (state revisions recorded closedLedger for the task) |

Measured direction B latency (agent comment → Chatwoot incoming message):
inside the same tick; at most one 5-minute cadence.

### A1 — Mika (conversation 18) — full round trip across ticks

| t (UTC) | event |
| --- | --- |
| 03:27:52 | operator message 125 posted in conversation 18 |
| 03:29:25 | tick advanced the conversation-18 cursor to 125; task creation did not survive the concurrent-tick overlap (see incidents) |
| ~03:30-03:32 | backstop task created manually with the exact pump body; concurrent tick reconciled it into `relay_state.ledger` (`firstSeenAt` 03:32:18) |
| 03:36:09 | agent posted its reply on the task |
| 03:37-03:41 | next tick mirrored the reply into conversation 18 (message 130, contact 388 = the agent's mapped contact), `mirroredCommentIds` recorded |
| ~03:41 | agent closed the task; later tick moved the ledger entry to `closedLedger` |

Measured end-to-end (operator message visible in Chatwoot → agent reply
visible back in Chatwoot): ≈ 9-10 minutes, dominated by the agent heartbeat
wakeup latency (~1-2 min) plus at most one 5-minute tick per direction. The
relay adds < 1 tick latency per direction; the pump's own runtime is ≈ 2-4 s
per tick (`durationMs` 2-4 recorded in `relay_state.meta.lastRunSummary`).

### A3 — unmapped conversation creates no work

A dedicated conversation (id 21, contact identifier `relay-a3-unmapped-test`)
without `paperclip_agent_id` custom attributes was created in inbox 2 and an
operator message 128 was posted into it. The following tick's `mapping`
logged exactly the seven mapped conversations; `relay_state.cursors` gained no
conversation-21 key; no relay task was created for message 128. The test
conversation and contact were then deleted.

### A4 — replay of the same message id creates no duplicate

Three independent gates make a replayed message id idempotent, all exercised
during the run:

1. Issue-create `idempotencyKey` = `cw-relay:cw-msg:<conv>:<msg>` (the pump
   registers collisions as `duplicated: false` rather than erroring).
2. Per-conversation `seen[]` rolling set (last 64 forwarded ids).
3. Full-text tag search backstop (`q=cw-relay:cw-msg:`) that maps existing
   tasks back before creating a second one.

Observed: across many overlapping tick runs between 03:16 and 03:41 (several
concurrent hearts of the same routine), message 122 produced exactly one task
(KID-506) and message 125 exactly one task (KID-508) — no duplicates were ever
created by any replay.

### A5 — private notes are not forwarded

A private note (message 131, conversation 18) was posted and the next tick
only advanced the conversation-18 cursor to 131 (`createdTasks: 0`, ledger
unchanged). No task exists for it and it never appears in any relay record
other than the cursor position.

### A6 — no tokens or bodies in repo/log/document state

`relay_state`, run comments, and this document contain ids and counts only.
The script fetches the Chatwoot token from the Paperclip secrets service at
runtime (`POST /api/agents/me/secrets/chatwoot/value`; `AGENTS_RELAY_CHATWOOT_TOKEN`
may override for manual runs) and stores it only in a promise local to the
process. Nothing is persisted. The pump's stdout/stderr log lines carry
identifiers and status codes only. Task bodies contain message content by
design (the relay's purpose) and nothing else.

### A7/A8 — runbook + service

Runbook: `docs/CHATWOOT_AGENTS_RELAY.md` (mapping changes, credential
rotation, bridge disable, manual pump, delivery debugging). The "service" is
the Paperclip routine + the committed pump script; there is no hosted
endpoint (that is the mechanism decision).

## Incidents encountered (and their disposition)

1. **Concurrent-tick overlap lost message 125.** Two overlapping heartbeat
   runs of the routine tick (state-document 409s fail one run loudly by
   design; another run advanced the conversation-18 cursor past message 125
   while its task create hit an unnamed failure whose stderr was not visible
   in the run record). Recovery: a manual backstop task create using the
   exact pump body; the next tick reconciled it into the ledger and completed
   the mirror. The converged script (commit 462e14b) removed the crash
   window: candidates are gated by `seen[]` + tag search, not by the cursor,
   and a failed create retries on the next tick.
2. **State-document ownership conflicts.** `PUT relay_state` fails with
   "Issue run ownership conflict" while another heartbeat holds the KID-502
   checkout. By design this fails loudly and the next tick retries; the runs
   that intend to write state must hold the anchor checkout first.
3. **Push chain.** Built (routine webhook triggers incl. `none` mode,
   Chatwoot account webhook id 2, Vercel probe) and measured dead:
   Chatwoot cannot reach the Paperclip tailnet host and cannot present
   Bearer auth. Deleted again (Chatwoot webhook `2` deleted; webhook trigger
   deleted; Vercel probe project deleted). No production behavior of the
   KiddyAPP widget inbox or KID-472's support webhook (id 1) was touched.
