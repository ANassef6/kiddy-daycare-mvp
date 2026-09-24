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

async function pgExec(sql: string): Promise<void> {
  const pool = getPool();
  for (const statement of splitStatements(sql)) {
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

  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      file TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );
  const res = await pool.query("SELECT file FROM schema_migrations");
  const appliedSet = new Set(res.rows.map((r) => String(r.file)));

  const files = fs.readdirSync(migrationDir).filter((f: string) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    await pgExec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
    await pool.query("INSERT INTO schema_migrations (file) VALUES ($1)", [file]);
  }
  _pgMigrated = new Set(files);
}

export function uid(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}