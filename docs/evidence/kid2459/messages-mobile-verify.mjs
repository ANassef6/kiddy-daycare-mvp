// KID-2459: staff Messages phone layout, end to end.
//
//   BASE_URL=http://127.0.0.1:4600 CRED_FILE=/tmp/staff.json OUT=/tmp/shots \
//   node docs/evidence/kid2459/messages-mobile-verify.mjs
//
// Checks at 360x800 and 414x800 (and the desktop control at 1280x900):
//   list -> thread -> back, composer, attach/send reachable, no page overflow.
import fs from "node:fs";
import path from "node:path";

const PLAYWRIGHT =
  process.env.PLAYWRIGHT_PATH ??
  "/app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const { chromium } = await import(PLAYWRIGHT);
const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:4600").replace(/\/$/, "");
const OUT = process.env.OUT ?? path.join(process.cwd(), "docs/evidence/kid2459/shots");
const REPORT = process.env.REPORT ?? path.join(OUT, "messages-mobile.json");
const cred = JSON.parse(fs.readFileSync(process.env.CRED_FILE, "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.error(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
};

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ??
    "/paperclip/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[name="email"]', cred.email);
  await page.fill('input[name="password"]', cred.password);
  await Promise.all([
    page.waitForURL((u) => !String(u).includes("/login"), { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function setLanguage(page, locale) {
  await page.goto(`${BASE}/portal/account`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.check(`input[name="locale"][value="${locale}"]`);
  const form = page.locator(`form:has(input[name="locale"][value="${locale}"])`);
  await Promise.all([
    page.waitForNavigation({ timeout: 60000 }).catch(() => {}),
    form.locator('button[type="submit"]').click(),
  ]);
  await page.waitForFunction(
    (want) => document.documentElement.dir === want,
    locale === "ar" ? "rtl" : "ltr",
    { timeout: 60000 }
  );
}

const visible = (page, sel) => page.locator(sel).first().isVisible();
const box = async (page, sel) => {
  const el = page.locator(sel).first();
  if (!(await el.count())) return null;
  return el.boundingBox();
};
const inViewport = (b, vw) => !!b && b.x >= -1 && b.x + b.width <= vw + 1;

async function runViewport(page, width, lang) {
  const tag = `${lang}-${width}`;
  await page.setViewportSize({ width, height: 800 });

  await page.goto(`${BASE}/portal/messages`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  let sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const listVisible = await visible(page, ".messages-list");
  const threadHidden = !(await visible(page, ".messages-thread"));
  await page.screenshot({ path: path.join(OUT, `KID-2459-messages-${tag}-1-list.png`) });
  record(`${tag}-list-visible`, listVisible && threadHidden, `list=${listVisible} threadHidden=${threadHidden} sw=${sw}`);

  // Open the first thread row.
  await page.locator(".messages-list a[href*='thread=']").first().click();
  await page.waitForURL((u) => String(u).includes("thread="), { timeout: 60000 });
  await page.waitForTimeout(1000);
  sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const threadVisible = await visible(page, ".messages-thread");
  const listGone = !(await visible(page, ".messages-list"));
  const back = await box(page, ".messages-thread .messages-back");
  const attach = await box(page, "[data-testid='messages-attach']");
  const send = await box(page, "[data-testid='messages-send']");
  const input = await box(page, "[data-testid='messages-input']");
  await page.screenshot({ path: path.join(OUT, `KID-2459-messages-${tag}-2-thread.png`) });
  record(
    `${tag}-thread-open`,
    threadVisible && listGone && sw <= width + 1,
    `thread=${threadVisible} listGone=${listGone} sw=${sw}`
  );
  record(
    `${tag}-thread-controls`,
    inViewport(back, width) && inViewport(attach, width) && inViewport(send, width) && inViewport(input, width),
    `back=${JSON.stringify(back)} attach=${JSON.stringify(attach)} send=${JSON.stringify(send)} input=${JSON.stringify(input)}`
  );

  // Back to the list.
  await page.locator(".messages-thread .messages-back").click();
  await page.waitForTimeout(900);
  const listBack = await visible(page, ".messages-list");
  const threadGone = !(await visible(page, ".messages-thread"));
  record(`${tag}-back-to-list`, listBack && threadGone, `list=${listBack} threadGone=${threadGone}`);

  // Composer route.
  await page.goto(`${BASE}/portal/messages?compose=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1000);
  sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const composeVisible = await visible(page, ".messages-thread");
  const composeListGone = !(await visible(page, ".messages-list"));
  const composeSend = await box(page, "button[type='submit'].btn-primary");
  await page.screenshot({ path: path.join(OUT, `KID-2459-messages-${tag}-3-compose.png`) });
  record(
    `${tag}-composer`,
    composeVisible && composeListGone && sw <= width + 1 && inViewport(composeSend, width),
    `composer=${composeVisible} listGone=${composeListGone} sw=${sw} send=${JSON.stringify(composeSend)}`
  );

  // The open 1:1 conversation also replaces the list.
  await page.goto(`${BASE}/portal/messages`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(800);
  const direct = page.locator(".messages-list a[href*='with=']").first();
  if (await direct.count()) {
    await direct.click();
    await page.waitForURL((u) => String(u).includes("with="), { timeout: 60000 });
    await page.waitForTimeout(900);
    const directVisible = await visible(page, ".messages-thread");
    const directListGone = !(await visible(page, ".messages-list"));
    record(`${tag}-direct-open`, directVisible && directListGone, `thread=${directVisible} listGone=${directListGone}`);
  } else {
    record(`${tag}-direct-open`, true, "no 1:1 conversation row seeded (skipped)");
  }
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await login(page);
  for (const lang of ["en", "ar"]) {
    await setLanguage(page, lang);
    for (const width of [360, 414]) await runViewport(page, width, lang);
  }

  // Desktop control: two panes, list and thread/composer both visible.
  await setLanguage(page, "en");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/portal/messages`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);
  const listVisible = await visible(page, ".messages-list");
  const threadVisible = await visible(page, ".messages-thread");
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".messages-layout")).gridTemplateColumns);
  await page.screenshot({ path: path.join(OUT, "KID-2459-messages-desktop-1280.png") });
  record("desktop-two-pane", listVisible && threadVisible && cols.split(" ").length === 2, `list=${listVisible} thread=${threadVisible} cols=${cols}`);
  await context.close();
} finally {
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    REPORT,
    `${JSON.stringify({ issue: "KID-2459", baseUrl: BASE, runAt: new Date().toISOString(), results }, null, 2)}\n`
  );
  console.error(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} / ${results.length} -> ${REPORT}`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}
