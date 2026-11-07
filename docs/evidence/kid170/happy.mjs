import { chromium } from "/paperclip/.npm/_npx/705bc6b22212b352/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const BASE = "https://kiddy-one.vercel.app";
const EXEC = "/paperclip/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const OUT = "/tmp/paperclip-run-kid-170-03059fe3-804-YL7OD1/opencode";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[name="email"]', "parent@example.test");
  await page.fill('input[name="password"]', "kiddy-parent");
  await Promise.all([ page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]') ]);
  console.log("signed in");
  await page.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
  let html = await page.content();
  const prev = ["click-path probe", "KID-170 happy-path"];
  for (const m of prev) console.log(`already-visible "${m}":`, html.includes(m));
  await page.waitForTimeout(4000);
  const stampD = new Date().toISOString().replace(/[:.]/g, "-");
  const MSG = `KID-170 happypath ${stampD}`;
  let respLog = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST") respLog.push(`POST ${r.status()}`);
  });
  await page.fill("form.row input[name='body']", MSG);
  await page.locator("form.row button[type='submit']").click();
  await sleep(6000);
  
  console.log("POST log:", respLog.join(" | "), "| URL:", page.url());
  // full reload via fresh navigation
  await page.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
  html = await page.content();
  fs.writeFileSync(`${OUT}/l4-after-real-send.html`, html);
  await page.screenshot({ path: `${OUT}/l4-after-real-send.png`, fullPage: true });
  console.log("stored message visible on reload:", html.includes(MSG));
  const errCount = await page.locator("[data-testid='messages-error']").count();
  console.log("error notice count:", errCount);
} finally { await browser.close(); }
