#!/usr/bin/env node
// Single source of truth for the teacher demo video.
// Reads scenes.teacher.json and writes the voiceover line lists, the local
// Voicebox batch manifests, and the per-language capture plan.
//
// Run from demo-video/teacher:
//   node capture/build-manifest.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const scenes = JSON.parse(readFileSync(join(root, "scenes.teacher.json"), "utf8"));

const LANGS = [
  { key: "en", dir: "en", label: "English", locale: "en" },
  { key: "ar", dir: "ar", label: "Egyptian Arabic", locale: "ar-EG" },
];

function words(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

// Target duration at the declared words-per-second, plus a short lead/tail.
// The real duration is re-measured from the uploaded WAV in assemble.mjs, so
// a slower read only stretches that scene instead of breaking sync.
export function lineDuration(text, wps) {
  const speech = words(text) / wps;
  return Math.max(6, Math.round((speech + 0.9) * 10) / 10);
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function writeCsv(path, rows) {
  const header = ["id", "text", "scene", "duration", "tool", "route", "language"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.text,
        row.scene,
        row.duration.toFixed(1),
        row.tool,
        row.route,
        row.language,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
}

for (const lang of LANGS) {
  const wps = scenes.voiceover[lang.key].wordsPerSecond;
  const rows = [];
  const batch = [];
  const plan = [];

  for (const scene of scenes.scenes) {
    const text = scene.vo[lang.key];
    if (!text) throw new Error(`Scene ${scene.id} has no ${lang.key} voiceover`);
    const duration = lineDuration(text, wps);
    rows.push({
      id: scene.id,
      text,
      scene: scene.id,
      duration,
      tool: scene.tool,
      route: scene.route,
      language: lang.locale,
    });
    batch.push({
      id: scene.id,
      text,
      language: lang.locale,
      scene: scene.id,
      out: `voiceover/wav/${lang.dir}/${scene.id}.wav`,
      targetDurationSec: duration,
    });
    plan.push({
      id: scene.id,
      title: scene.title,
      tool: scene.tool,
      route: scene.route,
      auth: scene.auth,
      actions: scene.actions,
      targetDurationSec: duration,
      holdSec: Math.max(scenes.capture.minHoldSec, duration),
    });
  }

  writeCsv(join(root, "voiceover", `${lang.dir}.lines.csv`), rows);
  writeFileSync(
    join(root, "voiceover", `voicebox-batch.${lang.dir}.json`),
    `${JSON.stringify(
      {
        schema: "kiddy.demo-video.voicebox-batch.v1",
        language: lang.locale,
        direction: scenes.voiceover[lang.key].dir,
        note: "Synthesize each line locally in Voicebox with the board's own cloned voice. Never upload or store the voice sample with this repo.",
        lines: batch,
      },
      null,
      2
    )}\n`
  );
  mkdirSync(join(root, "out", "plan"), { recursive: true });
  writeFileSync(
    join(root, "out", "plan", `${lang.dir}.json`),
    `${JSON.stringify(
      {
        schema: "kiddy.demo-video.capture-plan.v1",
        role: scenes.role,
        tenant: scenes.tenant,
        baseUrl: scenes.baseUrl,
        format: scenes.format,
        language: lang.locale,
        dir: scenes.voiceover[lang.key].dir,
        scenes: plan,
      },
      null,
      2
    )}\n`
  );

  const total = rows.reduce((sum, row) => sum + row.duration, 0);
  const totalWords = rows.reduce((sum, row) => sum + words(row.text), 0);
  console.log(
    `${lang.label}: ${rows.length} lines, ${totalWords} words, ${total.toFixed(1)}s (~${Math.round(total / 60)} min)`
  );
}

// Committed scene map: every scene, its tool, route, and both target lengths.
const mapRows = scenes.scenes.map((scene) => ({
  scene: scene.id,
  title: scene.title,
  tool: scene.tool,
  route: scene.route,
  auth: scene.auth ? "yes" : "no",
  en_duration: lineDuration(scene.vo.en, scenes.voiceover.en.wordsPerSecond).toFixed(1),
  ar_duration: lineDuration(scene.vo.ar, scenes.voiceover.ar.wordsPerSecond).toFixed(1),
}));
const mapHeader = ["scene", "title", "tool", "route", "auth", "en_duration", "ar_duration"];
writeFileSync(
  join(root, "scene-map.csv"),
  `${[mapHeader.join(","), ...mapRows.map((row) => mapHeader.map((key) => csvEscape(row[key])).join(","))].join("\n")}\n`
);
const mapMd = [
  "# Teacher demo — scene map",
  "",
  `Role: teacher/staff · Tenant: Sunshine (\`${scenes.baseUrl}\`) · ${scenes.format.width}x${scenes.format.height} @ ${scenes.format.fps} fps`,
  "",
  "| Scene | Tool | Route | Auth | EN | AR |",
  "| --- | --- | --- | --- | --- | --- |",
  ...mapRows.map((row) => `| ${row.scene} — ${row.title} | ${row.tool} | \`${row.route}\` | ${row.auth} | ${row.en_duration}s | ${row.ar_duration}s |`),
  "",
  "Exclusions and reasons live in `scenes.teacher.json` (`excluded`).",
  "",
].join("\n");
writeFileSync(join(root, "scene-map.md"), mapMd);
console.log(`Wrote scene-map.csv and scene-map.md (${mapRows.length} scenes)`);
