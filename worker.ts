// KID-2452: custom Workers entry. It delegates every request to the OpenNext
// worker and adds the cron handler that replaces the Vercel Hobby cron.
//
// The attendance sweep is idempotent (see app/api/attendance/sweep/route.ts),
// but the handler still fails closed so a misconfigured worker can never sweep
// the wrong deployment: it requires NEXT_PUBLIC_SITE_URL and CRON_SECRET.
import { Pool } from "pg";
import openNextWorker from "./.open-next/worker.js";
import { dbRequestStore } from "./lib/db-request";

type Env = {
  NEXT_PUBLIC_SITE_URL?: string;
  CRON_SECRET?: string;
  HYPERDRIVE?: { connectionString?: string };
  WORKER_SELF_REFERENCE?: { fetch: (request: Request) => Promise<Response> };
};

// KID-2452: Workers cannot reuse a TCP connection across requests. One
// short-lived pool per request (never per isolate) keeps Hyperdrive connections
// inside the request's I/O context.
//
// `max: 1` is deliberate. A page can issue several queries in parallel, but
// Hyperdrive already pools the origin connections; a single client here queues
// those queries instead of opening up to four sockets per request. The Workers
// runtime allows only six simultaneous open connections per invocation, and
// oversubscribing it was one suspected cause of the intermittent connect
// failures that forced the 2026-11-22 rollback.
//
// Do not call pool.end() in ctx.waitUntil(): the runtime closes the sockets at
// the end of the invocation, while an early end() can race work scheduled for
// after the response (the `after()`/background paths) and turn a healthy
// request into a "pool after end" error.
function requestPool(connectionString: string): Pool {
  return new Pool({
    connectionString: connectionString.split("?")[0],
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 15000,
  });
}

function withRequestPool<T>(env: Env, run: () => Promise<T>): Promise<T> {
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (!connectionString) return run();
  const pool = requestPool(connectionString);
  return dbRequestStore.run({ pool }, run);
}

async function runAttendanceSweep(env: Env): Promise<void> {
  const base = (env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  if (!base || !env.CRON_SECRET) {
    console.error("[cron] attendance sweep skipped: NEXT_PUBLIC_SITE_URL or CRON_SECRET is missing");
    return;
  }
  const request = new Request(`${base}/api/attendance/sweep`, {
    method: "GET",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const target = env.WORKER_SELF_REFERENCE
    ? await env.WORKER_SELF_REFERENCE.fetch(request)
    : await fetch(request);
  if (!target.ok) {
    console.error(`[cron] attendance sweep failed: HTTP ${target.status}`);
    return;
  }
  console.log("[cron] attendance sweep ok", await target.text());
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    withRequestPool(env, () => openNextWorker.fetch(request, env, ctx)),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAttendanceSweep(env));
  },
};
