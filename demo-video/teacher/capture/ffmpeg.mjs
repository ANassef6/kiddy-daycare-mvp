// Locate a full ffmpeg/ffprobe pair. Playwright's bundled encoder is WebM-only,
// so final MP4 assembly needs a normal ffmpeg install (or ffmpeg-static).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

function packagedBinary(name) {
  try {
    const require = createRequire(import.meta.url);
    if (name === "ffmpeg") {
      const mod = require("ffmpeg-static");
      return typeof mod === "string" ? mod : mod?.default;
    }
    const mod = require("ffprobe-static");
    return typeof mod === "string" ? mod : mod?.path;
  } catch {
    return null;
  }
}

function probeBinary(name, envValue) {
  const candidates = [envValue, packagedBinary(name), `${name}`, `/usr/bin/${name}`, `/usr/local/bin/${name}`].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["-version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function resolveFfmpeg() {
  const ffmpeg = probeBinary("ffmpeg", process.env.FFMPEG);
  const ffprobe = probeBinary("ffprobe", process.env.FFPROBE);
  if (!ffmpeg || !ffprobe) {
    throw new Error(
      "A full ffmpeg + ffprobe install is required for MP4 assembly. " +
        "Install ffmpeg and re-run, or set FFMPEG and FFPROBE to their absolute paths."
    );
  }
  return { ffmpeg, ffprobe };
}

export function mediaDuration(ffprobe, file) {
  if (!existsSync(file)) return null;
  const out = execFileSync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8" }
  ).trim();
  const value = Number(out);
  return Number.isFinite(value) ? value : null;
}
