import { queryGet } from "./db";

let initialized = false;
let inFlight: Promise<void> | null = null;

// Ensure the app always has a seeded demo daycare on first load. Applies the
// schema idempotently and seeds demo data when no institute exists yet.
// KID-216: the root layout awaits this, so the first request of every warm
// instance pays exactly one bootstrap pass; later calls are a no-op check.
// Concurrent callers share the single in-flight pass instead of racing.
export async function ensureSeeded(): Promise<void> {
  if (initialized) return;
  if (inFlight) return inFlight;
  const run = (async () => {
    await ensureSchema();
    const row = await queryGet("SELECT COUNT(*) AS c FROM institute");
    if ((row?.c as number) === 0) {
      // lazy require to avoid a db <-> seed module cycle
      const { seedDemo } = await import("./seed");
      await seedDemo();
    }
    // KID-199.4r: production platform-operator bootstrap (PLATFORM_ADMIN_EMAIL
    // allowlist) must run even when the demo daycare is already seeded — that
    // is exactly the production case, where institutes exist. requireEnv
    // keeps the documented demo credentials out of unconfigured deployments.
    try {
      const { ensurePlatformOperator } = await import("./seed");
      await ensurePlatformOperator({ requireEnv: true });
    } catch (err) {
      // Bootstrap must never block the first request.
      console.error("KID-199.4r platform operator bootstrap failed:", err);
    }
    initialized = true;
  })();
  inFlight = run;
  try {
    await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

async function ensureSchema() {
  const { ensureSchema: es } = await import("./db");
  await es();
}
