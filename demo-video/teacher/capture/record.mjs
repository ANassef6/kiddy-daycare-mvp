#!/usr/bin/env node
// Deterministic Playwright capture for the teacher demo video.
//
// One browser context per scene, 1920x1080, the real tenant UI, and the
// account's real locale (LTR English or RTL Arabic). Clips are written as
// WebM and later conformed to 30 fps CFR during assembly.
//
// Usage (from demo-video/teacher):
//   node capture/record.mjs --lang en
//   node capture/record.mjs --lang ar
//   node capture/record.mjs --lang en --only 02-dashboard,12-attendance
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./playwright.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

const lang = arg("lang", "en") === "ar" ? "ar" : "en";
const baseUrl = (arg("base", "https://sunshine.kiddyapp.net")).replace(/\/$/, "");
const only = arg("only").split(",").map((s) => s.trim()).filter(Boolean);
const statePath = process.env.KIDDY_TEACHER_STATE || resolve(root, ".auth/teacher.json");
const planPath = resolve(root, "out/plan", `${lang}.json`);
const clipDir = resolve(root, "out", lang, "clips");

if (!existsSync(planPath)) {
  console.error(`Missing ${planPath}. Run: node capture/build-manifest.mjs`);
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const scenes = plan.scenes.filter((scene) => only.length === 0 || only.includes(scene.id));
if (scenes.length === 0) {
  console.error(`No scenes matched --only ${only.join(",")}.`);
  process.exit(2);
}
const needsAuth = scenes.some((scene) => scene.auth);
if (needsAuth && !existsSync(statePath)) {
  console.error(`Missing ${statePath}. Run: node capture/auth.mjs --lang ${lang}`);
  process.exit(2);
}

const { chromium } = await loadPlaywright();
mkdirSync(clipDir, { recursive: true });

const INIT_SCRIPT = `
  (() => {
    const style = document.createElement('style');
    style.textContent = '*{scroll-behavior:auto!important} textarea, input { caret-color: transparent !important }';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  })();
`;

async function settle(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

// Replace any visible email with a neutral demo address. On by default; set
// MASK_EMAILS=0 only when the demo account uses an already-public fake email.
async function maskEmails(page) {
  if (process.env.MASK_EMAILS === "0") return;
  await page.evaluate(() => {
    const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (re.test(node.nodeValue)) {
        re.lastIndex = 0;
        node.nodeValue = node.nodeValue.replace(re, "teacher@sunshine.demo");
      }
    }
    for (const input of document.querySelectorAll("input")) {
      if (input.value && re.test(input.value)) {
        re.lastIndex = 0;
        input.value = "teacher@sunshine.demo";
      }
    }
  }).catch(() => {});
}

// Keep the first recorded second free of late-loading images/fonts.
async function waitForAssets(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    await Promise.all(
      [...document.images].map((img) =>
        img.complete
          ? null
          : new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            })
      )
    );
  }).catch(() => {});
}

async function runAction(page, action) {
  const timeout = 15_000;
  switch (action.op) {
    case "goto":
      await page.goto(`${baseUrl}${action.path}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      return;
    case "waitFor":
      await page.locator(action.selector).first().waitFor({ state: "visible", timeout });
      return;
    case "wait":
      await page.waitForTimeout(action.ms ?? 500);
      return;
    case "scroll":
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), action.y ?? 0);
      await page.waitForTimeout(450);
      return;
    case "hover":
      await page.locator(action.selector).first().hover({ timeout });
      return;
    case "focus":
      await page.locator(action.selector).first().focus({ timeout });
      return;
    case "click":
      await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), page.locator(action.selector).first().click({ timeout })]);
      await settle(page);
      return;
    case "clickFirstHref": {
      const selector = `a[href^="${action.prefix.replaceAll('"', '\\"')}"]`;
      await Promise.all([
        page.waitForURL((url) => url.pathname.startsWith(action.prefix), { timeout: 20_000 }).catch(() => {}),
        page.locator(selector).first().click({ timeout }),
      ]);
      await settle(page);
      return;
    }
    case "tab":
      await page.locator("[role=tab]").nth(action.index ?? 0).click({ timeout });
      await page.waitForTimeout(500);
      return;
    default:
      throw new Error(`Unknown action op: ${action.op}`);
  }
}

async function recordScene(scene) {
  const start = Date.now();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: lang === "ar" ? "ar-EG" : "en-US",
    timezoneId: "Africa/Cairo",
    reducedMotion: "reduce",
    colorScheme: "light",
    recordVideo: { dir: clipDir, size: { width: 1920, height: 1080 } },
    storageState: scene.auth ? statePath : undefined,
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.addInitScript(INIT_SCRIPT);
  await context.addCookies([
    { name: "kiddy_lang", value: lang, domain: new URL(baseUrl).hostname, path: "/" },
  ]);

  const video = page.video();
  try {
    for (const action of scene.actions ?? []) {
      try {
        await runAction(page, action);
      } catch (err) {
        if (action.optional) {
          console.warn(`  optional action skipped in ${scene.id}: ${action.op} ${err.message.split("\n")[0]}`);
        } else {
          throw err;
        }
      }
    }
    await maskEmails(page);
    await waitForAssets(page);
    const remaining = scene.holdSec * 1000 - (Date.now() - start);
    if (remaining > 0) await page.waitForTimeout(remaining);
  } finally {
    await context.close();
  }
  if (!video) throw new Error(`No video recorded for ${scene.id}`);
  const target = join(clipDir, `${scene.id}.webm`);
  const raw = await video.path().catch(() => null);
  await video.saveAs(target);
  if (raw && raw !== target && existsSync(raw)) unlinkSync(raw);
  await browser.close();
  return { id: scene.id, clip: target.replace(`${root}/`, ""), targetDurationSec: scene.targetDurationSec };
}

const started = new Date().toISOString();
const recorded = [];
for (const scene of scenes) {
  process.stdout.write(`Recording ${scene.id} (${scene.title}) ... `);
  const result = await recordScene(scene);
  recorded.push(result);
  console.log(`ok ${result.targetDurationSec}s`);
}

const manifestPath = join(clipDir, "manifest.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { clips: [] };
const merged = new Map((previous.clips ?? []).map((c) => [c.id, c]));
for (const clip of recorded) merged.set(clip.id, clip);
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      schema: "kiddy.demo-video.capture-manifest.v1",
      language: plan.language,
      dir: plan.dir,
      startedAt: started,
      finishedAt: new Date().toISOString(),
      clips: [...merged.values()],
    },
    null,
    2
  )}\n`
);
console.log(`Wrote ${manifestPath}`);
