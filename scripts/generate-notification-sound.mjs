// KID-480: generates the bundled in-app notification sound
// public/notification-sound.wav deterministically (two short sine beeps).
// Run: node scripts/generate-notification-sound.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sampleRate = 8000;
const beep = 0.11; // seconds
const gap = 0.08;
const freq = 880; // A5 — short, unmistakable "ding"
const gain = 0.42;

const samples = [];
const beepCount = Math.floor(((beep + gap) * 2) / (beep + gap)) * 0 + 2;
for (let b = 0; b < beepCount; b += 1) {
  for (let i = 0; i < Math.floor(beep * sampleRate); i += 1) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 80) * Math.exp(-t * 12);
    samples.push(Math.sin(2 * Math.PI * freq * t) * gain * env);
  }
  for (let i = 0; i < Math.floor(gap * sampleRate); i += 1) samples.push(0);
}

const data = Buffer.alloc(samples.length * 2);
for (let i = 0; i < samples.length; i += 1) {
  data.writeInt16LE(Math.max(-1, Math.min(1, samples[i])) * 32767, i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

mkdirSync(path.join(root, "public"), { recursive: true });
writeFileSync(path.join(root, "public", "notification-sound.wav"), Buffer.concat([header, data]));
console.log("wrote public/notification-sound.wav", data.length + 44, "bytes");
