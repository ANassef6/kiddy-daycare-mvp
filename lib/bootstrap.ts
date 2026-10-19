import { queryGet } from "./db";

let initialized = false;

// Ensure the app always has a seeded demo daycare on first load. Applies the
// schema idempotently and seeds demo data when no institute exists yet.
export async function ensureSeeded(): Promise<void> {
  await ensureSchema();
  if (initialized) return;
  const row = await queryGet("SELECT COUNT(*) AS c FROM institute");
  if ((row?.c as number) === 0) {
    // lazy require to avoid a db <-> seed module cycle
    const { seedDemo } = await import("./seed");
    await seedDemo();
  }
  // KID-199.4r: production platform-operator bootstrap (PLATFORM_ADMIN_EMAIL
  // allowlist) must run even when the demo daycare is already seeded — that
  // is exactly the production case, where institutes exist.
  try {
    const { ensurePlatformOperator } = await import("./seed");
    await ensurePlatformOperator();
  } catch (err) {
    // Bootstrap must never block the first request.
    console.error("KID-199.4r platform operator bootstrap failed:", err);
  }
  initialized = true;
}
async function ensureSchema() {
  const { ensureSchema: es } = await import("./db");
  await es();
}