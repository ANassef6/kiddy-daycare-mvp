// QA verification of /reset-password's app-side sync (KID-495 row 6 clause):
// exercises syncAppPasswordAfterResetAction with GoTrue mocked at the HTTP boundary.
import http from "node:http";
import fs from "node:fs";

const DB = "/tmp/kid497-reset-verify.db";
for (const s of [DB, DB + "-journal", DB + "-wal", DB + "-shm"]) fs.rmSync(s, { force: true });
process.env.KIDDY_DATABASE_URL = "file:" + DB;
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:39991";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "qa-test-anon-key";
process.env.SESSION_SECRET = "qa-reset-verify-secret";

const GOOD_TOKEN = "qa-valid-reset-token";
const PW_ORIGINAL = "Orig" + Math.random().toString(36).slice(2, 10) + "Aa1!";
const PW_NEW = "Newp" + Math.random().toString(36).slice(2, 10) + "Bb2!";
const GHOST_TOKEN = "qa-ghost-reset-token";
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/auth/v1/user")) {
    const auth = req.headers.authorization || "";
    const email = auth === "Bearer " + GOOD_TOKEN ? "reset.qa@example.test" : auth === "Bearer " + GHOST_TOKEN ? "ghost@example.test" : null;
    if (email) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "mock-user-1", email, aud: "authenticated" }));
    } else {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: 401, msg: "invalid token" }));
    }
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise<void>((r) => server.listen(39991, "127.0.0.1", r));

const { ensureSchema, queryRun, queryGet } = await import("../lib/db");
const { createAccount, verifyPassword } = await import("../lib/auth");
const { syncAppPasswordAfterResetAction } = await import("../lib/actions");

await ensureSchema();
await createAccount({ email: "reset.qa@example.test", password: PW_ORIGINAL, fullName: "Reset QA", role: "parent", emailConfirmed: true });

const results: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  results.push(`${cond ? "PASS" : "FAIL"} — ${name}${detail ? " :: " + detail : ""}`);
};

// 1. wrong token → unverified, password unchanged
let r: any = await syncAppPasswordAfterResetAction("reset.qa@example.test", PW_NEW, "wrong-token");
check("mismatched GoTrue token is refused (unverified)", r.ok === false && r.reason === "unverified", JSON.stringify(r));
let row: any = await queryGet("SELECT password_hash FROM account WHERE email = ?", "reset.qa@example.test");
check("password unchanged after refused sync", verifyPassword(PW_ORIGINAL, row.password_hash) === true);

// 2. email mismatch → unverified
r = await syncAppPasswordAfterResetAction("other@example.test", PW_NEW, GOOD_TOKEN);
check("token/email mismatch is refused", r.ok === false && r.reason === "unverified", JSON.stringify(r));

// 3. missing input
r = await syncAppPasswordAfterResetAction("reset.qa@example.test", PW_NEW, "");
check("missing token is refused", r.ok === false && r.reason === "missing-input", JSON.stringify(r));

// 4. happy path → app hash updated to the new password
r = await syncAppPasswordAfterResetAction("reset.qa@example.test", PW_NEW, GOOD_TOKEN);
check("verified reset sync updates the app-side hash", r.ok === true, JSON.stringify(r));
row = await queryGet("SELECT password_hash, must_change_password FROM account WHERE email = ?", "reset.qa@example.test");
check("new password verifies", verifyPassword(PW_NEW, row.password_hash) === true);
check("old password no longer verifies", verifyPassword(PW_ORIGINAL, row.password_hash) === false);

// 5. unknown account
r = await syncAppPasswordAfterResetAction("ghost@example.test", PW_NEW, GHOST_TOKEN);
check("unknown account is refused", r.ok === false && r.reason === "no-account", JSON.stringify(r));

console.log(results.join("\n"));
server.close();
process.exit(results.some((x) => x.startsWith("FAIL")) ? 1 : 0);
