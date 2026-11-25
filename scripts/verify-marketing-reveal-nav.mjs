#!/usr/bin/env node
// KID-2476 regression probe for the five public marketing pages.
//
// Reproduces the founder flow: load the landing page once, then click through
// the header nav without a hard reload. After every client-side navigation it
// asserts that no [data-reveal] section is still transparent inside the
// viewport, and after a scroll-through that every reveal target is opaque.
// It also verifies that prefers-reduced-motion and JavaScript-disabled loads
// stay fully visible.
//
// Usage:
//   BASE_URL=https://kiddy-staging-orcin.vercel.app \
//     node scripts/verify-marketing-reveal-nav.mjs
//   BASE_URL=... SHOT_DIR=/tmp/kid2476-shots \
//     node scripts/verify-marketing-reveal-nav.mjs
//
// Playwright is not a product dependency. The repo's demo-video toolchain
// carries it; set PLAYWRIGHT_MODULE to an explicit entry point if it lives
// elsewhere. The script exits non-zero on the first failing assertion.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../demo-video/teacher/capture/playwright.mjs";

const BASE_URL = process.env.BASE_URL;
const SHOT_DIR = process.env.SHOT_DIR;
const DESKTOP = { width: 1366, height: 900 };

if (!BASE_URL) {
  console.error("BASE_URL is required, for example BASE_URL=https://kiddyapp.net");
  process.exit(2);
}

const PAGE_PATHS = ["/", "/features", "/for-parents", "/for-centers", "/contact"];
const FORWARD = ["/features", "/for-parents", "/for-centers", "/contact", "/"];
const REVERSE = ["/contact", "/for-centers", "/for-parents", "/features", "/"];

if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

function probeFn() {
  const effectiveOpacity = (el) => {
    let opacity = 1;
    let node = el;
    while (node && node.nodeType === 1) {
      opacity *= parseFloat(getComputedStyle(node).opacity);
      node = node.parentElement;
    }
    return opacity;
  };
  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      className: typeof el.className === "string" ? el.className : "",
      text: (el.textContent || "").trim().slice(0, 48),
      opacity: Number(effectiveOpacity(el).toFixed(3)),
      inViewport:
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0,
    };
  };
  const targets = Array.from(document.querySelectorAll("[data-reveal]")).map(describe);
  const hero = document.querySelector(".section-head > .container, .hero");
  return {
    path: window.location.pathname,
    armed: document.documentElement.hasAttribute("data-reveal-ready"),
    revealTargets: targets.length,
    hero: hero ? describe(hero) : null,
    hiddenAnywhere: targets.filter((target) => target.opacity < 0.9),
    hiddenInViewport: targets.filter((target) => target.inViewport && target.opacity < 0.9),
  };
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  await page.waitForTimeout(900);
}

async function clickNav(page, target) {
  const selector =
    target === "/" ? ".site-header .site-brand" : `.site-header a[href="${target}"]`;
  await page.click(selector);
  await page.waitForURL((url) => new URL(url).pathname === target, { timeout: 15000 });
  await page.waitForTimeout(700);
}

function assertStep(step, label) {
  const failures = [];
  if (step.path !== label) failures.push(`path ${step.path} != ${label}`);
  if (!step.hero) failures.push("hero/section-head container missing");
  else if (step.hero.opacity < 0.9) failures.push(`hero opacity ${step.hero.opacity}`);
  for (const hidden of step.hiddenInViewport) {
    failures.push(`in-viewport hidden: ${hidden.className || "?"} opacity ${hidden.opacity}`);
  }
  return failures;
}

async function capture(page, name) {
  if (!SHOT_DIR) return;
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

async function runNavPass(browser, order, direction) {
  const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: "no-preference" });
  const page = await context.newPage();
  const steps = [];
  const failures = [];

  await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const home = await page.evaluate(probeFn);
  steps.push({ from: null, to: "/", immediate: home, afterScroll: null });
  failures.push(...assertStep(home, "/").map((failure) => `load /: ${failure}`));

  let previous = "/";
  for (const target of order) {
    await clickNav(page, target);
    const immediate = await page.evaluate(probeFn);
    failures.push(...assertStep(immediate, target).map((failure) => `${previous} -> ${target}: ${failure}`));
    await scrollThrough(page);
    const afterScroll = await page.evaluate(probeFn);
    for (const hidden of afterScroll.hiddenAnywhere) {
      failures.push(`${previous} -> ${target} after scroll: still hidden ${hidden.className || "?"} opacity ${hidden.opacity}`);
    }
    steps.push({ from: previous, to: target, immediate, afterScroll });
    await capture(page, `${direction}-${target === "/" ? "home" : target.slice(1)}`);
    previous = target;
  }

  await context.close();
  return { direction, steps, failures };
}

async function runReducedMotion(browser) {
  const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce" });
  const page = await context.newPage();
  const results = [];
  const failures = [];
  for (const target of PAGE_PATHS) {
    await page.goto(BASE_URL + target, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const result = await page.evaluate(probeFn);
    results.push(result);
    if (result.armed) failures.push(`reduced motion ${target}: data-reveal-ready was armed`);
    for (const hidden of result.hiddenAnywhere) {
      failures.push(`reduced motion ${target}: hidden ${hidden.className || "?"} opacity ${hidden.opacity}`);
    }
    await capture(page, `reduced-motion-${target === "/" ? "home" : target.slice(1)}`);
  }
  await context.close();
  return { results, failures };
}

async function runNoJs(browser) {
  const context = await browser.newContext({ viewport: DESKTOP, javaScriptEnabled: false });
  const page = await context.newPage();
  const results = [];
  const failures = [];
  for (const target of PAGE_PATHS) {
    await page.goto(BASE_URL + target, { waitUntil: "networkidle" });
    const heading = page.locator(".section-head h1, .hero h1").first();
    const heroVisible = await heading.isVisible();
    const html = await page.content();
    results.push({ path: target, heroVisible, armedInHtml: html.includes("data-reveal-ready") });
    if (!heroVisible) failures.push(`no-JS ${target}: hero heading is not visible`);
    if (html.includes("data-reveal-ready")) failures.push(`no-JS ${target}: HTML already armed`);
    await capture(page, `no-js-${target === "/" ? "home" : target.slice(1)}`);
  }
  await context.close();
  return { results, failures };
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});

try {
  const forward = await runNavPass(browser, FORWARD, "forward");
  const reverse = await runNavPass(browser, REVERSE, "reverse");
  const reducedMotion = await runReducedMotion(browser);
  const noJs = await runNoJs(browser);

  const failures = [...forward.failures, ...reverse.failures, ...reducedMotion.failures, ...noJs.failures];
  const report = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    viewport: DESKTOP,
    pass: failures.length === 0,
    failures,
    forward,
    reverse,
    reducedMotion,
    noJs,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
} finally {
  await browser.close();
}
