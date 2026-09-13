import { defineConfig } from "vitest/config";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tests always run against an isolated local SQLite database (never Postgres)
// so they are deterministic and never touch shared/prod data. Each test
// process gets a fresh file so the module-level DATABASE_URL branch in lib/db
// selects SQLite.
const testDbPath = path.join(os.tmpdir(), `kiddy-qa-${process.pid}.db`);

export default defineConfig({
  resolve: {
    alias: {
      "@": __dirname,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      KIDDY_DATABASE_URL: `file:${testDbPath}`,
      SESSION_SECRET: "test-only-secret-for-qa",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
    fileParallelism: false,
    testTimeout: 20000,
    globalSetup: ["tests/global-setup.ts"],
  },
});