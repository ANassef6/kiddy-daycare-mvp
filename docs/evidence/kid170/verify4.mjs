import { chromium } from "/paperclip/.npm/_npx/705bc6b22212b352/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import crypto from "node:crypto";

const BASE = "https://kiddy-one.vercel.app";
const EXEC = "/paperclip/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const OUT = "/tmp/paperclip-run-kid-170-03059fe3-804-YL7OD1/opencode";
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail: String(detail).slice(0, 600) });
  console.log(`${pass ? "PASS" : "FAIL"} | ${name} | ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[name="email"]', "parent@example.test");
  await page.fill('input[name="password"]', "kiddy-parent");
  await Promise.all([ page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]') ]);
  record("parent sign-in (KID-151 fixture)", true, new URL(page.url()).pathname);

  // ---------- L1: what /child/messages renders now ----------
  await page.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
  const htmlPlain = await page.content();
  fs.writeFileSync(`${OUT}/l1-plain.html`, htmlPlain);
  const options = await page.$$eval("select[name='recipientId'] option", (els) => els.map((e) => ({ value: e.value, text: e.textContent.trim() })));
  const heroPlain = (await page.locator("h1").allInnerTexts()).slice(0, 3);
  await page.screenshot({ path: `${OUT}/l1-plain.png`, fullPage: true });
  console.log("options:", JSON.stringify(options), "| hero:", JSON.stringify(heroPlain));
  const EXPECTED_IDS = new Set(["e4c3fc5b-c667-4d60-9c53-cf43c11dad3d", "a3eef5ac-03d8-433d-a84c-0b6b104cb2d2"]);
  record("offered recipients are exactly the DB-verified classroom staff (no invented recipient)", options.length === 2 && options.every((o) => EXPECTED_IDS.has(o.value)), `options=${JSON.stringify(options)}`);
  const sendFormCount = await page.locator("form.row input[name='body']").count();
  record("send form IS rendered when classroom staff exist", sendFormCount > 0, `form.count=${await page.locator("form").count()}`);

  // ---------- A2: forged recipientId refuses visibly ----------
  await page.waitForTimeout(4000);
  let fStatus = null, fLocation = null;
  const forgedHandler = (r) => {
    if (r.request().method() === "POST" && r.url().includes("/child/messages")) { if (fStatus === null) { fStatus = r.status(); fLocation = r.headers()["location"]; } }
  };
  page.on("response", forgedHandler);
  const stampF = new Date().toISOString().replace(/[:.]/g, "-");
  await page.fill("form.row input[name='body']", `KID-170 forged probe ${stampF}`);
  await page.evaluate(() => {
    const form = document.querySelector("form.row");
    const h = document.createElement("input");
    h.type = "hidden"; h.name = "recipientId"; h.value = "x";
    form.insertBefore(h, form.querySelector("select[name='recipientId']"));
  });
  await page.locator("form.row button[type='submit']").click();
  try { await page.waitForURL((u) => (u.searchParams.get("error") === "recipient"), { timeout: 60000 }); } catch {}
  page.off("response", forgedHandler);
  await sleep(1200);
  const forgedUrl = page.url();
  console.log("forged POST:", fStatus, fLocation, "->", forgedUrl);
  const errCount = await page.locator("[data-testid='messages-error']").count();
  const errText = errCount > 0 ? await page.locator("[data-testid='messages-error']").innerText() : "";
  await page.screenshot({ path: `${OUT}/l2-forged-refused.png`, fullPage: true });
  const htmlForgedRefused = await page.content();
  fs.writeFileSync(`${OUT}/l2-forged-refused.html`, htmlForgedRefused);
  record("forged send refused → 303 → /child/messages?error=recipient", fStatus === 303 && /error=recipient/.test(forgedUrl), `POST=${fStatus} location=${fLocation} final=${forgedUrl}`);
  record("error notice in DOM names the classroom rule", errCount > 0 && /staff assigned to your child's classroom/.test(errText), `count=${errCount} text=${JSON.stringify(errText)}`);
  record("no forged write stored for recipientId=x", !htmlForgedRefused.includes(`KID-170 forged probe ${stampF}`), `stored=${htmlForgedRefused.includes(`KID-170 forged probe ${stampF}`)}`);

  // ---------- B4: md5 before vs after the failed send ----------
  await page.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
  const htmlPlain2 = await page.content();
  await page.goto(`${BASE}/child/messages?error=recipient`, { waitUntil: "networkidle", timeout: 60000 });
  const htmlErr2 = await page.content();
  await page.screenshot({ path: `${OUT}/l3-error-param.png`, fullPage: true });
  fs.writeFileSync(`${OUT}/l3-error-param.html`, htmlErr2);
  record("md5(plain) != md5(error) — old identical md5 was 452d5b2c…", md5(htmlPlain2) !== md5(htmlErr2), `plain=${md5(htmlPlain2)} error=${md5(htmlErr2)}`);

  // ---------- D: happy path ----------
  await page.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(4000);
  const stampD = new Date().toISOString().replace(/[:.]/g, "-");
  const MSG = `KID-170 happy-path ${stampD}`;
  let dStatus = null, dLocation = null;
  const realHandler = (r) => {
    if (r.request().method() === "POST" && r.url().includes("/child/messages")) { if (dStatus === null) { dStatus = r.status(); dLocation = r.headers()["location"]; } }
  };
  page.on("response", realHandler);
  await page.fill("form.row input[name='body']", MSG);
  await page.locator("form.row button[type='submit']").click();
  try { await page.waitForLoadState("networkidle", { timeout: 60000 }); } catch {}
  page.off("response", realHandler);
  await sleep(1200);
  const realUrl = page.url();
  console.log("real send:", dStatus, dLocation, "->", realUrl);
  await page.goto(`${BASE}/child/messages`, { waitUntil: "networkidle", timeout: 60000 });
  const htmlAfter = await page.content();
  fs.writeFileSync(`${OUT}/l4-after-real-send.html`, htmlAfter);
  await page.screenshot({ path: `${OUT}/l4-after-real-send.png`, fullPage: true });
  record("happy-path send stored and reappears on reload", dStatus === 303 && !/error=recipient/.test(realUrl) && htmlAfter.includes(MSG), `POST=${dStatus} final=${realUrl} visible=${htmlAfter.includes(MSG)}`);

  fs.writeFileSync(`${OUT}/kid170-report.json`, JSON.stringify({ stamp: new Date().toISOString(), results }, null, 2));
  console.log(`\n=== ${results.filter(r=>r.pass).length}/${results.length} passed ===`);
  if (results.some(r=>!r.pass)) console.log("FAILED: " + results.filter(r=>!r.pass).map(r=>r.name).join(" | "));
} finally { await browser.close(); }
