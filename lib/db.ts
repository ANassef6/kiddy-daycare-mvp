// Kiddy data layer.
//
// Runs against real Postgres (Supabase) when KIDDY_DATABASE_URL is a Postgres
// URL (see supabase/migrations/0001_init.sql for the schema), and falls back to
// a local SQLite mirror for zero-infra development when the var is a `file:`
// path or unset. All query helpers are async so pages/actions don't care which
// engine is behind them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const DATABASE_URL = process.env.KIDDY_DATABASE_URL;

export function isPostgresMode(): boolean {
  return !!DATABASE_URL && !DATABASE_URL.startsWith("file:");
}

// ---------------------------------------------------------------------------
// Postgres (Supabase)
// ---------------------------------------------------------------------------
let _pool: import("pg").Pool | null = null;

function getPool(): import("pg").Pool {
  if (_pool) return _pool;
  const { Pool } = require("pg") as typeof import("pg");
  // Strip the query string (sslmode=require is treated as verify-full by newer
  // pg) and set Transport-Layer Security explicitly for the Supabase pooler.
  const base = DATABASE_URL!.split("?")[0];
  _pool = new Pool({
    connectionString: base,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  return _pool;
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
  const r = await getPool().query(render(sql, args));
  return r.rows as Row[];
}

async function pgRun(sql: string, args: unknown[]): Promise<{ rowCount: number }> {
  const r = await getPool().query(render(sql, args));
  return { rowCount: r.rowCount ?? 0 };
}

// Applies a multi-statement SQL script (used for the migration file).
async function pgExec(sql: string): Promise<void> {
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const pool = getPool();
  for (const statement of statements) {
    await pool.query(statement);
  }
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
  return isPostgresMode() ? pgAll(sql, args) : sqliteAll(sql, args);
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
export async function ensureSchema(): Promise<void> {
  if (isPostgresMode()) {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const migrationPath = path.join(process.cwd(), "supabase", "migrations", "0001_init.sql");
    if (fs.existsSync(migrationPath)) {
      await pgExec(fs.readFileSync(migrationPath, "utf8"));
    }
    return;
  }
  // SQLite fallback: identical table definitions, SQLite dialect.
  const { sqliteSchema } = await import("./sqlite-schema");
  sqliteSchema(getSqlite());
}

export function uid(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}