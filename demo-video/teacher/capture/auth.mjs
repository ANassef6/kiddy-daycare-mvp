#!/usr/bin/env node
// Sign in once against the Sunshine demo tenant and persist the teacher
// browser state. Credentials come from the environment and are never written
// to disk, logs, or the repository:
//   KIDDY_TEACHER_EMAIL / KIDDY_TEACHER_PASSWORD
//
// Usage (from demo-video/teacher):
//   node capture/auth.mjs --lang en
//   node capture/auth.mjs --lang ar
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
const statePath = process.env.KIDDY_TEACHER_STATE || resolve(root, ".auth/teacher.json");
const email = process.env.KIDDY_TEACHER_EMAIL;
const password = process.env.KIDDY_TEACHER_PASSWORD;

if (!email || !password) {
  console.error(
    "Missing teacher demo login. Bind KIDDY_TEACHER_EMAIL and KIDDY_TEACHER_PASSWORD from the Paperclip secret before capturing."
  );
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  locale: lang === "ar" ? "ar-EG" : "en-US",
  timezoneId: "Africa/Cairo",
});
const page = await context.newPage();

try {
  await context.addCookies([
    { name: "kiddy_lang", value: lang, domain: new URL(baseUrl).hostname, path: "/" },
  ]);

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.locator("button[type=submit]").first().click(),
  ]);

  if (lang === "ar") {
    await page.goto(`${baseUrl}/portal/account`, { waitUntil: "domcontentloaded" });
    const arabic = page.locator("input[name=locale][value=ar]");
    if (await arabic.count()) {
      await arabic.check();
      const languageForm = page.locator("form").filter({ has: page.locator("input[name=locale]") });
      await Promise.all([
        page.waitForLoadState("networkidle"),
        languageForm.locator("button[type=submit]").first().click(),
      ]);
    }
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  mkdirSync(dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });
  console.log(`Signed in as the demo teacher and saved state to ${statePath} (account language: ${lang}).`);
} catch (err) {
  console.error(`Teacher demo login failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
