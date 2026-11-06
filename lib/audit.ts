// KID-477: unified audit trail helper.
//
// Every user-visible mutation in lib/actions.ts records exactly one
// audit_event row through recordAuditEvent(). The write is add-only and
// deliberately best-effort FOR THE CALLER: an audit failure is logged loudly
// and never blocks the user action it describes (a failed attendance row would
// be worse than a failed audit row). Nothing here is read for behavior — only
// the admin audit page reads it back.
//
// Storage rules:
// - metadata is bounded, non-sensitive (field names, ids, counts) — never
//   secrets, tokens, or full message/body text.
// - timestamps come from the database (pg now() / SQLite datetime('now')),
//   matching every other table in this schema.
// - request context is captured lazily only inside a real request scope; in
//   tests or other non-request contexts the helper still works.

import { queryAll, queryGet, queryRun, uid } from "@/lib/db";
import type { Row } from "@/lib/db";

export type AuditInput = {
  instituteId?: string | null;
  actorAccountId?: string | null;
  /** Snapshot of the account's display name; resolved from the account when omitted. */
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  /** Bounded, non-sensitive details (ids, field names, counts) — never bodies. */
  metadata?: Record<string, unknown> | null;
};

// Next's request-scope hook used only for optional request context. Imported
// dynamically and guarded so helpers (and tests) can run outside a request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requestMeta(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const referer = headers().get("referer");
    if (!referer) return null;
    return new URL(referer).pathname || null;
  } catch {
    return null;
  }
}

/** Denormalized account display name for the snapshot columns. */
export async function actorNameFor(accountId: string | null | undefined): Promise<string | null> {
  if (!accountId) return null;
  try {
    const row = await queryGet("SELECT full_name FROM account WHERE id = ?", accountId);
    return row ? String(row.full_name ?? "") || null : null;
  } catch {
    return null;
  }
}

export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    const actorName =
      input.actorName ??
      (await actorNameFor(input.actorAccountId ?? null));
    const requestPath = await requestMeta();
    await queryRun(
      `INSERT INTO audit_event
        (id, institute_id, actor_account_id, actor_name, action, entity_type, entity_id, summary, metadata, request_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid(),
      input.instituteId ?? null,
      input.actorAccountId ?? null,
      actorName,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.summary ?? "",
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null,
      requestPath
    );
  } catch (err) {
    // Never a silent failure: the user action proceeds, the failure is logged.
    console.error("[audit] recordAuditEvent failed", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type AuditFilters = {
  instituteId: string;
  /** Inclusive YYYY-MM-DD lower bound on created_at. */
  from?: string | null;
  /** Inclusive YYYY-MM-DD upper bound on created_at. */
  to?: string | null;
  actorAccountId?: string | null;
  entityType?: string | null;
  limit?: number;
  offset?: number;
};

function dayEndExclusive(to: string): string {
  // End-of-day inclusive upper bound, written in the same space-separated
  // format SQLite's datetime('now') rows use, so text comparison on the
  // SQLite mirror and timestamptz comparison on Postgres agree: everything
  // inside `to`'s day is kept, everything after is cut.
  return `${to} 23:59:59`;
}

function whereFor(f: AuditFilters): { clauses: string[]; args: unknown[] } {
  const clauses = ["institute_id = ?"];
  const args: unknown[] = [f.instituteId];
  if (f.from) {
    clauses.push("created_at >= ?");
    args.push(f.from);
  }
  if (f.to) {
    clauses.push("created_at < ?");
    args.push(dayEndExclusive(f.to));
  }
  if (f.actorAccountId) {
    clauses.push("actor_account_id = ?");
    args.push(f.actorAccountId);
  }
  if (f.entityType) {
    clauses.push("entity_type = ?");
    args.push(f.entityType);
  }
  return { clauses, args };
}

/** Tenant-scoped, filterable, newest-first page of audit rows. */
export async function listAuditEvents(
  f: AuditFilters
): Promise<{ rows: Row[]; total: number }> {
  const { clauses, args } = whereFor(f);
  const sql = `SELECT * FROM audit_event WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?`;
  const limit = Math.max(1, Math.min(200, f.limit ?? 25));
  const offset = Math.max(0, f.offset ?? 0);
  const rows = await queryAll(sql, ...args, limit, offset);
  const countRows = await queryAll(
    `SELECT COUNT(*) AS n FROM audit_event WHERE ${clauses.join(" AND ")}`,
    ...args
  );
  return { rows, total: Number((countRows[0] as { n?: unknown })?.n ?? 0) };
}

/** Distinct entity types present for the tenant (filter dropdown). */
export async function auditEntityTypes(instituteId: string): Promise<string[]> {
  const rows = await queryAll(
    `SELECT entity_type, COUNT(*) AS n FROM audit_event
     WHERE institute_id = ? GROUP BY entity_type ORDER BY entity_type`,
    instituteId
  );
  return rows.map((r) => String((r as { entity_type: unknown }).entity_type));
}

/** Distinct actors (filter dropdown): latest non-null name per account id. */
export async function auditActors(instituteId: string): Promise<Row[]> {
  const rows = await queryAll(
    `SELECT actor_account_id, MAX(actor_name) AS actor_name
     FROM audit_event
     WHERE institute_id = ? AND actor_account_id IS NOT NULL
     GROUP BY actor_account_id ORDER BY actor_name`,
    instituteId
  );
  return rows;
}

/**
 * KID-477: latest audit rows for one entity — used to render the inline
 * "Created/updated by …" attribution beneath a record.
 */
export async function attributionFor(
  instituteId: string,
  entityType: string,
  entityId: string
): Promise<{ created: Row | undefined; updated: Row | undefined }> {
  const rows = await queryAll(
    `SELECT action, actor_name, summary, created_at FROM audit_event
     WHERE institute_id = ? AND entity_type = ? AND entity_id = ?
     AND action IN ('create', 'update')
     ORDER BY created_at DESC, id DESC LIMIT 10`,
    instituteId,
    entityType,
    entityId
  );
  const firstAction = (action: string) =>
    rows.find((r) => String((r as { action: unknown }).action) === action);
  return { created: firstAction("create"), updated: firstAction("update") };
}
