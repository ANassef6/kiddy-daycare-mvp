// KID-2452: per-request database pool for the Cloudflare Workers runtime.
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
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";

export type DbRequestStore = { pool: Pool };

const STORE_KEY = Symbol.for("kiddy.dbRequestStore");

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: AsyncLocalStorage<DbRequestStore>;
};

const globalStore = globalThis as GlobalWithStore;

export const dbRequestStore: AsyncLocalStorage<DbRequestStore> =
  globalStore[STORE_KEY] ?? new AsyncLocalStorage<DbRequestStore>();

globalStore[STORE_KEY] = dbRequestStore;
