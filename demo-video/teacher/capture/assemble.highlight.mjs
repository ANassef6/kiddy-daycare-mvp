#!/usr/bin/env node
// Assemble with highlight overlay (no zoom): draws a highlight box around the
// target UI element for each scene. No zooming.
// Usage: node capture/assemble.highlight.mjs --lang en|ar [--allow-silent]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaDuration, resolveFfmpeg } from "./ffmpeg.mjs";
import { buildSrt, buildTimestampCsv } from "./captions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// Highlight rectangles in 1920x1080 pixel space (LTR coordinates).
// For AR (RTL UI captured in RTL), mirror X: newX = 1920 - x - w.
const HIGHLIGHTS_LTR = {
  "01-login": { x: 760, y: 420, w: 400, h: 320 },
  "02-dashboard": { x: 12, y: 210, w: 196, h: 36 },
  "03-children": { x: 12, y: 330, w: 196, h: 36 },
  "04-child-daily-report": { x: 280, y: 220, w: 170, h: 40 },
  "05-child-about": { x: 450, y: 220, w: 150, h: 40 },
  "06-child-family": { x: 600, y: 220, w: 220, h: 40 },
  "07-child-media": { x: 820, y: 220, w: 120, h: 40 },
  "08-child-documents": { x: 940, y: 220, w: 170, h: 40 },
  "09-child-schedules": { x: 1110, y: 220, w: 150, h: 40 },
  "10-child-learning": { x: 1260, y: 220, w: 200, h: 40 },
  "11-child-incidents": { x: 1460, y: 220, w: 170, h: 40 },
  "12-attendance": { x: 12, y: 366, w: 196, h: 36 },
  "13-consents": { x: 12, y: 402, w: 196, h: 36 },
  "14-incidents": { x: 260, y: 120, w: 600, h: 60 },
  "15-newsfeed": { x: 12, y: 246, w: 196, h: 36 },
  "16-messages": { x: 1700, y: 18, w: 44, h: 44 },
  "17-calendar": { x: 12, y: 282, w: 196, h: 36 },
  "18-events": { x: 12, y: 318, w: 196, h: 36 },
  "19-drive": { x: 12, y: 354, w: 196, h: 36 },
  "20-learning": { x: 12, y: 470, w: 196, h: 36 },
  "21-activities": { x: 12, y: 506, w: 196, h: 36 },
  "22-homework": { x: 12, y: 542, w: 196, h: 36 },
  "23-staff-profile": { x: 12, y: 620, w: 196, h: 36 },
  "24-staff-schedule": { x: 12, y: 656, w: 196, h: 36 },
  "25-working-hours": { x: 12, y: 692, w: 196, h: 36 },
  "26-notifications": { x: 1750, y: 18, w: 44, h: 44 },
  "27-account": { x: 1810, y: 18, w: 80, h: 44 },
  "28-wrap": { x: 12, y: 210, w: 196, h: 36 },
};

function mirroredX(x, w) {
  return 1920 - x - w;
}

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const lang = arg("lang", "en") === "ar" ? "ar" : "en";
const allowSilent = flag("allow-silent");
const plan = JSON.parse(readFileSync(resolve(root, "out/plan", `${lang}.json`), "utf8"));
const clipManifestPath = resolve(root, "out", lang, "clips", "manifest.json");
if (!existsSync(clipManifestPath)) {
  console.error(`Missing ${clipManifestPath}. Run: node capture/record.mjs --lang ${lang}`);
  process.exit(2);
}
const clipManifest = JSON.parse(readFileSync(clipManifestPath, "utf8"));
const clips = new Map(clipManifest.clips.map((clip) => [clip.id, clip]));
const { ffmpeg, ffprobe } = resolveFfmpeg();

const buildDir = resolve(root, "out", lang, "build-highlight");
mkdirSync(buildDir, { recursive: true });
const wavDir = resolve(root, "voiceover", "wav", lang);
const missingVoice = [];
const missingClips = [];

function run(args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function planText(language, id) {
  const csv = readFileSync(resolve(root, "voiceover", `${language}.lines.csv`), "utf8").split(/\r?\n/);
  for (const line of csv.slice(1)) {
    if (!line.startsWith(`${id},`)) continue;
    const match = line.slice(id.length + 1).match(/^("(?:[^"]|"")*"|[^,]*)/);
    if (!match) return "";
    const value = match[1];
    return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value;
  }
  return "";
}

const sceneFiles = [];
const entries = [];
let cursor = 0;
const MIN_SCENE_SEC = 5;
const FPS = 30;

for (const scene of plan.scenes) {
  const clip = clips.get(scene.id);
  if (!clip) { missingClips.push(scene.id); continue; }
  const clipPath = resolve(root, clip.clip);
  const wavPath = join(wavDir, `${scene.id}.wav`);
  const hasVoiceover = existsSync(wavPath);
  if (!hasVoiceover) {
    missingVoice.push(scene.id);
    if (!allowSilent) continue;
  }

  const clipDuration = mediaDuration(ffprobe, clipPath) ?? scene.targetDurationSec;
  const voDuration = hasVoiceover ? mediaDuration(ffprobe, wavPath) ?? 0 : 0;
  const duration = Math.max(MIN_SCENE_SEC, (voDuration > 0 ? voDuration + 0.7 : scene.targetDurationSec));

  const hl = HIGHLIGHTS_LTR[scene.id];
  let videoFilter;
  if (hl) {
    const x = lang === "ar" ? mirroredX(hl.x, hl.w) : hl.x;
    const y = hl.y;
    const w = hl.w;
    const h = hl.h;
    // Simple highlight: base scaled video + two drawbox outlines (glow effect)
    videoFilter =
      `[0:v]fps=${FPS},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=120,format=yuv420p,` +
      `drawbox=x=${x - 2}:y=${y - 2}:w=${w + 4}:h=${h + 4}:c=yellow@0.35:t=3,` +
      `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:c=yellow@0.95:t=3[vout]`;
  } else {
    videoFilter =
      `[0:v]fps=${FPS},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=120,format=yuv420p[vout]`;
  }
  const audioFilter = "[1:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad[a]";

  const args = hasVoiceover
    ? ["-i", clipPath, "-i", wavPath]
    : ["-i", clipPath, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  const sceneOut = join(buildDir, `${scene.id}.mp4`);
  try {
    run([
      ...args,
      "-filter_complex", `${videoFilter};${audioFilter}`,
      "-map", "[vout]", "-map", "[a]",
      "-t", duration.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart",
      sceneOut,
    ]);
  } catch (e) {
    console.error(`Failed to assemble scene ${scene.id}`);
    throw e;
  }

  const actual = mediaDuration(ffprobe, sceneOut) ?? duration;
  sceneFiles.push(sceneOut);
  entries.push({
    id: scene.id, title: scene.title, tool: scene.tool, route: scene.route,
    text: planText(lang, scene.id), startSec: cursor, endSec: cursor + actual,
    hasVoiceover, maxChars: lang === "ar" ? 40 : 42,
  });
  cursor += actual;
  console.log(`${scene.id}: clip ${clipDuration.toFixed(2)}s, VO ${hasVoiceover ? `${voDuration.toFixed(2)}s` : "MISSING"}, scene ${actual.toFixed(2)}s, highlight ${hl ? "on" : "none"}`);
}

if (missingClips.length) { console.error(`Missing clips: ${missingClips.join(", ")}`); process.exit(1); }
if (missingVoice.length) console.warn(`Missing voiceover: ${missingVoice.join(", ")}`);
if (missingVoice.length && !allowSilent) { console.error("Every scene needs its human voiceover WAV."); process.exit(1); }
if (sceneFiles.length === 0) { console.error("No scenes assembled."); process.exit(1); }

const intro = resolve(root, "assets/intro.mp4");
const outro = resolve(root, "assets/outro.mp4");
const concatFiles = [];
let introOffset = 0;
if (existsSync(intro)) { concatFiles.push(intro); introOffset = mediaDuration(ffprobe, intro) ?? 0; }
concatFiles.push(...sceneFiles);
if (existsSync(outro)) concatFiles.push(outro);

const listPath = join(buildDir, "concat.txt");
writeFileSync(listPath, `${concatFiles.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n")}\n`);
const outMp4 = resolve(root, "out", lang, `teacher-${lang}-1080p.mp4`);
run(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outMp4]);

const shifted = entries.map((e) => ({ ...e, startSec: e.startSec + introOffset, endSec: e.endSec + introOffset }));
const srtPath = resolve(root, "out", lang, `teacher-${lang}.srt`);
const tsPath = resolve(root, "out", lang, "scene-timestamps.csv");
writeFileSync(srtPath, buildSrt(shifted));
writeFileSync(tsPath, buildTimestampCsv(shifted));
const dur = mediaDuration(ffprobe, outMp4);
writeFileSync(resolve(root, "out", lang, "assembly.json"), JSON.stringify({
  schema: "kiddy.demo-video.assembly.v1",
  language: plan.language, output: outMp4.replace(`${root}/`, ""),
  srt: srtPath.replace(`${root}/`, ""), sceneTimestamps: tsPath.replace(`${root}/`, ""),
  durationSec: dur, intro: existsSync(intro), outro: existsSync(outro),
  missingVoiceover: missingVoice, missingClips,
  highlightOverlay: true, voiceProfile: "Kiddy (93cd5ca5)",
  scenes: shifted.map(({ text, ...rest }) => rest),
}, null, 2) + "\n");
console.log(`Assembled ${outMp4} (${dur?.toFixed(1)}s) with highlight overlay`);
console.log(`Wrote ${srtPath} and ${tsPath}`);