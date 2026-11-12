const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3123";

(async () => {
  const browser = await chromium.launch();
  const out = {};

  // CLS + hero + overflow across widths, EN and AR
  for (const lang of ["en", "ar"]) {
    out[lang] = {};
    for (const width of [360, 768, 1280, 1440]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "no-preference",
        extraHTTPHeaders: lang === "ar" ? { Cookie: "kiddy_site_lang=ar" } : {},
      });
      const page = await ctx.newPage();
      const clsValue = await page.evaluate(() => {
        return new Promise((resolve) => {
          let cls = 0;
          try {
            new PerformanceObserver((list) => {
              for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
            }).observe({ type: "layout-shift", buffered: true });
          } catch (e) {}
          setTimeout(() => resolve(cls), 500);
        });
      });
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const cls = await page.evaluate(
        () =>
          new Promise((resolve) => {
            let v = 0;
            new PerformanceObserver((l) => {
              for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value;
            }).observe({ type: "layout-shift", buffered: true });
            setTimeout(() => resolve(v), 800);
          })
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      const hero = await page.evaluate(() => {
        const h = document.querySelector("section, header, .hero, h1");
        const els = Array.from(document.querySelectorAll("[data-reveal]"));
        return {
          heroRevealTags: els.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.top < innerHeight && r.bottom > 0 && el.closest("h1");
          }).length,
          h1Visible: (() => {
            const h1 = document.querySelector("h1");
            if (!h1) return null;
            return getComputedStyle(h1).opacity;
          })(),
        };
      });
      out[lang][width] = { overflowPx: overflow, cls, hero };
      await ctx.close();
    }
  }

  // Hover lift + button press at desktop with hover-capable context
  {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      reducedMotion: "no-preference",
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const hoverInfo = await page.evaluate(() => matchMedia("(hover: hover)").matches);
    const card = page.locator(".audience-panel").first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    const beforeHover = await card.evaluate((el) => getComputedStyle(el).transform);
    await card.hover();
    await page.waitForTimeout(600);
    const afterHover = await card.evaluate((el) => getComputedStyle(el).transform);
    const btn = page.locator(".btn").first();
    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    const btnBefore = await btn.evaluate((el) => getComputedStyle(el).transform);
    const box = await btn.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const btnPressed = await btn.evaluate((el) => getComputedStyle(el).transform);
    await page.mouse.up();
    out.interactions = { hoverCapable: hoverInfo, cardBefore: beforeHover, cardAfter: afterHover, btnRest: btnBefore, btnPressed };
    await ctx.close();
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error("PROBE2 FAILED:", e); process.exit(1); });
