#!/usr/bin/env node
// Render the narration scripts from scenes.teacher.json so the markdown, the
// CSV line lists, and the capture plan cannot drift apart.
//
// Usage (from demo-video/teacher):
//   node capture/print-scripts.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const scenes = JSON.parse(readFileSync(join(root, "scenes.teacher.json"), "utf8"));
const wps = { en: scenes.voiceover.en.wordsPerSecond, ar: scenes.voiceover.ar.wordsPerSecond };

function duration(text, speed) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(6, Math.round((words / speed + 0.9) * 10) / 10);
}

const titles = {
  en: { heading: "Teacher demo — English narration", note: "Read each line once, at a calm product-demo pace. Each scene is one idea." },
  ar: { heading: "Teacher demo — Egyptian Arabic narration", note: "اقرأ كل سطر مرة واحدة، بسرعة هادية زي فيديو شرح. كل مشهد فكرة واحدة." },
};

for (const lang of ["en", "ar"]) {
  const lines = [
    `# ${titles[lang].heading}`,
    "",
    titles[lang].note,
    "",
    `Role: teacher/staff · Tenant: Sunshine (\`${scenes.baseUrl}\`) · Capture: ${scenes.format.width}x${scenes.format.height}, ${scenes.format.fps} fps`,
    "",
    "| # | Scene | Tool | Screen | Line | Target |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const scene of scenes.scenes) {
    const text = scene.vo[lang];
    const seconds = duration(text, wps[lang]);
    lines.push(`| ${scene.id} | ${scene.title} | ${scene.tool} | \`${scene.route}\` | ${text.replaceAll("|", "\\|")} | ${seconds.toFixed(1)}s |`);
  }
  const total = scenes.scenes.reduce((sum, scene) => sum + duration(scene.vo[lang], wps[lang]), 0);
  lines.push("", `Target total: **${total.toFixed(1)}s** (~${Math.round(total / 60)} min). Re-measured from the uploaded WAVs at assembly.`, "");
  writeFileSync(join(root, "scripts", lang === "en" ? "en.md" : "ar-eg.md"), `${lines.join("\n")}\n`);
  console.log(`Wrote scripts/${lang === "en" ? "en" : "ar-eg"}.md`);
}
