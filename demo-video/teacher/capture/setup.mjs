#!/usr/bin/env node
// One-command environment bootstrap for the teacher demo pipeline.
// Ensures the Playwright Chromium browser is downloaded and that a full
// ffmpeg/ffprobe pair resolves (via ffmpeg-static, or a system install).
//
// Usage (from demo-video/teacher):
//   npm run setup        (npm install runs first via the "setup" script)
//   node capture/setup.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFfmpeg } from "./ffmpeg.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const problems = [];

// 1. Playwright module
let playwright;
try {
  playwright = await import("playwright");
} catch {
  problems.push("playwright npm package not installed. Run: npm install");
}

// 2. Chromium browser binary
if (playwright) {
  try {
    const path = playwright.chromium.executablePath();
    if (!existsSync(path)) {
      console.log("Chromium browser missing; downloading (npx playwright install chromium)...");
      const res = spawnSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit", shell: process.platform === "win32" });
      if (res.status !== 0 || !existsSync(path)) {
        problems.push("Chromium download failed. Run: npx playwright install chromium");
      }
    }
    if (existsSync(path)) console.log(`Playwright chromium OK: ${path}`);
  } catch (err) {
    problems.push(`Playwright chromium check failed: ${err.message}`);
  }
}

// 3. ffmpeg + ffprobe
try {
  const { ffmpeg, ffprobe } = resolveFfmpeg();
  console.log(`ffmpeg OK: ${ffmpeg}`);
  console.log(`ffprobe OK: ${ffprobe}`);
} catch (err) {
  problems.push(err.message);
}

if (problems.length > 0) {
  console.error(`\nSetup incomplete:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nEnvironment ready: npm run wavs:en | npm run auth | npm run record:en | npm run assemble:en | npm run check");
