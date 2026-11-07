#!/usr/bin/env node
// KID-501/KID-502: Chatwoot "Agents" inbox (inbox 2) two-way relay pump.
//
// Canonical implementation (converged from concurrent KID-502 runs; see
// docs/CHATWOOT_AGENTS_RELAY.md). Run by the "Chatwoot Agents-inbox relay
// tick" routine; state is the `relay_state` document on KID-502 (schema v2).
//
// Direction A (Chatwoot -> Paperclip): new human messages in mapped inbox-2
// conversations (sender user 1, message_type 1, not private, non-empty
// content) become Paperclip tasks assigned to the mapped agent. Tag /
// idempotency key: `cw-relay:cw-msg:<conversationId>:<messageId>`.
//
// Direction B (Paperclip -> Chatwoot): new comments on open relay tasks
// authored by the assigned agent are mirrored into the mapped conversation as
// incoming messages with echo_id `cw-relay:<taskId>:<commentId>`; dedupe is
// belt-and-braces: monotone lastMirroredCommentId + mirroredCommentIds +
// a same-content backstop against recent conversation messages.
//
// Security: the Chatwoot token comes from the company secret `chatwoot`
// (env-injected) or the secrets service; never logged, never stored. Message
// bodies are quoted only inside the relay task itself; log lines and state
// document carry ids/counts only.

const DRY = process.argv.includes("--dry-run");
const QUIET = process.argv.includes("--quiet");

const apiBase = (process.env.PAPERCLIP_API_URL || "").replace(/\/api\/?$/, "");
const apiKey = process.env.PAPERCLIP_API_KEY || "";
const companyId = process.env.PAPERCLIP_COMPANY_ID || "";
const runId = process.env.PAPERCLIP_RUN_ID || "";

const anchorIssueId =
  process.env.RELAY_ANCHOR_ISSUE_ID || "c2e626d9-5323-498c-b282-8c922b4ca06b"; // KID-502
const tasksProjectId = "6818d57f-20ed-4b77-93d5-60640e214757"; // Kiddy project
const tasksGoalId = "e2166444-cacf-48ac-97c0-8c423f36098b"; // Build a SaaS product

const chatwootBase = (process.env.CHATWOOT_BASE_URL || "http://192.168.1.60:3000").replace(/\/$/, "");
const chatwootAccount = "1";
const agentsInboxId = 2; // "Agents" inbox; inbox 1 (KiddyAPP widget) is never relayed
const relayUserId = 1; // human operator (Nassef)
const maxMessagesPerConversation = Number(process.env.AGENTS_RELAY_MAX_PER_CONVO || 10);
const maxBacklogBatch = Number(process.env.AGENTS_RELAY_MAX_BATCH || 40);

function log(event, fields = {}) {
  if (QUIET) return;
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
}

function fail(event, fields, err) {
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), event, error: String(err ?? null), ...fields })}\n`,
  );
  process.exitCode = 1;
}

// ---------------------------------------------------------- http helpers ----

async function ppFetch(url, init = {}) {
  const headers = { ...(init.headers || {}) };
  headers.Authorization = `Bearer ${apiKey}`;
  if (runId) headers["X-Paperclip-Run-Id"] = runId;
  if (init.body) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const res = await fetch(`${apiBase}/api${url}`, { ...init, headers });
  if (!res.ok) {
    // Response tails can echo request text; truncate hard and keep ids only.
    const body = await res.text().catch(() => "");
    const err = new Error(`paperclip ${res.status} ${url} :: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function unpackArticle(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["items", "comments", "issues", "documents"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  return data.issue ? [data.issue] : [];
}

async function ppList(url, init) {
  return unpackArticle(await ppFetch(url, init));
}

async function cwFetch(path, init = {}) {
  const token = await chatwootToken();
  const res = await fetch(`${chatwootBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", api_access_token: token, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`chatwoot ${res.status} ${path} :: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

let cwTokenPromise = null;
async function chatwootToken() {
  if (process.env.CHATWOOT) return process.env.CHATWOOT;
  if (process.env.AGENTS_RELAY_CHATWOOT_TOKEN) return process.env.AGENTS_RELAY_CHATWOOT_TOKEN;
  if (!cwTokenPromise) {
    cwTokenPromise = (async () => {
      const res = await fetch(`${apiBase}/api/agents/me/secrets/chatwoot/value`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`secret chatwoot fetch failed ${res.status}`);
      const data = await res.json();
      const value = typeof data === "object" && data && "value" in data ? data.value : data;
      if (!value || typeof value !== "string") throw new Error("secret chatwoot has no value");
      return value;
    })();
  }
  return cwTokenPromise;
}
if (DRY) cwTokenPromise = Promise.resolve("dry-run-placeholder"); // no real token read

// -------------------------------------------------------- state document ----

function newLedgerEntry() {
  return {
    conversationId: null,
    messageId: null,
    paperclipAgentId: null,
    paperclipAgentName: null,
    status: "open",
    lastMirroredCommentId: null,
    mirroredCommentIds: [],
    firstSeenAt: null,
  };
}

function upgradeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  s.version = 2;
  s.anchoredAt ||= new Date().toISOString();
  s.anchorIssueId ||= anchorIssueId;
  s.inboxId ||= agentsInboxId;
  s.cursors = s.cursors && typeof s.cursors === "object" ? s.cursors : {};
  s.ledger = s.ledger && typeof s.ledger === "object" ? s.ledger : {};
  s.closedLedger = s.closedLedger && typeof s.closedLedger === "object" ? s.closedLedger : {};
  s.seen = s.seen && typeof s.seen === "object" ? s.seen : {};
  s.meta = s.meta && typeof s.meta === "object" ? s.meta : { lastRunAt: null, lastRunSummary: null };
  for (const [taskId, e] of Object.entries({ ...s.ledger, ...s.closedLedger })) {
    if (!e || typeof e !== "object") continue;
    // Legacy v1 entries: numbers held numbers, no name/mirror list.
    e.conversationId = String(e.conversationId);
    e.messageId = String(e.messageId);
    e.paperclipAgentId = e.paperclipAgentId ? String(e.paperclipAgentId) : e.paperclipAgentId;
    e.status = e.status === "closed" ? "closed" : "open";
    if (!Array.isArray(e.mirroredCommentIds)) e.mirroredCommentIds = [];
    if (e.lastMirroredCommentId && !e.mirroredCommentIds.includes(e.lastMirroredCommentId)) {
      e.mirroredCommentIds.push(e.lastMirroredCommentId);
    }
    e.firstSeenAt ||= new Date().toISOString();
  }
  return s;
}

async function loadState() {
  try {
    const doc = await ppFetch(`/issues/${anchorIssueId}/documents/relay_state`);
    try {
      return { state: upgradeState(JSON.parse(doc.body)), revisionId: doc.latestRevisionId };
    } catch {
      log("state_corrupt_reset", {});
      return { state: upgradeState({}), revisionId: doc.latestRevisionId };
    }
  } catch (err) {
    if (err.status === 404) return { state: upgradeState({}), revisionId: null };
    throw err;
  }
}

async function saveState(state, revisionId) {
  if (DRY) {
    log("state_save_skipped_dry", {});
    return;
  }
  const payload = {
    title: "Agents relay runtime state",
    format: "markdown",
    body: JSON.stringify(state, null, 2),
    ...(revisionId ? { baseRevisionId: revisionId } : {}),
  };
  const doc = await ppFetch(`/issues/${anchorIssueId}/documents/relay_state`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return doc && doc.latestRevisionId;
}

// ------------------------------------------------- chatwoot conversation ----

async function listAgentsInboxConversations() {
  const data = await cwFetch(`/api/v1/accounts/${chatwootAccount}/conversations?include_custom_attributes=true`);
  const rows = (data && data.data && data.data.payload) || [];
  return rows
    .filter((c) => Number(c.inbox_id) === agentsInboxId && c.custom_attributes?.paperclip_agent_id)
    .map((c) => ({
      conversationId: String(c.id),
      agentId: String(c.custom_attributes.paperclip_agent_id),
      agentName: String(c.custom_attributes.agent_name || c.custom_attributes.paperclip_agent_id),
    }));
}

async function listConversationMessages(conversationId) {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await cwFetch(
      `/api/v1/accounts/${chatwootAccount}/conversations/${conversationId}/messages?page=${page}`,
    );
    const payload = (data && data.payload) || [];
    out.push(...payload);
    if (payload.length < 25) break;
  }
  return out;
}

function isForwardableUserMessage(m) {
  return (
    m &&
    m.message_type === 1 &&
    m.private === false &&
    m.sender &&
    m.sender.type === "user" &&
    Number(m.sender.id) === relayUserId &&
    typeof m.content === "string" &&
    m.content.trim().length > 0
  );
}

// Failing-to-find is fine; the search-based backstop only guards against
// crashed runs between task creation and cursor advance.
async function existingRelayMessageIds() {
  const ids = new Set();
  try {
    const q = encodeURIComponent("cw-relay:cw-msg:");
    const rows = await ppList(`/companies/${companyId}/issues?q=${q}&limit=50`);
    for (const it of rows) {
      const hay = `${it.title ?? ""}\n${it.description ?? ""}`;
      const m = /cw-relay:cw-msg:(\d+):(\d+)/.exec(hay);
      if (m) ids.add(String(m[2]));
    }
  } catch (err) {
    log("dedupe_search_failed_fallback_to_state", { error: String(err) });
  }
  return ids;
}

async function relayTaskSearchByTag(tag) {
  const rows = await ppList(`/companies/${companyId}/issues?q=${encodeURIComponent(tag)}&limit=20`);
  const withTag = rows.filter((it) => (it.description ?? "").includes(tag));
  return withTag.length ? withTag[withTag.length - 1].id : null;
}

// ------------------------------------------------------- direction A --------

async function createRelayTask({ agentId, agentName, conversationId, message }) {
  const tag = `cw-relay:cw-msg:${conversationId}:${message.id}`;
  const quote = `> ${String(message.content).trim().split("\n").join("\n> ")}`;
  const description = [
    "New message from Nassef in your Chatwoot Agents-inbox thread.",
    "",
    `**Relay tag:** \`${tag}\``,
    "",
    "**What to do:** act on the message below, then post your answer as an ordinary comment on this issue. The relay runner ([KID-502](/KID/issues/KID-502)) mirrors agent comments on this task back into the Chatwoot thread while the task stays open. Close the issue once your reply is posted. Do not include tokens or secrets.",
    "",
    `From Nassef (Chatwoot conversation ${conversationId}, message ${message.id}):`,
    "",
    quote,
  ].join("\n");
  if (DRY) return { id: `dry-${message.id}`, identifier: `CW:${message.id}`, created: true };
  const body = {
    idempotencyKey: tag,
    title: `Chatwoot Agents (conv ${conversationId}, msg ${message.id}) -> ${agentName}`,
    description,
    assigneeAgentId: agentId,
    // Standalone: the anchor chain (KID-501/502) was created by Cody, and the
    // delegation-cycle guard rejects children assigned to mapped agents that
    // also sit in that chain.
    parentId: null,
    projectId: tasksProjectId,
    goalId: tasksGoalId,
    priority: "medium",
  };
  try {
    const created = await ppFetch(`/companies/${companyId}/issues`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { id: created.id, identifier: created.identifier ?? null, created: true };
  } catch (err) {
    const existing = await relayTaskSearchByTag(tag).catch(() => null);
    if (!existing) throw err;
    return { id: existing, identifier: null, created: false };
  }
}

async function pumpDirectionA(state) {
  const conversations = await listAgentsInboxConversations();
  log("mapping_loaded", { conversations: conversations.map((c) => `${c.conversationId}:${c.agentName}`) });
  const knownIds = await existingRelayMessageIds();
  const summary = { created: [], skippedBatch: 0 };
  for (const conv of conversations) {
    const messages = await listConversationMessages(conv.conversationId);
    if (!messages.length) continue;
    const maxScanned = Math.max(...messages.map((m) => m.id));
    const cursor = Number(state.cursors[conv.conversationId] ?? 0);
    if (maxScanned <= cursor) continue;
    // Advance the cursor up front: crash-window recovery rests on the
    // idempotencyKey dedupe, the seen[] set and the tag search, so a failed
    // create below never blocks or replays future scans.
    state.cursors[conv.conversationId] = maxScanned;
    const seen = new Set(state.seen[conv.conversationId] ?? []);
    const candidates = messages
      .filter((m) => Number(m.id) > cursor)
      .filter(isForwardableUserMessage)
      .filter((m) => !seen.has(String(m.id)))
      .filter((m) => !knownIds.has(String(m.id)))
      .sort((a, b) => a.id - b.id)
      .slice(0, Math.max(0, maxMessagesPerConversation));
    for (const m of candidates) {
      try {
        const task = await createRelayTask({ ...conv, message: m });
        const entry = newLedgerEntry();
        entry.conversationId = conv.conversationId;
        entry.messageId = String(m.id);
        entry.paperclipAgentId = conv.agentId;
        entry.paperclipAgentName = conv.agentName;
        entry.firstSeenAt = new Date().toISOString();
        state.ledger[task.id] = entry;
        summary.created.push({
          conversationId: conv.conversationId,
          messageId: String(m.id),
          taskId: task.id,
          duplicated: !task.created,
        });
      } catch (err) {
        fail("task_create_failed", { conversationId: conv.conversationId, messageId: String(m.id) }, err);
        continue; // recovery: tag search re-links the task on a later run
      }
      seen.add(String(m.id));
      state.seen[conv.conversationId] = (state.seen[conv.conversationId] ?? []).concat(String(m.id)).slice(-64);
      if (summary.created.length >= maxBacklogBatch) break;
    }
  }
  return summary;
}

// ------------------------------------------------------- direction B --------

async function recentConversationContents(conversationId) {
  const data = await cwFetch(
    `/api/v1/accounts/${chatwootAccount}/conversations/${conversationId}/messages?page=1`,
  );
  const payload = (data && data.payload) || [];
  return new Set(payload.map((m) => String(m.content ?? "").replace(/\s+/g, " ").trim()));
}

async function mirrorComment({ conversationId, taskId, commentId, text }) {
  const echoId = `cw-relay:${taskId}:${commentId}`;
  if (DRY) return { id: `dry-${commentId}`, deduped: false };
  const data = await cwFetch(
    `/api/v1/accounts/${chatwootAccount}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: text,
        message_type: "incoming",
        echo_id: echoId,
      }),
    },
  );
  return { id: data && data.id, deduped: false };
}

async function pumpDirectionB(state) {
  const summary = { mirrored: [], closed: [], open: [] };
  const stillOpen = {};
  for (const [taskId, entry] of Object.entries(state.ledger)) {
    try {
      const issue = await ppFetch(`/issues/${taskId}`);
      const terminal = issue.status === "done" || issue.status === "cancelled";
      const comments = await ppList(
        `/issues/${taskId}/comments${entry.lastMirroredCommentId ? `?after=${encodeURIComponent(entry.lastMirroredCommentId)}&` : "?"}order=asc`,
      );
      let mirroredAny = false;
      let recentContents = null;
      for (const c of comments) {
        const cid = typeof c.id === "string" ? c.id : String(c.id);
        const author = c.authorAgentId == null ? null : String(c.authorAgentId);
        const body = typeof c.body === "string" ? c.body : "";
        // Mirror only replies authored by the assigned agent; every other
        // comment (bookkeeping, reviewers, runs) stays off the Chatwoot thread.
        if (!author || author !== entry.paperclipAgentId || !body.trim()) continue;
        if (entry.mirroredCommentIds.includes(cid)) continue;
        if (!recentContents) recentContents = await recentConversationContents(entry.conversationId);
        const flattened = body.replace(/\s+/g, " ").trim();
        if (recentContents.has(flattened)) {
          entry.mirroredCommentIds.push(cid);
          if (!entry.lastMirroredCommentId) entry.lastMirroredCommentId = cid;
          log("mirror_skipped_same_content", { conversationId: entry.conversationId, commentId: cid });
          continue;
        }
        await mirrorComment({
          conversationId: entry.conversationId,
          taskId,
          commentId: cid,
          text: body.trim(),
        });
        entry.mirroredCommentIds.push(cid);
        entry.mirroredCommentIds = entry.mirroredCommentIds.slice(-64);
        entry.lastMirroredCommentId = cid;
        mirroredAny = true;
        summary.mirrored.push({ conversationId: entry.conversationId, commentId: cid, taskId });
      }
      if (terminal) {
        if (!mirroredAny && !entry.lastMirroredCommentId) {
          // Agent completed without a mirrored written reply: leave an honest
          // closure nod so the thread is not left hanging.
          await mirrorComment({
            conversationId: entry.conversationId,
            taskId,
            commentId: `closure-${issue.status}`,
            text: `(${issue.status}: ${entry.paperclipAgentName ?? "agent"} completed this task without a written reply.)`,
          });
          summary.closed.push({ conversationId: entry.conversationId, taskId, notice: true });
        } else {
          summary.closed.push({ conversationId: entry.conversationId, taskId });
        }
        state.closedLedger[taskId] = { ...entry, status: "closed", closedAt: new Date().toISOString() };
        state.closedLedger[taskId].closedAt = new Date().toISOString();
      } else {
        stillOpen[taskId] = entry;
        summary.open.push({ taskId });
      }
    } catch (err) {
      fail("task_scan_failed", { taskId }, err);
      stillOpen[taskId] = entry; // keep for a later run; never drop tasks on error
    }
  }
  state.ledger = stillOpen;
  return summary;
}

// ----------------------------------------------------------------- main ----

async function main() {
  if (!apiBase || !apiKey || !companyId) {
    fail("missing_env", {}, "PAPERCLIP_API_URL / PAPERCLIP_API_KEY / PAPERCLIP_COMPANY_ID are required");
    return;
  }
  const startedAt = Date.now();
  const { state, revisionId } = await loadState();

  const a = await pumpDirectionA(state);
  const b = await pumpDirectionB(state);

  state.meta.lastRunAt = new Date().toISOString();
  state.meta.lastRunSummary = {
    createdTasks: a.created.length,
    mirroredReplies: b.mirrored.length,
    closedTasks: b.closed.length,
    stillOpen: b.open.length,
    stillOpenComment: b.open,
    durationMs: Date.now() - startedAt,
  };
  const newRevision = await saveState(state, revisionId);

  log("run_complete", {
    createdTasks: a.created.map((x) => `cw${x.conversationId}m${x.messageId}`),
    mirroredReplies: b.mirrored.map((x) => `cw${x.conversationId}c${x.commentId}`),
    closedTasks: b.closed,
    stillOpen: b.open.map((o) => o.taskId),
    stateRevision: newRevision,
    durationMs: state.meta.lastRunSummary.durationMs,
  });
}

main().catch((err) => fail("run_failed", {}, err));
