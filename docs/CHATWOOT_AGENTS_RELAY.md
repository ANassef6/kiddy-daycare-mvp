# Chatwoot Agents-inbox relay (KID-501 / KID-502)

A pull-based relay between the Chatwoot **Agents** inbox and Paperclip. Nassef
(`trois4ever@gmail.com`, Chatwoot user `1`) chats with each Paperclip agent in
its own thread; a Paperclip routine delivers the messages to the agents and
mirrors their replies back.

Chosen mechanism: **pull, not webhooks.** The push chain was built and tested
first (KID-501): a Paperclip routine webhook trigger plus a Chatwoot account
webhook (id 2) pointing at it — but Chatwoot cannot reach the Paperclip host
(`mika.taile62724.ts.net` is tailnet-only; Vercel functions cannot reach it
either, and Chatwoot cannot present the Bearer header the fire endpoint
requires). A long-lived Paperclip credential on a public Vercel endpoint was
rejected for that reason. The pull design reuses each run's own short-lived run
JWT, needs no hosted endpoint, and satisfies all the security/idempotency
requirements. Documented in KID-502; the relay runner is
[`scripts/agents-relay/relay.mjs`](../scripts/agents-relay/relay.mjs).

## Constants

| What | Value |
| --- | --- |
| Chatwoot base | `http://192.168.1.60:3000` (config: `CHATWOOT_BASE_URL`) |
| Account / inbox | account `1`, inbox `2` ("Agents", API channel) — name "KiddyAPP" is inbox 1, never relayed |
| Human sender filter | messages from the Chatwoot operator accounts listed in `AGENTS_RELAY_FORWARD_USER_IDS` (user `1`, `message_type == 1 && private == false`) |
| Mapping | conversation `custom_attributes.paperclip_agent_id` (+ `agent_name`) |
| Company secret | `chatwoot` — fetched at runtime via `POST /api/agents/me/secrets/chatwoot/value`; never logged, never stored; `AGENTS_RELAY_CHATWOOT_TOKEN` can override for manual runs |

Mapping table (as provisioned):

| Conversation | Agent | Paperclip agent id |
| --- | --- | --- |
| 14 | QA | `a2407e39-7588-441b-a4fc-5e6e3cfa299d` |
| 15 | Ledger | `7610ac95-a59c-475e-81c4-e84a8e909c27` |
| 16 | Wren | `ee275408-fb30-4963-b469-d61e9ba0c216` |
| 17 | Pentester | `d7d49327-a771-4d44-8948-2868aecfe68d` |
| 18 | Mika | `ba4b55ba-748d-4909-a589-75c27f1061f0` |
| 19 | Cody | `6344d5e7-6c24-4623-9297-0632d8ed48db` |
| 20 | Noor | `13b3940e-145c-4530-9eed-4444f43294c4` |

## How a tick runs

The Paperclip routine **"Chatwoot Agents-inbox relay tick"** (routine id
`1c9b6485-f815-4501-a7b6-af683e015a2b`; one `schedule` trigger, `*/5 * * * *`
UTC, `always` gate; `coalesce_if_active`, `skip_missed`; run issues are
children of [KID-502](/KID/issues/KID-502)) creates an execution issue assigned
to Cody. The run:

1. Reads the `relay_state` document on [KID-502](/KID/issues/KID-502)
   (cursors + open/closed relay-task ledger). Missing or malformed → the run
   rebuilds it and anchors every mapped conversation's cursor at the newest
   message id already present, so pre-relay history never bursts.
2. **Direction A** — for each mapped conversation, fetches messages newer than
   the cursor and turns every human-operator message into a standalone
   Paperclip task assigned to the mapped agent (the tasks are NOT children of
   the anchor: the delegation-cycle guard rejects anchor-chain children whose
   assignee also created an ancestor, e.g. Cody under KID-501/502). The task
   quotes the message in its body and carries the relay tag
   `cw-relay:cw-msg:<conversationId>:<messageId>` as the creation
   `idempotencyKey` (collisions resolve by tag lookup, no duplicates).
   Private notes, activity/system items, other senders, other inboxes, and
   unmapped conversations are skipped. The cursor advances to the newest
   scanned id once candidates are picked; a failed create is retried by the
   dedupe backstops (seen ids + tag search) on the next tick.
3. **Direction B** — for every `open` ledger task, fetches comments newer than
   `lastMirroredCommentId` and mirrors comments authored by the assigned agent
   into the mapped conversation as Chatwoot **incoming** messages tagged with
   `echo_id: cw-relay:<taskId>:<commentId>`. Dedupe is triple-layered: the
   monotone comment cursor, the task's `mirroredCommentIds` window, and a
   same-content backstop against the conversation's latest messages (echo ids
   are not returned by the Chatwoot message list, so the content backstop is
   what survives state resets). Terminal tasks get an honest one-line closure
   notice only if the agent never wrote a mirrored reply, then their ledger
   entry moves to the closed ledger.
4. Writes the updated `relay_state` back with revision-safe
   `baseRevisionId`; a 409 (concurrent tick) fails the run loudly and the next
   tick retries. On partial Direction B failure the state is not persisted.

The relay task is the only place a Chatwoot message body is legally quoted
(the mapped agent needs the content to answer). `relay_state`, run comments,
and this runbook must never contain message bodies, tokens, or chatwoot URLs
with credentials.

## Operating notes

- Add a future agent: create the Chatwoot thread in inbox 2 with the contact
  identifier `paperclip-agent-<agentId>` and conversation custom attributes
  `{ "paperclip_agent_id": "<agentId>", "agent_name": "<name>" }`. The next
  tick picks it up automatically (new cursor, no history replay).
- Remove/replace an agent: edit the conversation's `custom_attributes` in
  Chatwoot (or archive the conversation). A stale conversation disappears from
  the mapping (not seen as inbox-2 + `paperclip_agent_id` any more); its
  ledger tasks keep running to completion.
- Rotate the Chatwoot credential: rotate the company secret `chatwoot` in the
  Paperclip secrets service, then send `POST /api/v1/profile` with the new
  token to verify. The pump re-reads the secret on every run — no restart.
  Rotating breaks nothing in the repo: no token value is stored.
- Disable the bridge: `PATCH /api/routines/1c9b6485-f815-4501-a7b6-af683e015a2b`
  with `{ "status": "paused" }` (or archive). In-flight tasks keep running; no
  further ticks are created. Re-enable with `{ "status": "active" }`.
- Manual run from the workspace:
  `node scripts/agents-relay/relay.mjs` (needs `PAPERCLIP_API_URL`,
  `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`); `--dry-run` reports what would
  route without writing.
- Never edit `relay_state` by hand while a tick may fire; set it through the
  document API with `baseRevisionId`. If a tick fails with a state error,
  check the run issue for the exact failure before touching the document.
- Debug a failed delivery:
  1. Routine ran? `GET /api/routines/1c9b6485-f815-4501-a7b6-af683e015a2b/runs`
     (statuses: `issue_created` / `coalesced`; in-flight run issues are the
     KID-502 children).
  2. Pump logged an error? The run issue comment carries the JSON error line
     (`event`: `task_create_failed` / `mirror_post_failed` / `state save failed`
     with the status code, inbox/conversation/message ids, no bodies).
  3. Chatwoot delivered the message? Check the conversation's message list
     (`message_type == 1`, sender = Nassef, `private == false`).
  4. Task exists? Search Paperclip issues for `cw-relay:cw-msg:<conv>:<msg>`.
  5. Mirror posted? Check the conversation for `content_attributes.echo_id`
     starting `cw-relay:<taskId>:`.
- History bursts: `relay_state` cursors are anchored at bootstrap. Re-anchoring
  (resetting a conversation cursor to the newest existing message id) is the
  escape hatch if old history must be re-skipped.
