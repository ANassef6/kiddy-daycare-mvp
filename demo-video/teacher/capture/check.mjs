#!/usr/bin/env node
// Self-check for a finished or in-progress teacher demo.
// Verifies format, scene coverage, captions, timestamps, and the no-secret
// rule. RTL and content judgement stay on the manual checklist in README.md.
//
// Usage (from demo-video/teacher):
//   node capture/check.mjs                 # reports pending assets, exit 0
//   node capture/check.mjs --require-final # exit 1 unless both videos pass
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFfmpeg } from "./ffmpeg.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const scenesDoc = JSON.parse(readFileSync(resolve(root, "scenes.teacher.json"), "utf8"));
const requireFinal = process.argv.includes("--require-final");

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".auth" || name === "wav" || name === "out") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function probe(ffprobe, file) {
  const raw = execFileSync(
    ffprobe,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate -show_entries format=duration -of", "json", file],
    { encoding: "utf8" }
  );
  const data = JSON.parse(raw);
  const stream = data.streams?.[0] ?? {};
  const [num, den] = String(stream.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: den ? num / den : 0,
    duration: Number(data.format?.duration),
  };
}

function countCues(srt) {
  return (srt.match(/^\d+$/gm) ?? []).length;
}

const results = [];
for (const lang of ["en", "ar"]) {
  const dir = resolve(root, "out", lang);
  const mp4 = join(dir, `teacher-${lang}-1080p.mp4`);
  const srt = join(dir, `teacher-${lang}.srt`);
  const timestamps = join(dir, "scene-timestamps.csv");
  const assembly = join(dir, "assembly.json");
  const item = { language: lang, checks: [] };
  const add = (name, ok, detail) => item.checks.push({ name, ok, detail });

  add("mp4 exists", existsSync(mp4), mp4.replace(`${root}/`, ""));
  add("srt exists", existsSync(srt), srt.replace(`${root}/`, ""));
  add("scene timestamps exist", existsSync(timestamps), timestamps.replace(`${root}/`, ""));
  add("assembly manifest exists", existsSync(assembly), assembly.replace(`${root}/`, ""));

  let expected = scenesDoc.scenes.length;
  if (existsSync(assembly)) {
    try {
      const { ffprobe } = resolveFfmpeg();
      const a = JSON.parse(readFileSync(assembly, "utf8"));
      add("all scenes assembled", a.scenes?.length === expected, `${a.scenes?.length ?? 0}/${expected}`);
      add("all voiceover present", (a.missingVoiceover ?? []).length === 0, (a.missingVoiceover ?? []).join(", ") || "none missing");
      add("scene count in timestamps", readFileSync(timestamps, "utf8").trim().split(/\r?\n/).length - 1 === expected, "header + one row per scene");
      add("srt cue count", countCues(readFileSync(srt, "utf8")) === expected, `${countCues(readFileSync(srt, "utf8"))}/${expected}`);
      if (existsSync(mp4)) {
        const info = probe(ffprobe, mp4);
        add("video is 1920x1080", info.width === 1920 && info.height === 1080, `${info.width}x${info.height}`);
        add("video is 30 fps", Math.abs(info.fps - 30) < 0.05, `${info.fps.toFixed(3)} fps`);
        add("duration matches manifest", Math.abs(info.duration - Number(a.durationSec)) < 1, `${info.duration?.toFixed(2)}s vs ${a.durationSec}s`);
      }
    } catch (err) {
      add("ffprobe verification", false, err.message.split("\n")[0]);
    }
  }
  results.push({ ...item, pending: !existsSync(mp4) });
}

const sourceFiles = walk(root);
const secretPatterns = [
  { name: "teacher password assignment", re: /KIDDY_TEACHER_PASSWORD\s*=\s*["'][^"']+["']/ },
  { name: "real board email", re: /trois4ever/i },
  { name: "committed wav sample", re: /\.wav$/i },
];
const secretHits = [];
for (const file of sourceFiles) {
  if (!/\.(mjs|js|json|md|csv|ts|sh|example)$/.test(file)) continue;
  if (file.endsWith("check.mjs")) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.re.test(text)) secretHits.push({ file: file.replace(`${root}/`, ""), rule: pattern.name });
    if (file.endsWith(".wav")) secretHits.push({ file, rule: "audio sample in repo" });
  }
}

const report = {
  schema: "kiddy.demo-video.selfcheck.v1",
  generatedAt: new Date().toISOString(),
  requireFinal,
  languages: results,
  secrets: secretHits,
  manual: [
    "Watch both videos end to end; confirm no real child, parent, or staff data is visible.",
    "Confirm no credential, demo email, or password is readable on screen or in captions.",
    "Confirm the Arabic capture is the real RTL UI (sidebar on the right, mirrored layout), not a flipped edit.",
    "Confirm every visible teacher tool in the sidebar and top bar appears in the scene list.",
    "Confirm captions are in the same language as the voiceover and stay on screen for the spoken line.",
    "Confirm no admin-only screen appears: Settings, team Staff list, Rooms, Supplies, Report center, Smart list, Smart forms, Surveys, Performance, Finance, Account billing, Enhancements.",
  ],
};

writeFileSync(resolve(root, "out", "selfcheck.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const lang of results) {
  console.log(`\n${lang.language.toUpperCase()}:`);
  for (const check of lang.checks) console.log(`  ${check.ok ? "PASS" : "PENDING/FAIL"} ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
}
console.log(`\nSecret scan: ${secretHits.length === 0 ? "PASS" : `FAIL (${secretHits.length})`}`);

const failed = results.some((r) => r.checks.some((c) => !c.ok && !r.pending)) || secretHits.length > 0;
const incomplete = results.some((r) => r.pending) || results.some((r) => r.checks.some((c) => !c.ok));
if (requireFinal && (failed || incomplete)) process.exit(1);
if (failed) process.exit(1);
console.log("\nManual checklist written to README.md. Assets still pending unless both videos exist.");
