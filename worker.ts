// KID-2452: custom Workers entry. It delegates every request to the OpenNext
// worker and adds the cron handler that replaces the Vercel Hobby cron.
//
// The attendance sweep is idempotent (see app/api/attendance/sweep/route.ts),
// but the handler still fails closed so a misconfigured worker can never sweep
// the wrong deployment: it requires NEXT_PUBLIC_SITE_URL and CRON_SECRET.
import { default as handler } from "./.open-next/worker.js";
import { withRequestPool } from "./lib/db-request";

type Env = {
  NEXT_PUBLIC_SITE_URL?: string;
  CRON_SECRET?: string;
  HYPERDRIVE?: { connectionString?: string };
  WORKER_SELF_REFERENCE?: { fetch: (request: Request) => Promise<Response> };
};

// KID-2452: Workers cannot reuse a TCP connection across requests. A pool per
// request (not per isolate) keeps Hyperdrive connections short-lived and
// avoids the cross-request promise/liveness failures a cached module pool
// causes under any real concurrency.
//
// KID-2457: the pool is deliberately NOT ended when `handler.fetch` resolves.
// OpenNext streams the response and keeps rendering after that point; ending
// the pool there rejected the remaining DB queries ("Cannot use a pool after
// calling end on the pool"). Workers/Hyperdrive clean up the invocation's
// connections when the invocation ends, which is where the lifecycle belongs.

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
    withRequestPool(env, () => handler.fetch(request, env, ctx)),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAttendanceSweep(env));
  },
};
