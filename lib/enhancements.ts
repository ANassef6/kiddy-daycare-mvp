// KID-258 A1 (KID-264): the "Enhancements requests" store — the app-side half
// of the daycare owner's feature-request flow.
//
// The app NEVER talks to Linear itself: there is no app-side Linear token
// (decision locked on KID-258). The owner submits an enhancement_request with
// status 'queued' here, and the KID-258 Linear sync agent (child task A2)
// owns every Linear interaction, writing the outcome back through the
// authenticated write-back route (app/api/enhancements/write-back — contract
// documented in this file's tail and in the route module).
//
// Lifecycle (migration 0029 + lib/sqlite-schema.ts mirror):
//   queued          submitted from the portal, not yet synced
//   linear_created  A2 created the Linear issue (linear_issue_id/url set)
//   synced          Linear write-back applied (priority/estimate/due_date/
//                   expected_delivery); TERMINAL
//   sync_error      the last sync attempt failed; retryable, still OPEN
//
// De-dup (locked answer on KID-258): an identical OPEN title is refused for
// the same daycare (statuses queued/linear_created/sync_error — only 'synced'
// is terminal). The service check gives the friendly message; the partial
// unique index uq_enhancement_request_open_title makes a concurrent-submit
// race impossible at the schema level.

import { isUniqueViolation, queryAll, queryGet, queryRun, uid, type Row } from "./db";

export const ENHANCEMENT_STATUSES = [
  "queued",
  "linear_created",
  "synced",
  "sync_error",
] as const;

export type EnhancementStatus = (typeof ENHANCEMENT_STATUSES)[number];

// The open (non-terminal) statuses the submit de-dup blocks on. 'sync_error'
// is OPEN on purpose: the sync agent will retry it, so a while-an-error
// double-submit must not fork the same request in Linear.
export const OPEN_ENHANCEMENT_STATUSES: EnhancementStatus[] = [
  "queued",
  "linear_created",
  "sync_error",
];

export type EnhancementRequest = {
  id: string;
  instituteId: string;
  title: string;
  description: string;
  status: EnhancementStatus;
  linearIssueId: string;
  linearIssueUrl: string;
  /** Linear priority, applied by the A2 write-back ("" until synced). */
  priority: string;
  /** Linear estimate (points). */
  estimate: number | null;
  /** Linear due date (YYYY-MM-DD), "" until synced. */
  dueDate: string;
  /** The team's expected delivery date (YYYY-MM-DD), "" until synced. */
  expectedDelivery: string;
  /** Failure text carried from the sync agent's last error, "" when none. */
  syncErrorDetail: string;
  /** The daycare's NAME captured at submit time (e.g. "Sunshine"). */
  customerRequest: string;
  requestedByAccountId: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string;
};

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

export function enhancementRequestRowTo(row: Row): EnhancementRequest {
  const status = String(row.status ?? "queued");
  return {
    id: String(row.id ?? ""),
    instituteId: String(row.institute_id ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    status: ((ENHANCEMENT_STATUSES as readonly string[]).includes(status)
      ? status
      : "queued") as EnhancementStatus,
    linearIssueId: String(row.linear_issue_id ?? ""),
    linearIssueUrl: String(row.linear_issue_url ?? ""),
    priority: String(row.priority ?? ""),
    estimate: row.estimate === null || row.estimate === undefined ? null : Number(row.estimate),
    dueDate: String(row.due_date ?? "").slice(0, 10),
    expectedDelivery: String(row.expected_delivery ?? "").slice(0, 10),
    syncErrorDetail: String(row.sync_error_detail ?? ""),
    customerRequest: String(row.customer_request ?? ""),
    requestedByAccountId: String(row.requested_by_account_id ?? ""),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastSyncedAt: iso(row.last_synced_at),
  };
}

/** One daycare's enhancement requests, newest first (the portal list view). */
export async function listEnhancementRequests(
  instituteId: string
): Promise<EnhancementRequest[]> {
  const rows = await queryAll(
    "SELECT * FROM enhancement_request WHERE institute_id = ? ORDER BY created_at DESC, id DESC",
    instituteId
  );
  return rows.map(enhancementRequestRowTo);
}

export async function getEnhancementRequest(
  requestId: string
): Promise<EnhancementRequest | undefined> {
  const row = await queryGet("SELECT * FROM enhancement_request WHERE id = ?", requestId);
  return row ? enhancementRequestRowTo(row) : undefined;
}

/** True when the daycare already has an OPEN (non-terminal) request with the
 *  EXACT same title — the friendly-path half of the A1 submit de-dup. The
 *  title is trimmed/normalized by the caller (createEnhancementRequest). */
export async function hasOpenRequestWithTitle(
  instituteId: string,
  title: string
): Promise<boolean> {
  const row = await queryGet(
    `SELECT id FROM enhancement_request
     WHERE institute_id = ? AND title = ? AND status IN ('queued', 'linear_created', 'sync_error')
     LIMIT 1`,
    instituteId,
    title
  );
  return !!row;
}

/** Submits an enhancement request on a daycare's behalf: status 'queued' and
 *  customer_request = the daycare's NAME (locked answer on KID-258 — the sync
 *  agent pastes it into the Linear issue). There are deliberately NO
 *  priority/estimate/due-date inputs: the Kiddy team sets those in Linear.
 *  Refuses duplicates with 'duplicate-open-title' BEFORE the insert (and the
 *  uq_enhancement_request_open_title index backstops a race). */
export async function createEnhancementRequest(args: {
  instituteId: string;
  title: string;
  description: string;
  requestedByAccountId: string;
  customerRequest: string;
}): Promise<EnhancementRequest> {
  const title = String(args.title ?? "").trim();
  const description = String(args.description ?? "").trim();
  if (!title || !description) throw new Error("enhancement-invalid");
  if (await hasOpenRequestWithTitle(args.instituteId, title)) {
    throw new Error("duplicate-open-title");
  }
  const id = uid();
  try {
    await queryRun(
      `INSERT INTO enhancement_request
         (id, institute_id, title, description, status, requested_by_account_id, customer_request)
       VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      id,
      args.instituteId,
      title,
      description,
      args.requestedByAccountId,
      args.customerRequest
    );
  } catch (err) {
    // The uq_enhancement_request_open_title backstop: a submit that raced
    // between the dedup read and the insert loses cleanly to the older row
    // with the SAME friendly path the pre-insert check takes — never a 500.
    if (isUniqueViolation(err)) throw new Error("duplicate-open-title");
    throw err;
  }
  return {
    id,
    instituteId: args.instituteId,
    title,
    description,
    status: "queued",
    linearIssueId: "",
    linearIssueUrl: "",
    priority: "",
    estimate: null,
    dueDate: "",
    expectedDelivery: "",
    syncErrorDetail: "",
    customerRequest: args.customerRequest,
    requestedByAccountId: args.requestedByAccountId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSyncedAt: "",
  };
}

export type LinearWriteBackPayload = {
  /** Which sync step this write-back reports. */
  kind: "linear_created" | "synced" | "sync_error";
  /** Set with kind='linear_created' (or to correct a wrong id on retry). */
  linearIssueId?: string;
  linearIssueUrl?: string;
  /** Applied (idempotently) with kind='synced'. */
  priority?: string;
  estimate?: number;
  /** ISO dates (YYYY-MM-DD), applied with kind='synced'. */
  dueDate?: string;
  expectedDelivery?: string;
  /** Failure text, used with kind='sync_error'. */
  syncErrorDetail?: string;
};

const LINEAR_FIELDS = ["urgent", "high", "medium", "low"] as const;

export function isLinearPriority(v: unknown): v is (typeof LINEAR_FIELDS)[number] {
  return (LINEAR_FIELDS as readonly string[]).includes(String(v));
}

export function isIsoDate(v: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
}

// ----- sync write-back (for the KID-258 Linear sync agent, child task A2) ---
//
// CONTRACT for A2 — route: POST /api/enhancements/write-back
//   Headers:  Authorization: Bearer <KIDDY_ENHANCEMENTS_SYNC_TOKEN>
//             Content-Type: application/json
//   Body:     { requestId, instituteId, ...payload } — payload is
//             LinearWriteBackPayload above.
//   — `requestId` selects ONE enhancement_request; `instituteId` must match
//     that request's daycare (mismatch -> 403), so a confused or replayed
//     payload can never write across daycares.
//   — `kind='linear_created'` sets linear_issue_id/linear_issue_url and moves
//     queued -> linear_created.
//   — `kind='synced'` applies priority/estimate/dueDate/expectedDelivery and
//     moves linear_created -> synced.
//   — `kind='sync_error'` records the failure text and moves any open status
//     -> sync_error (retryable; queued/linear_created details are kept).
//   Idempotent: replaying the SAME call changes nothing and returns 200; only
//   a genuinely newer state moves the row (regressions -> 409).
//
// Auth: the route compares the bearer token against the
// KIDDY_ENHANCEMENTS_SYNC_TOKEN env var (timing-safe compare). There is no
// default value: unset env means the write-back refuses EVERY caller (fail
// closed), so the surface cannot be stroked open by forgetting a secret. No
// secrets live in source (AGENTS.md).
export async function applyLinearWriteBack(
  requestId: string,
  instituteId: string,
  payload: LinearWriteBackPayload
): Promise<EnhancementRequest> {
  const row = await queryGet("SELECT * FROM enhancement_request WHERE id = ?", requestId);
  if (!row) throw new Error("enhancement-not-found");
  if (instituteId !== String(row.institute_id)) throw new Error("enhancement-tenant-mismatch");

  const current = enhancementRequestRowTo(row);

  // Packet validation fail-fast BEFORE any write.
  if (
    payload.kind !== "linear_created" &&
    payload.kind !== "synced" &&
    payload.kind !== "sync_error"
  ) {
    throw new Error("enhancement-unknown-sync-kind");
  }
  if (payload.priority !== undefined && !isLinearPriority(payload.priority)) {
    throw new Error("enhancement-priority-invalid");
  }
  if (payload.estimate !== undefined && (!Number.isFinite(payload.estimate) || payload.estimate < 0)) {
    throw new Error("enhancement-estimate-invalid");
  }
  if (payload.dueDate !== undefined && !isIsoDate(payload.dueDate)) {
    throw new Error("enhancement-due-date-invalid");
  }
  if (payload.expectedDelivery !== undefined && !isIsoDate(payload.expectedDelivery)) {
    throw new Error("enhancement-expected-delivery-invalid");
  }

  // Idempotency: an exact replay of an already-applied step is a no-op that
  // returns the current record; the caller sees ok + the settled status.
  const sameIssue =
    (payload.linearIssueId ?? "") === current.linearIssueId &&
    (payload.linearIssueUrl ?? "") === current.linearIssueUrl;
  if (payload.kind === "linear_created" && current.status === "linear_created" && sameIssue) {
    return current;
  }
  if (payload.kind === "synced" && current.status === "synced") {
    return current;
  }
  if (
    payload.kind === "sync_error" &&
    current.status === "sync_error" &&
    (payload.syncErrorDetail ?? "") === current.syncErrorDetail
  ) {
    return current;
  }

  const now = new Date().toISOString();
  const syncedAt = now;
  let next = current;

  if (payload.kind === "linear_created") {
    if (current.status === "synced") {
      // Regression: synced is terminal — a late/replayed linear_created with
      // DIFFERENT issue fields is refused, never re-opened.
      throw new Error("enhancement-already-synced");
    }
    const linearIssueId = payload.linearIssueId ?? "";
    const linearIssueUrl = payload.linearIssueUrl ?? "";
    if (!linearIssueId || !linearIssueUrl) throw new Error("enhancement-linear-fields-missing");
    await queryRun(
      `UPDATE enhancement_request
       SET status = 'linear_created', linear_issue_id = ?, linear_issue_url = ?,
           sync_error_detail = NULL, updated_at = ?, last_synced_at = ?
       WHERE id = ? AND institute_id = ?`,
      linearIssueId,
      linearIssueUrl,
      now,
      syncedAt,
      requestId,
      instituteId
    );
    next = {
      ...current,
      status: "linear_created",
      linearIssueId,
      linearIssueUrl,
      syncErrorDetail: "",
      updatedAt: now,
      lastSyncedAt: syncedAt,
    };
  } else if (payload.kind === "synced") {
    if (current.status !== "linear_created") {
      throw new Error("enhancement-not-linear-created");
    }
    const priority = payload.priority ?? current.priority;
    const estimate = payload.estimate ?? (current.estimate === null ? null : current.estimate);
    const dueDate = payload.dueDate ?? current.dueDate;
    const expectedDelivery = payload.expectedDelivery ?? current.expectedDelivery;
    await queryRun(
      `UPDATE enhancement_request
       SET status = 'synced', priority = ?, estimate = ?, due_date = ?, expected_delivery = ?,
           sync_error_detail = NULL, updated_at = ?, last_synced_at = ?
       WHERE id = ? AND institute_id = ?`,
      priority,
      estimate,
      dueDate,
      expectedDelivery,
      now,
      syncedAt,
      requestId,
      instituteId
    );
    next = {
      ...current,
      status: "synced",
      priority,
      estimate,
      dueDate,
      expectedDelivery,
      syncErrorDetail: "",
      updatedAt: now,
      lastSyncedAt: syncedAt,
    };
  } else {
    // sync_error: any open status may move here; the previously-known Linear
    // fields survive (the sync agent will retry, then correct them).
    await queryRun(
      `UPDATE enhancement_request
       SET status = 'sync_error', sync_error_detail = ?, updated_at = ?, last_synced_at = ?
       WHERE id = ? AND institute_id = ?`,
      String(payload.syncErrorDetail ?? ""),
      now,
      syncedAt,
      requestId,
      instituteId
    );
    next = {
      ...current,
      status: "sync_error",
      syncErrorDetail: String(payload.syncErrorDetail ?? ""),
      updatedAt: now,
      lastSyncedAt: syncedAt,
    };
  }
  return next;
}

/** The pending queue the sync agent sweeps: OPEN requests (queued, errored
 *  ones so it can retry them) for one daycare, oldest first. */
export async function listOpenEnhancementRequests(
  instituteId: string
): Promise<EnhancementRequest[]> {
  const rows = await queryAll(
    `SELECT * FROM enhancement_request
     WHERE institute_id = ? AND status IN ('queued', 'linear_created', 'sync_error')
     ORDER BY created_at ASC, id ASC`,
    instituteId
  );
  return rows.map(enhancementRequestRowTo);
}
