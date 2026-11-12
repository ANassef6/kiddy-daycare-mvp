const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3123";
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const out = {};
  for (const path of ["/", "/features", "/for-parents", "/for-centers", "/contact", "/privacy"]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += innerHeight * 0.8) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); }
    });
    await page.waitForTimeout(1000);
    out[path] = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("[data-reveal]"));
      const hidden = els.filter(el => parseFloat(getComputedStyle(el).opacity) < 0.9);
      return { total: els.length, stillHidden: hidden.length, hiddenInfo: hidden.map(el => el.className + "|" + getComputedStyle(el).opacity) };
    });
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error("FAIL", e); process.exit(1); });
