// KID-453 portal shell verification: geometry + screenshots in both directions.
//
// Run against any base URL (local build or production):
//   BASE_URL=https://sunshine.kiddyapp.net \
//   CRED_FILE=/path/to/cred.json OUT=/path/to/shots PREFIX=KID-453 \
//   node docs/evidence/kid453/kid453-verify.mjs
//
// CRED_FILE holds {"email": "...", "password": "..."} (mode 600, run-local).
// Credentials never appear in this source, in the report, or in screenshots.
//
// Checks (acceptance criteria of KID-453):
//   RTL @1080x1920 : sidebar 220px on the RIGHT, main 860px on the left,
//                    scrollWidth == clientWidth == 1080, no overflow.
//   RTL @700x1200  : single column (one grid track), sidebar above main,
//                    both full width, no overflow.
//   LTR @1080x1920 : unchanged — sidebar 220px on the LEFT, main 860px.
// Waits are explicit conditions only (waitForSelector / waitForFunction).
import fs from "node:fs";
import path from "node:path";

const PLAYWRIGHT =
  process.env.PLAYWRIGHT_PATH ??
  "/app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const { chromium } = await import(PLAYWRIGHT);

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:4560").replace(/\/$/, "");
const OUT = process.env.OUT ?? process.cwd();
const PREFIX = process.env.PREFIX ?? "KID-453";
const REPORT = process.env.REPORT ?? path.join(OUT, `${PREFIX}-report.json`);
const credPath = process.env.CRED_FILE;
if (!credPath) {
  console.error("CRED_FILE is required (JSON {email,password})");
  process.exit(2);
}
const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.error(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});
page.on("pageerror", (err) => consoleErrors.push(String(err).slice(0, 200)));

async function measure() {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    };
    const shell = document.querySelector(".shell");
    return {
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      grid: shell ? getComputedStyle(shell).gridTemplateColumns : null,
      side: box(document.querySelector("aside.shell-side")),
      main: box(document.querySelector("main.shell-main")),
    };
  });
}

async function setLanguage(locale) {
  await page.goto(`${BASE}/portal/account`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(`input[name="locale"][value="${locale}"]`, { timeout: 30000 });
  await page.check(`input[name="locale"][value="${locale}"]`);
  const form = page.locator(`form:has(input[name="locale"][value="${locale}"])`);
  await form.locator('button[type="submit"]').click();
  // The save action revalidates the layout; wait for the direction to flip.
  await page.waitForFunction(
    (want) => document.documentElement.dir === want,
    locale === "ar" ? "rtl" : "ltr",
    { timeout: 45000 }
  );
}

async function go(pathname) {
  await page.goto(`${BASE}${pathname}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("aside.shell-side", { timeout: 45000 });
  await page.waitForSelector("main.shell-main", { timeout: 45000 });
}

try {
  // ---- sign in -------------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.fill('input[name="email"]', cred.email);
  await page.fill('input[name="password"]', cred.password);
  await Promise.all([
    page.waitForURL((u) => !String(u).includes("/login"), { timeout: 45000 }),
    page.click('button[type="submit"]'),
  ]);
  record("A1-login", !page.url().includes("/login"), page.url());

  // ---- Arabic (RTL) desktop ------------------------------------------------
  await setLanguage("ar");
  record("A2-rtl-dir", (await measure()).dir === "rtl", `dir after save`);

  await page.setViewportSize({ width: 1080, height: 1920 });
  await go("/portal/children");
  let m = await measure();
  record(
    "A3-rtl-children-geometry",
    m.dir === "rtl" &&
      m.side?.w === 220 &&
      m.side?.x === 860 &&
      m.main?.x === 0 &&
      m.main?.w === 860 &&
      m.scrollWidth === 1080 &&
      m.clientWidth === 1080,
    JSON.stringify(m)
  );
  await page.screenshot({
    path: path.join(OUT, `${PREFIX}-01-rtl-children-1080.png`),
    fullPage: false,
  });

  await go("/portal/support");
  m = await measure();
  record(
    "A4-rtl-support-geometry",
    m.dir === "rtl" &&
      m.side?.w === 220 &&
      m.side?.x === 860 &&
      m.main?.x === 0 &&
      m.main?.w === 860 &&
      m.scrollWidth === 1080,
    JSON.stringify(m)
  );
  await page.screenshot({
    path: path.join(OUT, `${PREFIX}-02-rtl-support-1080.png`),
    fullPage: false,
  });

  // ---- Arabic (RTL) phone width (<=720px breakpoint) -----------------------
  await page.setViewportSize({ width: 700, height: 1200 });
  await go("/portal/children");
  m = await measure();
  const singleTrack = m.grid !== null && !m.grid.trim().includes(" ");
  const stacked = m.side !== null && m.main !== null && m.side.y + m.side.h <= m.main.y + 1;
  record(
    "A5-rtl-phone-single-column",
    m.dir === "rtl" &&
      singleTrack &&
      m.side?.w === 700 &&
      m.main?.w === 700 &&
      stacked &&
      m.scrollWidth === 700,
    JSON.stringify(m)
  );
  await page.screenshot({
    path: path.join(OUT, `${PREFIX}-03-rtl-children-700.png`),
    fullPage: false,
  });

  // ---- English (LTR) desktop — must be unchanged ---------------------------
  await setLanguage("en");
  await page.setViewportSize({ width: 1080, height: 1920 });
  await go("/portal/children");
  m = await measure();
  record(
    "A6-ltr-children-geometry",
    m.dir === "ltr" &&
      m.side?.x === 0 &&
      m.side?.w === 220 &&
      m.main?.x === 220 &&
      m.main?.w === 860 &&
      m.scrollWidth === 1080,
    JSON.stringify(m)
  );
  await page.screenshot({
    path: path.join(OUT, `${PREFIX}-04-ltr-children-1080.png`),
    fullPage: false,
  });

  await go("/portal/support");
  m = await measure();
  record(
    "A7-ltr-support-geometry",
    m.dir === "ltr" &&
      m.side?.x === 0 &&
      m.side?.w === 220 &&
      m.main?.x === 220 &&
      m.main?.w === 860 &&
      m.scrollWidth === 1080,
    JSON.stringify(m)
  );
  await page.screenshot({
    path: path.join(OUT, `${PREFIX}-05-ltr-support-1080.png`),
    fullPage: false,
  });
} catch (err) {
  record("Z9-unexpected-error", false, String(err).slice(0, 500));
} finally {
  record(
    "Z1-console-errors",
    consoleErrors.length === 0,
    consoleErrors.length === 0 ? "none" : consoleErrors.join(" | ")
  );
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    REPORT,
    `${JSON.stringify(
      {
        issue: "KID-453",
        baseUrl: BASE,
        runAt: new Date().toISOString(),
        viewportNote: "viewport-only screenshots, DPR 1",
        results,
        consoleErrors,
      },
      null,
      2
    )}\n`
  );
  console.error(
    `\n${failed.length === 0 ? "ALL PASS" : "FAILED"}: ${results.length - failed.length}/${results.length} -> ${REPORT}`
  );
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}
