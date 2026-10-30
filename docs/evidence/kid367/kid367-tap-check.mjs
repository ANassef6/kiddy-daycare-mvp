// KID-367 (DEF-006) live verification harness.
// Emulates the audit's scenario: load /child on a host that stalls the
// /child/<id> RSC responses (in-flight prefetch on master), tap a child card
// inside the in-flight window, and record when the URL changes and when the
// aria-busy skeleton shows. Run twice: baseline (pre-fix) and fix build.
import { chromium } from "playwright";

const args = process.argv.slice(2);const get = (k, d) => (args.find((a) => a.startsWith(k + "=")) ?? (k + "=" + d)).replace(k + "=", "");
const PROXY = get("proxy", "3098");
const HOST = "sunshine-daycare.daycare.test";
const BASE = `http://${HOST}:${PROXY}`;
const LABEL = get("label", "run");
const OUT = get("out", process.env.KID367_OUT || "./out");
import fs from "fs";
fs.mkdirSync(OUT, { recursive: true });

const timeline = { label: LABEL, events: [], measurements: { prefetchesBeforeTap: 0 } };
let tapped = false;
const event = (name, detail) => {
  const t = Date.now() - (timeline.t_ref ?? (timeline.t_ref = Date.now()));
  timeline.events.push({ ms: t, name, detail });
  console.log(`[t+${t}ms] ${name} ${detail ?? ""}`);
};

const browser = await chromium.launch({
  args: ["--no-sandbox", `--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
});
const page = await browser.newPage({ viewport: { width: 320, height: 800 } });

page.on("request", (r) => {
  const u = new URL(r.url());
  const m = u.pathname.match(/^\/child\/([a-z0-9-]+)$/i);
  if (m) {
    const isPrefetch = r.headers()["next-router-prefetch"] === "1";
    event("detail-rsc-start", `path=${u.pathname} prefetch=${isPrefetch ? "1" : "0"} pre-tap=${!tapped}`);
    if (!tapped && isPrefetch) timeline.measurements.prefetchesBeforeTap = (timeline.measurements.prefetchesBeforeTap ?? 0) + 1;
  }
});
page.on("response", (r) => {
  const u = new URL(r.url());
  const m = u.pathname.match(/^\/child\/([a-z0-9-]+)$/i);
  if (m) event("detail-rsc-end", `path=${u.pathname} status=${r.status()}`);
});

// 1. login as the parent (server-action form → wait for the landed page)
await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
await page.fill('input[name="email"]', "parent@example.test");
await page.fill('input[name="password"]', "kiddy-parent");
await page.click('button[type="submit"]');
try {
  await page.waitForURL(/\/child\/?$/, { timeout: 20000 });
} catch (e) {
  await page.screenshot({ path: `${OUT}/login-stuck.png` });
  console.log("login landed on", page.url(), e.message.slice(0, 120));
}
event("login-done", page.url());
await page.goto(`${BASE}/child`, { waitUntil: "load", timeout: 30000 });
await page.waitForSelector("a.card", { timeout: 30000 });
event("child-list-rendered");

// 2. tap inside the in-flight-prefetch window
const card = page.locator("a.card").first();
const cardText = (await card.textContent()).trim().replace(/\s+/g, " ");
event("tapping-card", cardText);
tapped = true;
const tTap = Date.now();
await card.click();

// 3. sample URL-change and skeleton state while the stall holds
const samples = [];
async function sample(atMs) {
  const state = await page.evaluate(() => ({
    url: location.pathname,
    skeleton: document.querySelector('div[aria-busy="true"]') !== null,
    childVisible: document.body.innerText.includes("Nguyen") && location.pathname !== "/child" && location.pathname.split("/").length > 2,
  }));
  samples.push({ atMs, ...state, urlChanged: state.url.replace(/\/$/, "") !== "/child" });
  return { ...state, urlChanged: state.url.replace(/\/$/, "") !== "/child" };
}
const steps = [200, 400, 600, 1000, 2000, 3000, 5000, 7500, 8500, 10000, 13000, 16000];
for (const at of steps) {
  const sinceTap = Date.now() - tTap;
  if (at > sinceTap) await new Promise((r) => setTimeout(r, at - sinceTap));
  const s = await sample(Date.now() - tTap);
  if (!timeline.measurements.tUrlChange && s.urlChanged)
    timeline.measurements.tUrlChange = Date.now() - tTap;
  if (!timeline.measurements.tSkeleton && s.skeleton)
    timeline.measurements.tSkeleton = Date.now() - tTap;
  // mid-window screenshots: either the skeleton showing after the tap (fix)
  // or the stalled silent screen (defect) — whatever state the tap produced.
  if (!timeline.measurements.tChildRendered && !timeline.midCaptured) {
    timeline.midCaptured = true;
    if (s.skeleton || !s.urlChanged) {
      await page.screenshot({ path: `${OUT}/mid-window-${Math.max(Math.round(Date.now() - tTap), 1)}ms-${LABEL}.png` });
      event("mid-window-screenshot");
    }
  }
  if (s.childVisible) {
    timeline.measurements.tChildRendered = Date.now() - tTap;
    break;
  }
}
// if relevant, cap samples at child-render time
timeline.samples = samples.filter((s, i, arr) => i === 0 || arr[i - 1].atMs <= (timeline.measurements.tChildRendered ?? Infinity));

// 4. warm path: after the detail page rendered, go back and tap again — the
// KID-254 baseline is URL + skeleton at ~265ms; the fix must not regress.
try {
await page.goto(`${BASE}/child`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("a.card", { timeout: 30000 });
  const cards = page.locator("a.card");
  const n = await cards.count();
  const warmCard = page.locator("a.card").nth(Math.min(n - 1, 1));
  const warmText = (await warmCard.textContent()).trim().replace(/\s+/g, " ");
  event("warm-tap", warmText);
  const tWarm = Date.now();
  await warmCard.click();
  const warmSamples = [];
  for (let at = 100; at <= 4000; at += 100) {
    const sinceWarm = Date.now() - tWarm;
    if (at > sinceWarm) await new Promise((r) => setTimeout(r, at - sinceWarm));
    const s = await page.evaluate(() => ({
      url: location.pathname,
      skeleton: document.querySelector('div[aria-busy="true"]') !== null,
    }));
    warmSamples.push({ atMs: Date.now() - tWarm, ...s });
    if (!timeline.measurements.warm_tUrlChange && s.url.replace(/\/$/, "") !== "/child")
      timeline.measurements.warm_tUrlChange = Date.now() - tWarm;
    if (!timeline.measurements.warm_tSkeleton && s.skeleton)
      timeline.measurements.warm_tSkeleton = Date.now() - tWarm;
    if (s.url.replace(/\/$/, "") !== "/child") {
      // wait until the detail data renders (cap 5s)
      const settled = await page
        .waitForFunction(
          () => location.pathname !== "/child" && document.body.innerText.length > 200,
          null,
          { timeout: 5000 }
        )
        .catch(() => false);
      if (settled) timeline.measurements.warm_tContent = Date.now() - tWarm;
      break;
    }
  }
  timeline.warmSamples = warmSamples;
  await page.screenshot({ path: `${OUT}/warm-after-tap-${LABEL}.png` });
  event("warm-done", JSON.stringify({
    tUrl: timeline.measurements.warm_tUrlChange,
    tSkeleton: timeline.measurements.warm_tSkeleton,
    tContent: timeline.measurements.warm_tContent,
  }));
} catch (e) {
  event("warm-path-error", String(e.message).slice(0, 200));
}

// 5. screenshots at key moments
await page.screenshot({ path: `${OUT}/after-tap-${LABEL}.png` });
event("screenshot", `${OUT}/after-tap-${LABEL}.png`);

fs.writeFileSync(`${OUT}/timeline-${LABEL}.json`, JSON.stringify(timeline, null, 2));
console.log(JSON.stringify(timeline.measurements, null, 2));
await browser.close();
