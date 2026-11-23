import fs from "node:fs";
const { chromium, devices } = await import("/app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs");
const BASE = "https://kiddy-staging-orcin.vercel.app";
const OUT = "/tmp/paperclip-run-kid-2459-73ed18b7-fd4-JLTmJ3/opencode/shots3";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/paperclip/.cache/ms-playwright/chromium-1148/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const iphone = devices["iPhone 13"];
const results = [];
const rec = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`); };

async function measure(page) {
  return page.evaluate(() => {
    const g = document.querySelector(".messages-layout");
    const list = document.querySelector(".messages-list");
    const thread = document.querySelector(".messages-thread");
    const input = document.querySelector("[data-testid='messages-input']");
    const send = document.querySelector("[data-testid='messages-send']");
    const attach = document.querySelector("[data-testid='messages-attach']");
    const r = (el) => el ? (() => { const b = el.getBoundingClientRect(); return { x:Math.round(b.x), w:Math.round(b.width), h:Math.round(b.height), display:getComputedStyle(el).display }; })() : null;
    return {
      iw: innerWidth, sw: document.documentElement.scrollWidth,
      grid: g ? getComputedStyle(g).gridTemplateColumns : null,
      list: r(list), thread: r(thread), input: r(input), send: r(send), attach: r(attach),
      listVisible: !!list && getComputedStyle(list).display !== "none",
      threadVisible: !!thread && getComputedStyle(thread).display !== "none",
    };
  });
}

const login = async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[name="email"]', "founder.owner@staging.kiddy.test");
  await page.fill('input[name="password"]', "12345678");
  await Promise.all([
    page.waitForURL((u) => !String(u).includes("/login"), { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
};

for (const [w, h, mobile, expectSingle] of [
  [390,844,true,true],[768,1024,true,true],[780,360,true,true],[844,390,true,true],[900,400,true,true],[960,400,true,true],[1024,768,true,false],[1280,900,false,false],
]) {
  const ctx = await browser.newContext({ ...iphone, viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${BASE}/portal/messages`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1000);
  const listState = await measure(page);
  if (expectSingle) {
    rec(`${w}-list-only`, listState.listVisible && !listState.threadVisible && listState.sw <= w + 1, `list=${listState.listVisible} thread=${listState.threadVisible} sw=${listState.sw}`);
  }
  const link = page.locator(".messages-list a[href*='thread=']").first();
  await link.click();
  await page.waitForURL((u) => String(u).includes("thread="), { timeout: 60000 });
  await page.waitForTimeout(1200);
  const d = await measure(page);
  await page.screenshot({ path: `${OUT}/thread-${w}x${h}.png` });
  if (expectSingle) {
    rec(`${w}-thread-open`, d.threadVisible && !d.listVisible && d.sw <= w + 1, `thread=${d.threadVisible} list=${d.listVisible} sw=${d.sw}`);
    rec(`${w}-input-usable`, d.input && d.input.w >= 200, `inputW=${d.input?.w}`);
    rec(`${w}-controls-in-view`, d.input && d.input.x >= 0 && d.input.x + d.input.w <= w + 1 && d.send && d.send.x >= 0 && d.send.x + d.send.w <= w + 1, `inputX=${d.input?.x} inputW=${d.input?.w} sendX=${d.send?.x}`);
  } else {
    rec(`${w}-two-pane`, d.threadVisible && d.listVisible && d.sw <= w + 1, `thread=${d.threadVisible} list=${d.listVisible} grid=${d.grid} inputW=${d.input?.w} sw=${d.sw}`);
    rec(`${w}-desktop-input`, d.input && d.input.w >= 150, `inputW=${d.input?.w}`);
  }
  if (w === 780) {
    const input = page.locator("[data-testid='messages-input']").first();
    await input.fill("KID-2459 tablet repro check");
    await page.locator("[data-testid='messages-send']").first().click();
    await page.waitForTimeout(2500);
    const text = await page.locator(".messages-thread").innerText();
    rec(`780-send`, text.includes("KID-2459 tablet repro check"), `message visible after send`);
    await page.screenshot({ path: `${OUT}/after-send-780.png` });
  }
  await ctx.close();
}
console.log(`\n${results.filter(r=>r.ok).length}/${results.length} passed`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
await browser.close();
