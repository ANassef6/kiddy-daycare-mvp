// KID-236 production verification at https://kiddyapp.net (never preview hosts).
// Operator credentials come from a run-local 0600 temp file; they never appear
// in this source, the report, the console, or any screenshot. Screenshots get
// the operator account identifier redacted before upload.
const { chromium } = require("@playwright/test");
const fs = require("fs");

const SHOTS = "/tmp/kid236-prod-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const cred = JSON.parse(fs.readFileSync("/tmp/kid236-prod-cred.json", "utf8"));
const results = [];
const consoleErrors = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.error(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
};
// KID-237 practice: account identifiers never ship in screenshots. Redact in
// the DOM before capture (the operator email in the /platform topbar; any
// real child name that happens to surface in tenant widgets).
const redact = async (page) => {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const txt = t.textContent ?? "";
      if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(txt)) hits.push([t, txt]);
      if (/Leo Nguyen/.test(txt)) t.textContent = txt.replace(/Leo Nguyen/g, "[child name]");
    }
    for (const [t, txt] of hits) t.textContent = txt.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[operator email]");
  });
};

(async () => {
  const browser = await chromium.launch({
    executablePath: "/paperclip/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 160)));
  // The single-use grant URL from the P4 entry hop (replayed in P10).
  let capturedGrantUrl = null;
  page.on("request", (r) => {
    if (r.url().includes("/operator-entry?grant=")) capturedGrantUrl = r.url();
  });

  // P1. Apex login renders
  await page.goto("https://kiddyapp.net/login", { waitUntil: "networkidle", timeout: 60000 });
  record("P1-apex-login", page.url().startsWith("https://kiddyapp.net/login"), page.url());

  // P2. Operator sign-in lands on https://kiddyapp.net/platform
  await page.fill('input[name="email"]', cred.email);
  await page.fill('input[name="password"]', cred.password);
  await Promise.all([
    page.waitForURL("**/platform", { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle");
  const u = new URL(page.url());
  record("P2-lands-on-platform", u.host === "kiddyapp.net" && u.pathname === "/platform", page.url());

  // P3. /platform rows: Open daycare link + Enter as admin button per daycare
  await page.waitForSelector("table", { timeout: 30000 });
  const sunshineRow = page.locator("tr", { hasText: "Sunshine Daycare" });
  const mapleRow = page.locator("tr", { hasText: "Maple" }).first();
  const sunOpen = await sunshineRow.locator('a:has-text("Open daycare")').count();
  const sunEnter = await sunshineRow.locator('button:has-text("Enter as admin")').count();
  const mapleOpen = await mapleRow.locator('a:has-text("Open daycare")').count();
  const mapleEnter = await mapleRow.locator('button:has-text("Enter as admin")').count();
  record(
    "P3-row-actions-two-meanings",
    sunOpen === 1 && sunEnter === 1 && mapleOpen === 1 && mapleEnter === 1,
    `sunshine open=${sunOpen} enter=${sunEnter}; maple open=${mapleOpen} enter=${mapleEnter}`
  );
  await redact(page);
  await page.screenshot({ path: `${SHOTS}/P3-platform-rows.png`, fullPage: true });

  // P4. Enter as admin on Sunshine -> that daycare's portal with the banner
  await sunshineRow.locator('button:has-text("Enter as admin")').click();
  await page.waitForURL("**/portal/dashboard", { timeout: 60000 });
  await page.waitForLoadState("networkidle");
  const inUrl = new URL(page.url());
  const isSunshineHost = inUrl.host === "sunshine.kiddyapp.net";
  const banner = page.locator('[data-testid="operator-view-banner"]');
  const bannerText = ((await banner.textContent()) ?? "").replace(/\s+/g, " ").trim();
  const hasExit = await banner.locator('button:has-text("Exit")').count();
  record(
    "P4-enter-lands-in-tenant-portal",
    isSunshineHost && inUrl.pathname === "/portal/dashboard",
    page.url()
  );
  record(
    "P5-banner-with-exit",
    /Viewing .* as platform operator/i.test(bannerText) && hasExit === 1,
    `banner="${bannerText}" exit=${hasExit}`
  );
  await redact(page);
  await page.screenshot({ path: `${SHOTS}/P4-tenant-portal-banner.png`, fullPage: true });

  // P6. Cross-tenant: the same view on the second daycare's host is refused
  await page.goto("https://maple-grove-daycare-2.kiddyapp.net/portal/dashboard", { waitUntil: "networkidle", timeout: 60000 });
  const cu = new URL(page.url());
  const refused =
    cu.host === "maple-grove-daycare-2.kiddyapp.net" &&
    (cu.pathname === "/login" || cu.pathname.startsWith("/login"));
  record(
    "P6-cross-tenant-refused",
    refused,
    `landed at ${page.url()} (no tenant data, no signed-in state)`
  );
  await redact(page);
  await page.screenshot({ path: `${SHOTS}/P6-cross-tenant-refused.png`, fullPage: true });

  // P7. Exit clears ONLY the view cookie and returns to https://kiddyapp.net/platform
  await page.goto("https://sunshine.kiddyapp.net/portal/dashboard", { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('[data-testid="operator-view-banner"] button:has-text("Exit")').click();
  await page.waitForURL("**/platform", { timeout: 60000 });
  await page.waitForLoadState("networkidle");
  const exUrl = new URL(page.url());
  record(
    "P7-exit-returns-to-platform",
    exUrl.host === "kiddyapp.net" && exUrl.pathname === "/platform",
    page.url()
  );
  await redact(page);
  await page.screenshot({ path: `${SHOTS}/P7-back-on-platform.png`, fullPage: true });

  // P8. After exit the tenant host is anonymous again (cookie really cleared)
  await page.goto("https://sunshine.kiddyapp.net/portal/dashboard", { waitUntil: "networkidle", timeout: 60000 });
  const afterExit = new URL(page.url());
  record(
    "P8-view-cookie-cleared",
    afterExit.pathname === "/login",
    `tenant portal now at ${page.url()}`
  );

  // P9. Disabled daycare refuses at the platform page. Production's Maple
  // Grove Daycare is already Disabled — its row is used as-is, with NO state
  // mutation. The mint action must refuse before any grant exists.
  await page.goto("https://kiddyapp.net/platform", { waitUntil: "networkidle", timeout: 60000 });
  const mapleRow2 = page.locator("tr", { hasText: "Maple" }).first();
  const mapleDisabled = (await mapleRow2.locator('button:has-text("Enable")').count()) === 1;
  await mapleRow2.locator('button:has-text("Enter as admin")').click();
  await page.waitForURL("**/platform?error=enter-disabled", { timeout: 60000 });
  await page.waitForLoadState("networkidle");
  const errText = ((await page.locator(".banner-error").first().textContent()) ?? "").trim();
  record(
    "P9-disabled-row-refused",
    mapleDisabled && page.url().includes("error=enter-disabled") && errText.length > 0,
    `${page.url()} (row already disabled; no toggle used) message="${errText}"`
  );
  await redact(page);
  await page.screenshot({ path: `${SHOTS}/P9-disabled-refused.png`, fullPage: true });

  // P10. Replay refusal: a spent grant URL replayed on its own host is refused
  // (grant captured during P4 by the entry request; see capturedGrantUrl)
  if (capturedGrantUrl) {
    await page.goto(capturedGrantUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const rp = new URL(page.url());
    record(
      "P10-replay-refused",
      rp.pathname === "/login" && rp.searchParams.get("error") === "operator-entry-invalid",
      `replay lands at ${page.url()}`
    );
    await redact(page);
  await page.screenshot({ path: `${SHOTS}/P10-replay-refused.png`, fullPage: true });
  } else {
    record("P10-replay-refused", false, "no grant URL captured during P4");
  }

  const report = {
    stamp: new Date().toISOString(),
    head: "4f543d8",
    deploy: "dpl_e8PAsCkK",
    url: "https://kiddyapp.net/platform",
    results,
    consoleErrors,
  };
  fs.writeFileSync(`${SHOTS}/kid236-report.json`, JSON.stringify(report, null, 2));
  console.error("console errors:", consoleErrors.length ? consoleErrors : "none");
  await browser.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
