// KID-237 production verification: operator sign-in at the canonical apex host.
// Credentials are read from a temp file written out-of-band; they never appear
// in this source, the report, or any screenshot.
import { chromium } from "/paperclip/.npm/_npx/705bc6b22212b352/node_modules/playwright-core/index.mjs";
import fs from "node:fs";

const EXEC = "/paperclip/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const OUT = "/tmp/paperclip-run-kid-237-ceedede2-321-Kgsu2Q/shots";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const results = [];
const consoleErrors = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.error(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

const credRaw = fs.readFileSync("/tmp/paperclip-run-kid-237-ceedede2-321-Kgsu2Q/cred-reason.txt", "utf8");
const m = credRaw.match(/set it to (\S+)/i);
const password = m ? m[1] : "";
const emailRaw = fs.readFileSync("/tmp/paperclip-run-kid-237-ceedede2-321-Kgsu2Q/op-email.txt", "utf8").trim();
const emailM = emailRaw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
const email = emailM ? emailM[0] : "";
if (!password || !email) {
  console.error("credentials could not be loaded — aborting");
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: EXEC,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});
page.on("pageerror", (err) => consoleErrors.push(String(err).slice(0, 200)));

try {
  // 1. Canonical login page on the apex host
  await page.goto("https://kiddyapp.net/login", { waitUntil: "networkidle", timeout: 45000 });
  record("L1-apex-login-renders", page.url().startsWith("https://kiddyapp.net/login"), page.url());
  await page.screenshot({ path: `${OUT}/${stamp}-01-login.png`, fullPage: false });

  // 2. Operator sign-in (fields by name attribute; typed values never logged)
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/platform/, { timeout: 45000 }),
    page.click('button[type="submit"]'),
  ]);
  // Give the /platform server component a moment to render after nav
  await page.waitForSelector("h1", { timeout: 30000 });
  const landed = page.url();
  const u = new URL(landed);
  record("L2-lands-on-platform", u.host === "kiddyapp.net" && u.pathname === "/platform", landed);

  // 3. Full operator surface renders on the same host
  const h1 = (await page.textContent("h1"))?.trim() ?? "";
  const bodyText = (await page.textContent("body")) ?? "";
  const hasTable = (await page.locator("table").count()) > 0;
  const hasDaycareRows = bodyText.includes("Sunshine Daycare");
  record(
    "L3-operator-surface",
    hasTable && h1.length > 0,
    `h1="${h1}" table=${hasTable} sunshineRow=${hasDaycareRows}`
  );
  record(
    "L4-host-consistency",
    u.host === "kiddyapp.net",
    `operator surface served on ${u.host}`
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${stamp}-02-platform.png`, fullPage: true });

  // 4. Operator full-page surface: an operator-only control exists (create-daycare form heading)
  const createTitle = bodyText.includes("Create a new daycare");
  record("L5-create-daycare-form", createTitle, `create-daycare heading present=${createTitle}`);

  // 5. Cross-check: the daycare open links now derive from the apex
  const openLinks = await page.$$eval('a[target="_blank"]', (as) =>
    as.map((a) => a.href).filter((h) => h.includes("kiddyapp.net")).slice(0, 5)
  );
  record(
    "L6-open-links-apex",
    openLinks.length > 0 && openLinks.every((h) => /^https:\/\/[a-z0-9-]+\.kiddyapp\.net\/?$/.test(h)),
    JSON.stringify(openLinks)
  );

  // 6. Legacy host still functional (login renders, no hard fail)
  const page2 = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const resp = await page2.goto("https://kiddy-one.vercel.app/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  record("L7-legacy-host-alive", !!resp && resp.status() === 200, `status=${resp?.status()} url=${page2.url()}`);
  await page2.close();
} catch (err) {
  record("ERROR", false, String(err).slice(0, 300));
  await page.screenshot({ path: `${OUT}/${stamp}-error.png`, fullPage: true }).catch(() => {});
} finally {
  const report = {
    stamp,
    url: page.url(),
    results,
    consoleErrors: consoleErrors.slice(0, 10),
  };
  fs.writeFileSync(`${OUT}/${stamp}-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  // exit non-zero if any check failed
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
