// KID-1177 (F-02): the Supabase RLS + storage hardening decision, pinned.
//
// Pinned here:
//   1. Migration 0040 — the recorded model: deny-by-default RLS on every app
//      table, the app's owner connection exempt, no FORCE RLS, and exactly
//      one intended anonymous path (the 0003 lead INSERT) kept open. The
//      runtime side of this decision (a non-owner role reads nothing) is
//      exercised end-to-end in supabase/verify-migrations.mjs (SET ROLE anon
//      probes) — this file pins the ledger itself.
//   2. Migration 0041 — the storage decision: kiddy-private exists as the
//      sensitive-class bucket, the anonymous grants and policies on
//      storage.objects are revoked/dropped, one SELECT-only policy on the
//      public bucket survives, and service_role keeps its path.
//   3. The service-role key never leaves server files: a static audit over
//      the whole repo (app/, components/, mobile/ included) fails on any
//      reference outside the server-only allowlist, and no file reachable
//      from a client bundle imports lib/storage.
//   4. lib/storage.ts semantics: the private REF format, the pass-through
//      behaviour for legacy/external URLs, the null handling, and the
//      signed-URL mint for private refs (via the shared helper mock).
//   5. The runtime gates: getStorageAdmin refuses to run unconfigured, and
//      the upload actions gate on storageAdminConfigured (not the anon key).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const M0040 = "supabase/migrations/0040_kid1177_rls_hardening.sql";
const M0041 = "supabase/migrations/0041_kid1177_storage_hardening.sql";

// ---------------------------------------------------------------------------
// 1 + 2. The migrations record the model
// ---------------------------------------------------------------------------
describe("KID-1177: migration 0040 records and implements the RLS model", () => {
  it("the migration file exists and enables RLS on every app table", () => {
    const sql = readFileSync(M0040, "utf8");
    expect(sql.includes("ENABLE ROW LEVEL SECURITY")).toBe(true);
    // The DO block enumerates live tables over the search path — a future
    // table cannot escape the net by simply not being in the file.
    expect(sql).toMatch(/FOR r IN\s+SELECT n\.nspname AS schema_name, c\.relname AS table_name/);
    expect(sql).toMatch(/relkind = 'r'/);
    expect(sql).toMatch(/EXECUTE format\('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r\.table_name\)/);
  });

  it("no FORCE ROW LEVEL SECURITY: the app's owning connection must keep working", () => {
    const sql = readFileSync(M0040, "utf8");
    // Statements must never FORCE — the header prose explaining WHY that is
    // so is the other thing this file demands.
    const stripped = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(stripped).not.toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/deliberately NOT enabled/);
    expect(sql).toMatch(/deny by default/i);
  });

  it("the runtime decision (non-owner denied) is exercised in the verify harness", () => {
    const verify = readFileSync("supabase/verify-migrations.mjs", "utf8");
    expect(verify).toMatch(/SET ROLE anon/i);
    expect(verify).toMatch(/anon cannot read \$\{table\}/);
    expect(verify).toMatch(/anon keeps the intended contact_request INSERT/);
  });

  it("revokes from anon/authenticated (tables + sequences) and stops future auto-grants", () => {
    const sql = readFileSync(M0040, "utf8");
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon, authenticated/);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM anon, authenticated/);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM anon, authenticated/);
  });

  it("keeps the single intended anonymous path: the 0003 lead INSERT", () => {
    const sql = readFileSync(M0040, "utf8");
    expect(sql).toMatch(/GRANT INSERT ON contact_request TO anon, authenticated/);
  });


});

describe("KID-1177: migration 0041 records and implements the storage model", () => {
  it("creates the private bucket and keeps kiddy-public public", () => {
    const sql = readFileSync(M0041, "utf8");
    expect(sql).toMatch(/kiddy-private/);
    expect(sql).toMatch(/'kiddy-private', 'kiddy-private', FALSE/);
    expect(sql).toMatch(/'kiddy-public', 'kiddy-public', TRUE/);
  });

  it("shuts the anonymous write door: revokes + drops AO non-service policies", () => {
    const sql = readFileSync(M0041, "utf8");
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA storage FROM anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON storage\.objects TO anon, authenticated/);
    // Every policy that granted anon/authenticated (or TO public) dies — the
    // custom anonymous FIRST-write policy from QA is covered by this loop.
    expect(sql).toMatch(/roles::text ILIKE '%anon%/);
    expect(sql).toMatch(/roles::text ILIKE '%authenticated%/);
    expect(sql).toMatch(/roles::text ILIKE '%public%/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS %I ON storage\.objects/);
  });

  it("the only remaining non-service policy is the read-only public-bucket one", () => {
    const sql = readFileSync(M0041, "utf8");
    expect(sql).toMatch(/CREATE POLICY kiddy_public_anon_read ON storage\.objects\s+FOR SELECT TO anon, authenticated\s+USING \(bucket_id = 'kiddy-public'\)/);
    // No INSERT/UPDATE/DELETE policy for anon/authenticated afterwards.
    expect(sql).not.toMatch(/CREATE POLICY .+ FOR INSERT TO/);
    expect(sql).not.toMatch(/CREATE POLICY .+ FOR UPDATE/);
    expect(sql).not.toMatch(/CREATE POLICY .+ FOR DELETE/);
  });

  it("service_role keeps its storage path (uploads + signed URLs)", () => {
    const sql = readFileSync(M0041, "utf8");
    expect(sql).toMatch(/CREATE POLICY kiddy_service_all_access ON storage\.objects/);
    expect(sql).toMatch(/FOR ALL TO service_role/);
    expect(sql).toMatch(/GRANT ALL ON storage\.objects TO service_role/);
  });

  it("the verify harness proves the decision at runtime", () => {
    const verify = readFileSync("supabase/verify-migrations.mjs", "utf8");
    expect(verify).toMatch(/the public and private buckets exist with the right public flags/);
    expect(verify).toMatch(/anon cannot write — not even into the public bucket/);
    expect(verify).toMatch(/anon resolves nothing in the private bucket/);
  });
});

// ---------------------------------------------------------------------------
// 3. The service-role key is server-only
// ---------------------------------------------------------------------------
describe("KID-1177: the service-role key audit", () => {
  const SERVER_ALLOWLIST = [
    "lib/storage.ts", // storage writes + signed URLs (this task)
    "lib/invite-email.ts", // pre-existing: GoTrue admin invite
    "lib/contact-notify.ts", // pre-existing: GoTrue admin subscribe
    "lib/invoice-notify.ts", // pre-existing: GoTrue admin invoice mail
    "scripts/migrate-sensitive-objects.ts", // ops runner, never a bundle
    "scripts/regenerate-contract-drafts.ts", // ops runner, never a bundle
  ];
  const SCAN_ROOTS = ["lib", "app", "components", "scripts", "supabase", "mobile"];

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) yield* walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield full;
    }
  }

  it("SUPABASE_SERVICE_ROLE_KEY appears only in the server-only allowlist", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
        const body = readFileSync(file, "utf8");
        if (body.includes("SUPABASE_SERVICE_ROLE_KEY") && !SERVER_ALLOWLIST.includes(file.replace(/\\/g, "/"))) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no CLIENT module imports the service-key storage module", () => {
    // Server components (app pages) resolve refs and are allowed; a "use
    // client" module — the code that actually ships to the browser bundle —
    // must never import lib/storage. Transitive imports are out of reach of
    // a static scan; this pins the direct surface of the bundle growth.
    const offenders: string[] = [];
    for (const root of ["app", "components"]) {
      for (const file of walk(root)) {
        const body = readFileSync(file, "utf8");
        const isClient = /^["']use client["'];?/m.test(body.trimStart());
        if (isClient && /from ["']@\/lib\/storage["']/.test(body)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the runtime upload gate is the service key, not the anon key", () => {
    const actions = readFileSync("lib/actions.ts", "utf8");
    // Settings/branding + photo + both proof uploads + the contract upload.
    expect(actions.match(/storageAdminConfigured\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    // And lib/storage is the only module that consumes the key for storage.
    expect(readFileSync("lib/storage.ts", "utf8")).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

// ---------------------------------------------------------------------------
// 4. lib/storage.ts semantics (real module; only supabase-js stands in)
// ---------------------------------------------------------------------------
// The static import block runs before any env setup could happen, so the
// module is loaded lazily AFTER the dummy env pair is set.
vi.mock("@supabase/supabase-js", async () => {
  const helper = await import("../helpers/kid1177-storage");
  return { createClient: () => helper.kid1177StorageMock.getStorageAdmin() };
});

import { storage1177, PREFIX } from "../helpers/kid1177-storage";

type StorageModule = typeof import("../../lib/storage");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SECRET_FREE_TEST_ENV = { url: "https://storage-unittest.example", key: "dummy-service-key-unittest-placeholder" };
let storage: StorageModule | null = null;
async function storageModule(): Promise<StorageModule> {
  if (!storage) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SECRET_FREE_TEST_ENV.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_FREE_TEST_ENV.key;
    storage = await import("../../lib/storage");
  }
  return storage;
}

describe("KID-1177: the storage REF format + resolution helpers", () => {
  beforeEach(async () => {
    await storageModule();
    storage1177.uploads = [];
    storage1177.removed = [];
    storage1177.count = 0;
    storage1177.uploadError = null;
  });

  it("a private REF round-trips through the format helpers", async () => {
    const s = await storageModule();
    const path = "payments/inst-a/inv-1/proof-123-abc-uuid.png";
    const ref = s.privateRef(path);
    expect(ref).toBe(PREFIX + path);
    expect(s.isPrivateRef(ref)).toBe(true);
    expect(s.isPrivateRef(`https://storage.test/kiddy-public/${path}`)).toBe(false);
    expect(s.isPrivateRef(`kiddy-public:${path}`)).toBe(false);
    expect(s.privateRefPath(ref)).toBe(path);
  });

  it("legacy public / external / data URLs pass through storageSrcFor unchanged", async () => {
    const s = await storageModule();
    expect(await s.storageSrcFor(null)).toBeNull();
    expect(await s.storageSrcFor("")).toBeNull();
    expect(await s.storageSrcFor("https://example.com/pic.png")).toBe("https://example.com/pic.png");
    expect(await s.storageSrcFor("data:image/png;base64,Zm9v")).toBe("data:image/png;base64,Zm9v");
    expect(await s.storageSrcFor("https://storage.test/kiddy-public/branding/i/logo.png")).toBe(
      "https://storage.test/kiddy-public/branding/i/logo.png"
    );
  });

  it("a private ref resolves to a short-lived signed URL — never the raw ref", async () => {
    const s = await storageModule();
    const ref = s.privateRef("payments/inst-a/inv-2/proof-987-def-uuid.png");
    const src = await s.storageSrcFor(ref);
    expect(src).not.toBeNull();
    expect(src).not.toContain("kiddy-private:");
    expect(String(src)).toMatch(
      /^https:\/\/storage\.test\/storage\/v1\/object\/sign\/kiddy-private\/payments\/inst-a\/inv-2\/proof-987-def-uuid\.png\?token=signed-/
    );
  });

  it("batch resolution maps legacy URLs to themselves and signs only private refs", async () => {
    const s = await storageModule();
    storage1177.count = 0;
    const map = await s.signedUrlsForRefs([
      "https://example.com/p.png",
      s.privateRef("child/c-1/photo-1.png"),
      "",
    ]);
    expect(map.get("https://example.com/p.png")).toBe("https://example.com/p.png");
    expect(String(map.get(s.privateRef("child/c-1/photo-1.png")))).toMatch(
      /object\/sign\/kiddy-private\/child\/c-1\/photo-1\.png/
    );
    expect(map.get("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Runtime gates
// ---------------------------------------------------------------------------
describe("KID-1177: the service-key client refuses to run unconfigured", () => {
  const ORIGINAL = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

  afterEach(() => {
    if (ORIGINAL.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL.url;
    if (ORIGINAL.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL.key;
    vi.resetModules();
  });

  it("getStorageAdmin throws a loud, secret-free error when envs are missing", async () => {
    vi.resetModules();
    storage = null; // force a fresh module instance for the unconfigured pair
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fresh = await import("../../lib/storage");
    const out = () => fresh.getStorageAdmin();
    expect(out).toThrow(/SUPABASE_SERVICE_ROLE_KEY/i);
    try {
      out();
    } catch (err) {
      const message = String((err as Error).message);
      // The error names the env var but never prints a value.
      expect(message).not.toMatch(/=\s*\S/);
    }
    expect(fresh.storageAdminConfigured()).toBe(false);
  });

  it("a configured pair reports itself and hands out a client without throwing", async () => {
    vi.resetModules();
    storage = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage-unittest.example";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-key-value-unittest-not-a-secret";
    const fresh = await import("../../lib/storage");
    expect(fresh.storageAdminConfigured()).toBe(true);
    expect(fresh.getStorageAdmin()).toBeDefined();
  });
});
