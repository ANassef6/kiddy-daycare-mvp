// KID-453 negative control: the pre-fix override must reproduce the reported bug.
//
// The fix deletes `html[dir="rtl"] .shell { grid-template-columns: 1fr 220px }`.
// This script re-injects exactly that rule into the FIXED build and re-measures
// the same page: if the injected rule reproduces the bug report's numbers
// (sidebar 860px on the right, main 220px, scrollWidth 1144 at 1080px), the
// PASS above proves the harness detects the defect rather than passing vacuously.
//
//   BASE_URL=... CRED_FILE=... OUT=... node kid453-negative-control.mjs
import fs from "node:fs";
import path from "node:path";

const PLAYWRIGHT =
  process.env.PLAYWRIGHT_PATH ??
  "/app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const { chromium } = await import(PLAYWRIGHT);

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:4560").replace(/\/$/, "");
const OUT = process.env.OUT ?? process.cwd();
const cred = JSON.parse(fs.readFileSync(process.env.CRED_FILE, "utf8"));
const REPORT = path.join(OUT, "KID-453-negative-control-report.json");

const OLD_OVERRIDE = 'html[dir="rtl"] .shell { grid-template-columns: 1fr 220px; }';

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.error(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });

async function measure() {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const shell = document.querySelector(".shell");
    return {
      dir: document.documentElement.dir,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      grid: shell ? getComputedStyle(shell).gridTemplateColumns : null,
      side: box(document.querySelector("aside.shell-side")),
      main: box(document.querySelector("main.shell-main")),
    };
  });
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.fill('input[name="email"]', cred.email);
  await page.fill('input[name="password"]', cred.password);
  await Promise.all([
    page.waitForURL((u) => !String(u).includes("/login"), { timeout: 45000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.goto(`${BASE}/portal/account`, { waitUntil: "networkidle", timeout: 45000 });
  await page.check('input[name="locale"][value="ar"]');
  await page
    .locator('form:has(input[name="locale"][value="ar"])')
    .locator('button[type="submit"]')
    .click();
  await page.waitForFunction(() => document.documentElement.dir === "rtl", null, { timeout: 45000 });

  await page.goto(`${BASE}/portal/children`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("aside.shell-side", { timeout: 45000 });
  // Put the deleted KID-57 rule back, exactly as it shipped before the fix.
  await page.addStyleTag({ content: OLD_OVERRIDE });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".shell")).gridTemplateColumns === "860px 220px",
    null,
    { timeout: 15000 }
  );

  const m = await measure();
  record(
    "N1-old-override-reproduces-bug",
    m.side?.x === 220 &&
      m.side?.w === 860 &&
      m.main?.x === 0 &&
      m.main?.w === 220 &&
      m.scrollWidth === 1144,
    JSON.stringify(m)
  );
  await page.screenshot({
    path: path.join(OUT, "KID-453-06-old-override-bug.png"),
    fullPage: false,
  });

  // N2: LTR must be untouched by the same rule — screenshot the fixed page,
  // inject the pre-fix rule into the live document, screenshot again, and
  // compare the raw PNG bytes (same DOM, same data, no reload between shots).
  await page.goto(`${BASE}/portal/account`, { waitUntil: "networkidle", timeout: 45000 });
  await page.check('input[name="locale"][value="en"]');
  await page
    .locator('form:has(input[name="locale"][value="en"])')
    .locator('button[type="submit"]')
    .click();
  await page.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 45000 });

  await page.goto(`${BASE}/portal/children`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("aside.shell-side", { timeout: 45000 });
  const before = await measure();
  const shotFixed = await page.screenshot({ fullPage: false });
  const injected = await page.addStyleTag({ content: OLD_OVERRIDE });
  // Explicit wait condition: the injected sheet is parsed and carries the rule.
  const applied = await injected.evaluate(
    (el) => el.isConnected && el.sheet !== null && el.sheet.cssRules.length > 0
  );
  record("N2a-old-rule-injected", applied === true, `parsed=${applied}`);
  const after = await measure();
  const shotOld = await page.screenshot({ fullPage: false });
  record(
    "N2-ltr-geometry-unchanged",
    JSON.stringify(before) === JSON.stringify(after),
    `fixed=${JSON.stringify(before)} preFix=${JSON.stringify(after)}`
  );
  record(
    "N3-ltr-pixels-identical",
    Buffer.compare(shotFixed, shotOld) === 0,
    `png bytes: fixed=${shotFixed.length} preFix=${shotOld.length}`
  );
} catch (err) {
  record("N9-unexpected-error", false, String(err).slice(0, 500));
} finally {
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    REPORT,
    `${JSON.stringify(
      { issue: "KID-453", kind: "negative-control", baseUrl: BASE, runAt: new Date().toISOString(), results },
      null,
      2
    )}\n`
  );
  console.error(`\n${failed.length === 0 ? "ALL PASS" : "FAILED"}: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}
