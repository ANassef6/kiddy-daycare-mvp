// KID-2452: custom Workers entry. It delegates every request to the OpenNext
// worker and adds the cron handler that replaces the Vercel Hobby cron.
//
// The attendance sweep is idempotent (see app/api/attendance/sweep/route.ts),
// but the handler still fails closed so a misconfigured worker can never sweep
// the wrong deployment: it requires NEXT_PUBLIC_SITE_URL and CRON_SECRET.
import openNextWorker from "./.open-next/worker.js";

type Env = {
  NEXT_PUBLIC_SITE_URL?: string;
  CRON_SECRET?: string;
  WORKER_SELF_REFERENCE?: { fetch: (request: Request) => Promise<Response> };
};

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
  fetch: openNextWorker.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAttendanceSweep(env));
  },
};
