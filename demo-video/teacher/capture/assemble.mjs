#!/usr/bin/env node
// Assemble one language version: per-scene MP4 (video + human VO), concat,
// normalise loudness, and write the SRT + scene/timestamp list.
//
// Usage (from demo-video/teacher):
//   node capture/assemble.mjs --lang en
//   node capture/assemble.mjs --lang ar
//   node capture/assemble.mjs --lang en --allow-silent   # dry run without WAVs
//
// Voiceover folder: voiceover/wav/en/<scene-id>.wav or voiceover/wav/ar/<scene-id>.wav
// Optional brand intro/outro: assets/intro.mp4 and assets/outro.mp4 (same codecs).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaDuration, resolveFfmpeg } from "./ffmpeg.mjs";
import { buildSrt, buildTimestampCsv } from "./captions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

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

const buildDir = resolve(root, "out", lang, "build");
mkdirSync(buildDir, { recursive: true });
const wavDir = resolve(root, "voiceover", "wav", lang);
const missingVoice = [];
const missingClips = [];

function run(args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

const sceneFiles = [];
const entries = [];
let cursor = 0;
const MIN_SCENE_SEC = 5;

for (const scene of plan.scenes) {
  const clip = clips.get(scene.id);
  if (!clip) {
    missingClips.push(scene.id);
    continue;
  }
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

  const sceneOut = join(buildDir, `${scene.id}.mp4`);
  const videoFilter = [
    "[0:v]fps=30",
    "scale=1920:1080:force_original_aspect_ratio=decrease",
    "pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
    "setsar=1",
    "tpad=stop_mode=clone:stop_duration=120",
    "format=yuv420p[v]",
  ].join(",");
  const audioFilter = "[1:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad[a]";

  const args = hasVoiceover
    ? ["-i", clipPath, "-i", wavPath]
    : ["-i", clipPath, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];

  run([
    ...args,
    "-filter_complex",
    `${videoFilter};${audioFilter}`,
    "-map", "[v]",
    "-map", "[a]",
    "-t", duration.toFixed(3),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    sceneOut,
  ]);

  const actual = mediaDuration(ffprobe, sceneOut) ?? duration;
  sceneFiles.push(sceneOut);
  entries.push({
    id: scene.id,
    title: scene.title,
    tool: scene.tool,
    route: scene.route,
    text: scene.id ? planText(lang, scene.id) : "",
    startSec: cursor,
    endSec: cursor + actual,
    hasVoiceover,
    maxChars: lang === "ar" ? 40 : 42,
  });
  cursor += actual;
  console.log(
    `${scene.id}: clip ${clipDuration.toFixed(2)}s, VO ${hasVoiceover ? `${voDuration.toFixed(2)}s` : "MISSING"}, scene ${actual.toFixed(2)}s`
  );
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

if (missingClips.length) console.warn(`Missing clips: ${missingClips.join(", ")}`);
if (missingClips.length) {
  console.error("Every scene needs its captured clip. Re-run record.mjs before assembling.");
  process.exit(1);
}
if (missingVoice.length) console.warn(`Missing voiceover: ${missingVoice.join(", ")}`);
if (missingVoice.length && !allowSilent) {
  console.error("Every scene needs its human voiceover WAV. Re-run with --allow-silent only for a dry run.");
  process.exit(1);
}
if (sceneFiles.length === 0) {
  console.error("No scenes assembled. Capture clips first, then provide the WAVs (or pass --allow-silent).");
  process.exit(1);
}

const intro = resolve(root, "assets/intro.mp4");
const outro = resolve(root, "assets/outro.mp4");
const concatFiles = [];
let introOffset = 0;
if (existsSync(intro)) {
  concatFiles.push(intro);
  introOffset = mediaDuration(ffprobe, intro) ?? 0;
} else {
  console.log("No assets/intro.mp4 — skipping intro.");
}
concatFiles.push(...sceneFiles);
if (existsSync(outro)) {
  concatFiles.push(outro);
} else {
  console.log("No assets/outro.mp4 — skipping outro.");
}

const listPath = join(buildDir, "concat.txt");
writeFileSync(listPath, `${concatFiles.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n")}\n`);
const outMp4 = resolve(root, "out", lang, `teacher-${lang}-1080p.mp4`);
run(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outMp4]);

const shifted = entries.map((entry) => ({ ...entry, startSec: entry.startSec + introOffset, endSec: entry.endSec + introOffset }));
const srtPath = resolve(root, "out", lang, `teacher-${lang}.srt`);
const timestampsPath = resolve(root, "out", lang, "scene-timestamps.csv");
writeFileSync(srtPath, buildSrt(shifted));
writeFileSync(timestampsPath, buildTimestampCsv(shifted));

const duration = mediaDuration(ffprobe, outMp4);
writeFileSync(
  resolve(root, "out", lang, "assembly.json"),
  `${JSON.stringify(
    {
      schema: "kiddy.demo-video.assembly.v1",
      language: plan.language,
      output: outMp4.replace(`${root}/`, ""),
      srt: srtPath.replace(`${root}/`, ""),
      sceneTimestamps: timestampsPath.replace(`${root}/`, ""),
      durationSec: duration,
      intro: existsSync(intro),
      outro: existsSync(outro),
      missingVoiceover: missingVoice,
      missingClips,
      scenes: shifted.map(({ text, ...rest }) => rest),
    },
    null,
    2
  )}\n`
);

console.log(`Assembled ${outMp4} (${duration?.toFixed(1)}s)`);
console.log(`Wrote ${srtPath} and ${timestampsPath}`);
