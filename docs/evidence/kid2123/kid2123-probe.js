const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3123";

(async () => {
  const browser = await chromium.launch();
  const results = {};

  // --- Scenario A: reduced-motion OFF, below-fold targets hidden pre-scroll ---
  {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      reducedMotion: "no-preference",
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });

    const armed = await page.evaluate(() =>
      document.documentElement.hasAttribute("data-reveal-ready")
    );
    const revealClass = await page.evaluate(
      () => document.querySelectorAll(".reveal-ready").length
    );

    const probe = (label) =>
      page.evaluate((label) => {
        const els = Array.from(document.querySelectorAll("[data-reveal]"));
        const inView = els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top < innerHeight && r.bottom > 0;
        });
        const below = els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= innerHeight;
        });
        const pick = (list) =>
          list.map((el) => {
            const cs = getComputedStyle(el);
            return {
              tag: el.tagName,
              cls: (el.className || "").toString().slice(0, 30),
              opacity: cs.opacity,
              transitionDuration: cs.transitionDuration,
              transform: cs.transform,
              revealed: el.classList.contains("is-revealed"),
            };
          });
        return { label, total: els.length, inViewport: pick(inView), belowFold: pick(below) };
      }, label);

    const before = await probe("before-scroll");
    // scroll to bottom slowly
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
    });
    await page.waitForTimeout(1200);
    const after = await probe("after-scroll");

    // scroll back to top — must NOT re-hide
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    const afterBack = await probe("after-scroll-back-to-top");

    results.en = { armed, revealClassCount: revealClass, before, after, afterBack };
    await page.screenshot({ path: "/tmp/paperclip-run-kid-2123-6418b363-a57-AGNBu3/opencode/kid2123-top.png" });
    await ctx.close();
  }

  // --- Scenario B: reduced-motion REDUCE, everything visible immediately ---
  {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const b = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("[data-reveal]"));
      return {
        armed: document.documentElement.hasAttribute("data-reveal-ready"),
        total: els.length,
        allVisible: els.every((el) => getComputedStyle(el).opacity === "1"),
        anyTransition: els.some((el) => getComputedStyle(el).transitionDuration !== "0s"),
      };
    });
    results.reducedMotion = b;
    await ctx.close();
  }

  // --- Scenario C: for-centers page quick check ---
  {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      reducedMotion: "no-preference",
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/for-centers", { waitUntil: "networkidle" });
    const c = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("[data-reveal]"));
      const below = els.filter((el) => el.getBoundingClientRect().top >= innerHeight);
      return {
        armed: document.documentElement.hasAttribute("data-reveal-ready"),
        total: els.length,
        belowFoldHidden: below.filter((el) => getComputedStyle(el).opacity === "0").length,
        belowFoldTotal: below.length,
      };
    });
    results.forCenters = c;
    await ctx.close();
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
