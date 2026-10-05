import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "https://kiddy-one.vercel.app";
const EXEC = "/paperclip/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
const OUT = process.env.OUT_DIR;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const BODY = `KID-173 D2 check ${stamp}`;

const consoleErrors = [];
const badResponses = [];

function attach(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${label}] ${m.text()}`.slice(0, 300));
  });
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(`[${label}] ${r.status()} ${r.url()}`.slice(0, 300));
  });
}

async function login(context, email, password, label) {
  const page = await context.newPage();
  attach(page, label);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }),
    page.click('button[type="submit"]'),
  ]);
  const url = page.url();
  await page.screenshot({ path: `${OUT}/${label}-1-after-login.png`, fullPage: true });
  return { page, url };
}

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const report = { base: BASE, body: BODY, checks: [] };
const record = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} :: ${name} :: ${detail}`);
};

// ---------- parent side ----------
const pctx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
const { page: parent, url: parentUrl } = await login(pctx, "parent@example.test", "kiddy-parent", "parent");
record("P1 parent signs in with the published demo login", !parentUrl.includes("/login"), parentUrl);

await parent.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
await parent.waitForTimeout(1500);
const noStaff = await parent.locator('[data-testid="messages-no-staff"]').count();
const sel = parent.locator('select[name="recipientId"]');
await parent.screenshot({ path: `${OUT}/parent-2-messages.png`, fullPage: true });
const options = noStaff === 0 ? await sel.locator("option").allTextContents() : [];
record(
  "P2 /child/messages renders a recipient control (not the no-staff empty state)",
  noStaff === 0 && options.length > 0,
  `noStaff=${noStaff} options=${JSON.stringify(options)}`
);
const hasMaria = options.some((o) => /maria lopez/i.test(o));
record("P3 Maria Lopez appears as a recipient for this parent", hasMaria, JSON.stringify(options));

async function settle(page) {
  for (let i = 0; i < 30; i++) {
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
}

let sent = false;
if (hasMaria) {
  try {
    await sel.selectOption({ label: "Maria Lopez" });
    await parent.fill('input[name="body"]', BODY);
    await parent.click('button[type="submit"]');
    await parent.waitForURL(/\/child\/messages(\?|$)/, { timeout: 45000 });
    await settle(parent);
    await parent.waitForSelector('[data-testid="messages-error"], .card', { timeout: 30000 });
    const errCount = await parent.locator('[data-testid="messages-error"]').count();
    const errText = errCount ? await parent.locator('[data-testid="messages-error"]').innerText() : "";
    await parent.screenshot({ path: `${OUT}/parent-3-after-send.png`, fullPage: true });
    sent = errCount === 0;
    record("P4 send is accepted (no recipient-refusal banner)", sent, `url=${parent.url()} err=${errText || "none"}`);

    // Fresh page in the same context: cookies persist, and a new page avoids
    // aborting an in-flight redirect from the previous navigation.
    const fresh = await pctx.newPage();
    attach(fresh, "parent-reload");
    await fresh.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
    await fresh.waitForTimeout(2000);
    const stored = (await fresh.locator(`text=${BODY}`).count()) > 0;
    await fresh.screenshot({ path: `${OUT}/parent-4-thread.png`, fullPage: true });
    record(
      "P5 the sent message is stored and visible to the parent after reload",
      stored,
      stored ? `body visible after reload :: ${BODY}` : `body NOT visible after reload :: ${BODY}`
    );
  } catch (e) {
    if (!report.checks.some((c) => c.name.startsWith("P5")))
      record("P5 the sent message is stored and visible to the parent after reload", false, `error: ${String(e).slice(0, 200)}`);
  }
} else {
  record("P4 send is accepted (no recipient-refusal banner)", false, "skipped: Maria Lopez not a recipient");
  record("P5 the sent message is stored and shown in the thread", false, "skipped: Maria Lopez not a recipient");
}

// ---------- staff side ----------
const actx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
const { page: staff, url: staffUrl } = await login(actx, "admin@sunshinedaycare.test", "kiddy-admin", "staff");
record("S1 owner signs in", !staffUrl.includes("/login"), staffUrl);

let received = false;
let portalDetail = "";
try {
  await staff.goto(`${BASE}/portal/messages`, { waitUntil: "networkidle", timeout: 60000 });
  await staff.waitForTimeout(2000);
  await staff.screenshot({ path: `${OUT}/staff-2-messages.png`, fullPage: true });
  const text = await staff.locator("body").innerText();
  received = text.includes(BODY);
  portalDetail = received ? "message body present on /portal/messages" : `body not on /portal/messages (page chars=${text.length})`;
  if (!received) {
    await staff.goto(`${BASE}/portal`, { waitUntil: "networkidle", timeout: 60000 });
    await staff.waitForTimeout(1500);
    const t2 = await staff.locator("body").innerText();
    received = t2.includes(BODY);
    portalDetail += received ? "; found on /portal" : "; not on /portal either";
  }
} catch (e) {
  portalDetail = `error: ${String(e).slice(0, 200)}`;
}
record("S2 the owner receives the parent message", received, portalDetail);

// Maria's staff record must now show the linked login.
let mariaLinked = null;
let stillNoLogin = [];
try {
  await staff.goto(`${BASE}/portal/staff`, { waitUntil: "networkidle", timeout: 60000 });
  await staff.waitForTimeout(2000);
  const t = await staff.locator("body").innerText();
  await staff.screenshot({ path: `${OUT}/staff-3-staff-list.png`, fullPage: true });
  fs.writeFileSync(`${OUT}/staff-list.txt`, t);
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const emails = lines.filter((l) => l.includes("@"));
  mariaLinked = emails.length ? emails.join(" ; ") : `no email rows found; head=${lines.slice(0, 12).join(" | ")}`;
  stillNoLogin = lines.filter((l) => /no login yet/i.test(l));
} catch (e) {
  mariaLinked = `error: ${String(e).slice(0, 160)}`;
}
const mariaOk = typeof mariaLinked === "string" && mariaLinked.includes("admin@sunshinedaycare.test");
record("S3 Maria Lopez's staff row shows the linked login", mariaOk, mariaLinked);
record(
  "S4 staff rows still reading 'No login yet' (informational)",
  stillNoLogin.length === 0,
  stillNoLogin.length ? `${stillNoLogin.length}: ${stillNoLogin.join(" ; ")}` : "none"
);

report.consoleErrors = [...new Set(consoleErrors)].slice(0, 20);
report.badResponses = [...new Set(badResponses)].slice(0, 20);
fs.writeFileSync(`${OUT}/d2-report.json`, JSON.stringify(report, null, 2));
console.log("---console errors---");
console.log(report.consoleErrors.join("\n") || "(none)");
console.log("---non-2xx---");
console.log(report.badResponses.join("\n") || "(none)");

await browser.close();
const failed = report.checks.filter((c) => !c.pass);
console.log(`RESULT: ${report.checks.length - failed.length}/${report.checks.length} checks pass`);
process.exit(failed.length ? 1 : 0);