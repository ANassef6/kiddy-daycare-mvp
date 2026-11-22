// Kiddy data layer.
//
// Runs against real Postgres (Supabase) when KIDDY_DATABASE_URL is a Postgres
// URL (see supabase/migrations/0001_init.sql for the schema), and falls back to
// a local SQLite mirror for zero-infra development when the var is a `file:`
// path or unset. All query helpers are async so pages/actions don't care which
// engine is behind them.

import { dbRequestStore } from "./db-request";
import { connectWithRetry, describePgError } from "./pg-retry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const DATABASE_URL = process.env.KIDDY_DATABASE_URL;

// KID-2452: on Cloudflare Workers a raw `pg` connection to the Supabase
// Supavisor pooler fails its TLS handshake (the Workers runtime validates the
// pooler's private CA and cannot skip it). Hyperdrive terminates that TLS
// inside Cloudflare and hands the Worker a ready connection string, so prefer
// its binding whenever it exists. Node (Vercel/local) keeps using
// KIDDY_DATABASE_URL unchanged.
function isCloudflareWorkers(): boolean {
  // Same probe node-postgres uses: only true inside the Workers runtime. This
  // keeps `next dev` / Vercel on KIDDY_DATABASE_URL (SQLite or the pooler).
  return typeof navigator === "object" && navigator !== null && navigator.userAgent === "Cloudflare-Workers";
}

function hyperdriveUrl(): string | undefined {
  if (!isCloudflareWorkers()) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext() as
      | { env?: { HYPERDRIVE?: { connectionString?: string } } }
      | undefined;
    return ctx?.env?.HYPERDRIVE?.connectionString;
  } catch {
    return undefined;
  }
}

function runtimeDatabase(): { url: string | undefined; hyperdrive: boolean } {
  const hyperdrive = hyperdriveUrl();
  if (hyperdrive) return { url: hyperdrive, hyperdrive: true };
  return { url: DATABASE_URL, hyperdrive: false };
}

export function isPostgresMode(): boolean {
  const { url } = runtimeDatabase();
  return !!url && !url.startsWith("file:");
}

// ---------------------------------------------------------------------------
// Postgres (Supabase)
// ---------------------------------------------------------------------------
type PgDatabase = { url: string | undefined; hyperdrive: boolean };

function createPool(database: PgDatabase, max: number): import("pg").Pool {
  const { Pool } = require("pg") as typeof import("pg");
  const { url, hyperdrive } = database;
  if (!url) throw new Error("No database URL configured (HYPERDRIVE binding or KIDDY_DATABASE_URL).");
  // Strip the query string (sslmode=require is treated as verify-full by newer
  // pg). Direct Supabase pooler connections set TLS explicitly; Hyperdrive
  // already terminates TLS, and adding `ssl` to its connection string breaks
  // the handshake. Do not infer this from the connection string: the runtime
  // Hyperdrive host is not guaranteed to contain "hyperdrive", so the binding
  // we actually resolved above is the only reliable signal.
  return new Pool({
    connectionString: url.split("?")[0],
    ...(hyperdrive ? {} : { ssl: { rejectUnauthorized: false } }),
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 15000,
  });
}

// Node only (Vercel/local). Workers never reuse a pool across requests; see
// withPgClient() below.
let _nodePool: import("pg").Pool | null = null;

function nodePool(): import("pg").Pool {
  if (!_nodePool) _nodePool = createPool(runtimeDatabase(), 5);
  return _nodePool;
}

type PgClient = import("pg").PoolClient;

// KID-2452: a Workers invocation can fail to open the edge connection to
// Hyperdrive under load. Retry only the connect (never the query): a connect
// failure means no SQL ran, so a retry cannot replay a write.
async function acquireClient(pool: import("pg").Pool): Promise<PgClient> {
  return connectWithRetry(pool, {
    attempts: 3,
    baseDelayMs: 100,
    onFailure: (error, attempt, willRetry) => {
      console.error(
        JSON.stringify({
          fmt: "KID-2452 db connect failed",
          attempt,
          willRetry,
          error: describePgError(error),
        })
      );
    },
  });
}

async function runOnPool<T>(
  pool: import("pg").Pool,
  run: (client: PgClient) => Promise<T>
): Promise<T> {
  const client = await acquireClient(pool);
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

async function withPgClient<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
  // The Workers entry opens exactly one pool per request and stores it here.
  // Sockets cannot cross request contexts, so this path is the only one used
  // on Workers in the normal case.
  const requestPool = dbRequestStore.getStore()?.pool;
  if (requestPool) return runOnPool(requestPool, run);

  if (isCloudflareWorkers()) {
    // No request store (for example a callback that escaped the request's
    // async context). Never fall back to a module-level pool on Workers: that
    // is the cross-request socket reuse this data layer must not do. Use a
    // single short-lived pool for this call instead.
    const pool = createPool(runtimeDatabase(), 1);
    try {
      return await runOnPool(pool, run);
    } finally {
      await pool.end().catch((error) => {
        console.error(
          JSON.stringify({ fmt: "KID-2452 db pool close failed", error: describePgError(error) })
        );
      });
    }
  }

  return runOnPool(nodePool(), run);
}

// Converts `?` positional placeholders (SQLite style) to `$1..$n` for pg.
function render(sql: string, args: unknown[]): { text: string; values: unknown[] } {
  let out = "";
  let n = 0;
  for (const ch of sql) {
    if (ch === "?") {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return { text: out, values: args };
}

async function pgAll(sql: string, args: unknown[]): Promise<Row[]> {
  return withPgClient(async (client) => {
    const r = await client.query(render(sql, args));
    return r.rows as Row[];
  });
}

async function pgRun(sql: string, args: unknown[]): Promise<{ rowCount: number }> {
  return withPgClient(async (client) => {
    const r = await client.query(render(sql, args));
    return { rowCount: r.rowCount ?? 0 };
  });
}

// Applies a multi-statement SQL script (used for the migration file).
//
// Splits on `;` only outside string literals, quoted identifiers, line/block
// comments, and dollar-quoted bodies (DO $$ ... $$). A naive split shreds
// both `;` inside `--` comments (KID-115: migration 0016's header produced a
// fragment starting with "this" -> 42601 on every ensureSchema call) and the
// semicolons inside DO blocks (orphaned `END IF` fragments).
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  let lineComment = false;
  let blockComment = false;
  let singleQuote = false;
  let doubleQuote = false;
  let dollarTag: string | null = null;

  const startsDollarTag = (): string | null => {
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
    return m ? m[0] : null;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1] ?? "";

    if (lineComment) {
      current += ch;
      if (ch === "\n") lineComment = false;
      i++;
      continue;
    }
    if (blockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i += 2;
        blockComment = false;
      } else {
        i++;
      }
      continue;
    }
    if (singleQuote) {
      current += ch;
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i += 2;
        } else {
          singleQuote = false;
          i++;
        }
      } else {
        i++;
      }
      continue;
    }
    if (doubleQuote) {
      current += ch;
      if (ch === '"') doubleQuote = false;
      i++;
      continue;
    }
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += ch;
        i++;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      lineComment = true;
      current += ch + next;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      current += ch + next;
      i += 2;
      continue;
    }
    if (ch === "'") {
      singleQuote = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      doubleQuote = true;
      current += ch;
      i++;
      continue;
    }
    const tag = ch === "$" ? startsDollarTag() : null;
    if (tag) {
      dollarTag = tag;
      current += tag;
      i += tag.length;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const tail = current.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

// ---------------------------------------------------------------------------
// SQLite (local fallback)
// ---------------------------------------------------------------------------
let _sqlite: import("better-sqlite3").Database | null = null;

function getSqlite(): import("better-sqlite3").Database {
  if (_sqlite) return _sqlite;
  const path = require("path") as typeof import("path");
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");

  const DATA_DIR = path.join(process.cwd(), "data");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const dbPath = DATABASE_URL?.replace("file:", "") ?? path.join(DATA_DIR, "kiddy.db");

  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = DELETE");
  _sqlite.pragma("synchronous = NORMAL");
  _sqlite.pragma("foreign_keys = ON");
  return _sqlite;
}

async function sqliteAll(sql: string, args: unknown[]): Promise<Row[]> {
  return getSqlite().prepare(sql).all(...args) as Row[];
}

async function sqliteRun(sql: string, args: unknown[]): Promise<{ rowCount: number }> {
  const info = getSqlite().prepare(sql).run(...args);
  return { rowCount: info.changes };
}

// ---------------------------------------------------------------------------
// Shared async query API
// ---------------------------------------------------------------------------
export async function queryAll(sql: string, ...args: unknown[]): Promise<Row[]> {
  // KID-472: timing logs are opt-in (KIDDY_PERF_LOG=1); with the flag unset
  // this is a straight passthrough with no extra work.
  if (process.env.KIDDY_PERF_LOG !== "1") {
    return isPostgresMode() ? pgAll(sql, args) : sqliteAll(sql, args);
  }
  const started = Date.now();
  try {
    return await (isPostgresMode() ? pgAll(sql, args) : sqliteAll(sql, args));
  } finally {
    console.log(`[sql] ${Math.trunc(sql.length)}b sql="${sql.slice(0, 90).replace(/\n/g, " ")}" ms=${Date.now() - started}`);
  }
}

export async function queryGet(sql: string, ...args: unknown[]): Promise<Row | undefined> {
  const rows = await queryAll(sql, ...args);
  return rows[0];
}

export async function queryRun(sql: string, ...args: unknown[]): Promise<{ rowCount: number }> {
  return isPostgresMode() ? pgRun(sql, args) : sqliteRun(sql, args);
}

// Applies the Kiddy schema. Postgres mode reads supabase/migrations; SQLite
// mode keeps its inline migration so local dev stays self-contained.
//
// Postgres mode keeps a schema_migrations ledger so migrations run exactly once
// per file and warm requests skip the full pass (one cheap ledger read), which
// keeps the public marketing pages fast under the serverless free tier.
export async function ensureSchema(): Promise<void> {
  if (isPostgresMode()) {
    await ensurePgSchema();
    return;
  }
  // SQLite fallback: identical table definitions, SQLite dialect.
  const { sqliteSchema } = await import("./sqlite-schema");
  sqliteSchema(getSqlite());
}

let _pgMigrated: Set<string> | null = null;

async function ensurePgSchema(): Promise<void> {
  if (_pgMigrated) return; // already applied in this process — warm fast-path
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const migrationDir = path.join(process.cwd(), "supabase", "migrations");
  if (!fs.existsSync(migrationDir)) return;

  // One client for the whole pass: the ledger read and every statement that
  // follows must see a consistent session, and a single connection avoids a
  // burst of sockets on Workers.
  await withPgClient(async (client) => {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        file TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    const res = await client.query("SELECT file FROM schema_migrations");
    const appliedSet = new Set(res.rows.map((r) => String(r.file)));

    const files = fs.readdirSync(migrationDir).filter((f: string) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (appliedSet.has(file)) continue;
      for (const statement of splitStatements(fs.readFileSync(path.join(migrationDir, file), "utf8"))) {
        await client.query(statement);
      }
      await client.query("INSERT INTO schema_migrations (file) VALUES ($1)", [file]);
    }
    _pgMigrated = new Set(files);
  });
}

export function uid(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// KID-125: the app-DB `account.auth_user_id` references `auth.users(id)`. On
// the live project the adopted GoTrue id can be missing/unreadable there
// (auth admin reads 500 with "Database error finding users"), so the account
// INSERT throws a foreign-key violation even though sign-in succeeded.
// Pure helper so registerAction (and unit tests) can match it on both
// engines: pg reports code 23503, better-sqlite3 reports
// "FOREIGN KEY constraint failed".
export function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  if (String(rec.code ?? "") === "23503") return true;
  const message = String(rec.message ?? "");
  return /foreign key constraint failed|violates foreign key constraint/i.test(message);
}

// KID-236: unique-constraint matcher for the single-use grant consumption in
// platform_access_log (uq_platform_access_nonce). pg reports code 23505,
// better-sqlite3 reports "UNIQUE constraint failed". Used to tell a replayed
// grant apart from any other insert failure — a replay is refused quietly,
// anything else is rethrown (never a silent failure).
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  if (String(rec.code ?? "") === "23505") return true;
  return /unique constraint failed|duplicate key value|unique violation/i.test(String(rec.message ?? ""));
}
