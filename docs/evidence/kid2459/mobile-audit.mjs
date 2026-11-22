// KID-2459 mobile responsiveness audit.
//
// Measures document-level horizontal overflow at phone widths on every app
// route and records the elements that stick out past the viewport.
//
//   BASE_URL=http://127.0.0.1:4600 OUT=./docs/evidence/kid2459/shots \
//   STAFF_FILE=/tmp/staff.json PARENT_FILE=/tmp/parent.json \
//   node docs/evidence/kid2459/mobile-audit.mjs
import fs from "node:fs";
import path from "node:path";

const PLAYWRIGHT =
  process.env.PLAYWRIGHT_PATH ??
  "/app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const { chromium } = await import(PLAYWRIGHT);

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:4600").replace(/\/$/, "");
const OUT = process.env.OUT ?? path.join(process.cwd(), "docs/evidence/kid2459/shots");
const REPORT = process.env.REPORT ?? path.join(OUT, "mobile-audit.json");
const WIDTHS = (process.env.WIDTHS ?? "360,414").split(",").map(Number);
const LANGS = (process.env.LANGS ?? "en").split(",");
fs.mkdirSync(OUT, { recursive: true });

const STAFF = JSON.parse(fs.readFileSync(process.env.STAFF_FILE, "utf8"));
const PARENT = JSON.parse(fs.readFileSync(process.env.PARENT_FILE, "utf8"));

const CHILD_ID = process.env.CHILD_ID ?? "mwdebwlt-x3kj4i1y";
const STAFF_ID = process.env.STAFF_ID ?? "mwdebwhs-ceahoyg0";
const ROOM_ID = process.env.ROOM_ID ?? "mwdebwgw-lg4y8ihk";
const THREAD_ID = process.env.THREAD_ID ?? "t-kid2459-1";
const TICKET_ID = process.env.TICKET_ID ?? "mwsbobz7-it4tusyp";

const STAFF_ROUTES = [
  "/portal/dashboard",
  "/portal/children",
  `/portal/children/${CHILD_ID}`,
  `/portal/children/${CHILD_ID}/billing`,
  `/portal/children/${CHILD_ID}/development`,
  "/portal/children/development",
  "/portal/messages",
  `/portal/messages?thread=${THREAD_ID}`,
  "/portal/messages?compose=1",
  "/portal/newsfeed",
  "/portal/attendance",
  "/portal/calendar",
  "/portal/rooms",
  `/portal/rooms/${ROOM_ID}`,
  "/portal/staff",
  `/portal/staff/${STAFF_ID}`,
  "/portal/staff/hours",
  "/portal/staff/schedule",
  "/portal/settings",
  "/portal/account",
  "/portal/account-billing",
  "/portal/finance",
  "/portal/events",
  "/portal/learning",
  "/portal/learning/activities",
  "/portal/learning/curriculum",
  "/portal/learning/homework",
  "/portal/report-center",
  "/portal/reports",
  "/portal/surveys",
  "/portal/tags",
  "/portal/forms",
  "/portal/inquiries",
  "/portal/enhancements",
  "/portal/incidents",
  "/portal/consents",
  "/portal/drive",
  "/portal/support",
  `/portal/support/${TICKET_ID}`,
  "/portal/support-inbox",
  "/portal/notifications",
  "/portal/audit",
  "/portal/performance",
  "/portal/supplies",
];

const PARENT_ROUTES = [
  "/child",
  `/child/${CHILD_ID}`,
  "/child/messages",
  `/child/messages?thread=${THREAD_ID}`,
  "/child/newsfeed",
  "/child/notifications",
  "/child/settings",
  "/child/forms",
  "/child/events",
  "/child/learning",
  "/child/consents",
  "/child/incidents",
  "/child/drive",
  "/child/support",
  `/child/support/${TICKET_ID}`,
];

const results = [];
const consoleErrors = [];

function record(entry) {
  results.push(entry);
  if (!entry.ok) {
    console.error(
      `FAIL ${entry.role} ${entry.lang} ${entry.width}px ${entry.path} ` +
        `scrollWidth=${entry.scrollWidth} clientWidth=${entry.clientWidth} ` +
        `offenders=${JSON.stringify(entry.offenders?.slice(0, 4))}`
    );
  } else if (process.env.VERBOSE) {
    console.error(`pass ${entry.role} ${entry.lang} ${entry.width}px ${entry.path}`);
  }
}

async function login(page, cred) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[name="email"]', cred.email);
  await page.fill('input[name="password"]', cred.password);
  await Promise.all([
    page.waitForURL((u) => !String(u).includes("/login"), { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function setLanguage(page, accountPath, locale) {
  await page.goto(`${BASE}${accountPath}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const selector = `input[name="locale"][value="${locale}"]`;
  await page.waitForSelector(selector, { timeout: 30000 });
  await page.check(selector);
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

async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const offenders = [];
    const describe = (el) => {
      const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).slice(0, 3).join(".");
      const id = el.id ? `#${el.id}` : "";
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
    };
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Ignore fixed overlays (chat launcher, toasts) that intentionally float.
      if (style.position === "fixed" && r.width <= vw + 1) continue;
      const overflowRight = r.right - vw;
      const overflowLeft = -r.left;
      if (overflowRight > 1 || overflowLeft > 1) {
        offenders.push({
          el: describe(el),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          overflow: Math.round(Math.max(overflowRight, overflowLeft)),
        });
      }
    }
    offenders.sort((a, b) => b.overflow - a.overflow);
    return {
      dir: de.dir,
      clientWidth: vw,
      scrollWidth: de.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders: offenders.slice(0, 8),
    };
  });
}

async function auditRole(browser, role, cred, allRoutes, accountPath) {
  const filter = process.env.ROUTE_FILTER;
  const routes = filter ? allRoutes.filter((r) => r.includes(filter)) : allRoutes;
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${role}: ${msg.text().slice(0, 200)}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`${role}: ${String(err).slice(0, 200)}`));
  await login(page, cred);

  for (const lang of LANGS) {
    if (lang === "ar") await setLanguage(page, accountPath, "ar");
    else if (lang === "en") await setLanguage(page, accountPath, "en");

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of routes) {
        let status = 0;
        console.error(`check ${role} ${lang} ${width}px ${route}`);
        try {
          const response = await page.goto(`${BASE}${route}`, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          status = response?.status() ?? 0;
          await page.waitForTimeout(1200);
        } catch (err) {
          record({
            role, lang, width, path: route, ok: false, status: 0,
            error: String(err).slice(0, 300), scrollWidth: 0, clientWidth: width,
            offenders: [],
          });
          continue;
        }
        if (status >= 400 || page.url().includes("/login")) {
          record({
            role, lang, width, path: route, ok: true, status, skipped: true,
            scrollWidth: 0, clientWidth: width, offenders: [],
          });
          continue;
        }
        const m = await measure(page);
        const ok = m.scrollWidth <= m.clientWidth + 1;
        if (!ok) {
          const slug = route.replace(/^\//, "").replace(/[/?=&]/g, "_").slice(0, 60);
          await page.screenshot({
            path: path.join(OUT, `${role}-${lang}-${width}-${slug}.png`),
            fullPage: false,
          });
        }
        record({ role, lang, width, path: route, status, ok, ...m });
      }
    }
  }
  await context.close();
}

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ??
    "/paperclip/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ROLES = (process.env.ROLES ?? "staff,parent").split(",");
try {
  if (ROLES.includes("staff")) {
    await auditRole(browser, "staff", STAFF, STAFF_ROUTES, "/portal/account");
  }
  if (ROLES.includes("parent")) {
    await auditRole(browser, "parent", PARENT, PARENT_ROUTES, "/child/settings");
  }
} finally {
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    REPORT,
    `${JSON.stringify(
      {
        issue: "KID-2459",
        baseUrl: BASE,
        runAt: new Date().toISOString(),
        widths: WIDTHS,
        langs: LANGS,
        total: results.length,
        failed: failed.length,
        results,
        consoleErrors,
      },
      null,
      2
    )}\n`
  );
  console.error(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} / ${results.length} checks -> ${REPORT}`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}
