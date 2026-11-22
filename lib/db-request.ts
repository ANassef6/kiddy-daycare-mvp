// KID-2452/KID-2457: per-request database pool for the Cloudflare Workers runtime.
//
// Workers cannot reuse a TCP connection across requests: I/O objects are
// bound to the request that created them, and the runtime drops promises that
// would settle outside it (`handle_cross_request_promise_resolution`). A
// module-level `pg.Pool` therefore leaks connections and fails intermittently
// once several isolates are warm.
//
// The Worker entry creates one pool per fetch invocation and stores it here.
// Node (Vercel/local) never opens a store, so lib/db.ts keeps using its shared
// pool there.
//
// The store lives on `globalThis` under a registered symbol on purpose: the
// Wrangler entry (`worker.ts`) and the OpenNext server bundle
// (`handler.mjs`) are built separately, so a plain module-level singleton
// would exist twice and the entry would set a store the server never reads.
//
// KID-2457: the pool must NOT be ended when the fetch handler resolves.
// OpenNext returns a streaming Response and keeps rendering (and querying)
// after that point; ending the pool there made every query in the remaining
// stream reject with "Cannot use a pool after calling end on the pool" (the
// empty-message variant of the same race on the edge runtime). Hyperdrive
// automatically cleans up Worker-to-Hyperdrive connections when the request
// or invocation ends, so leaving the pool to the runtime is the documented
// and race-free lifecycle.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

export type DbRequestStore = { pool: Pool };

const STORE_KEY = Symbol.for("kiddy.dbRequestStore");

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: AsyncLocalStorage<DbRequestStore>;
};

const globalStore = globalThis as GlobalWithStore;

export const dbRequestStore: AsyncLocalStorage<DbRequestStore> =
  globalStore[STORE_KEY] ?? new AsyncLocalStorage<DbRequestStore>();

globalStore[STORE_KEY] = dbRequestStore;

export type RequestEnv = {
  HYPERDRIVE?: { connectionString?: string };
};

/** One short-lived pool for one Worker invocation. `max` stays at 4 so a
 *  burst of `Promise.all` reads never approaches the Workers concurrent
 *  outbound-connection ceiling. Hyperdrive terminates TLS, so no `ssl` is
 *  passed for its connection string. */
export function createRequestPool(connectionString: string): Pool {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool: PgPool } = require("pg") as typeof import("pg");
  return new PgPool({
    connectionString: connectionString.split("?")[0],
    max: 4,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  });
}

/**
 * Runs `run` with a per-request pool in the async context. The pool is not
 * closed here: the response body and any post-response render work may still
 * use it. The Workers runtime closes the invocation's connections when the
 * invocation ends (see the header comment).
 */
export async function withRequestPool<T>(
  env: RequestEnv,
  run: () => Promise<T>,
  createPool: (connectionString: string) => Pool = createRequestPool
): Promise<T> {
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (!connectionString) return run();
  return dbRequestStore.run({ pool: createPool(connectionString) }, run);
}

/** A connect failure is safe to retry once because no SQL has run yet. Pool
 *  lifecycle errors and configuration errors are not transient. */
export function isRetryableConnectError(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown } | null | undefined)?.message ?? ""
  );
  return !/after calling end|no database url|no per-request database pool/i.test(message);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Acquires a client, retrying the *connection* once. The query itself never
 * runs twice: retries stop as soon as a client is handed back.
 */
export async function acquireClientWithRetry(
  pool: Pick<Pool, "connect">,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<PoolClient> {
  const attempts = options.attempts ?? 2;
  const delayMs = options.delayMs ?? 50;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || !isRetryableConnectError(error)) throw error;
      await sleep(delayMs);
    }
  }
  throw lastError;
}
