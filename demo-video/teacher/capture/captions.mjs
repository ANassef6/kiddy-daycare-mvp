// Caption and timestamp builders shared by assemble.mjs and check.mjs.
function two(n) {
  return String(n).padStart(2, "0");
}

export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${two(h)}:${two(m)}:${two(s)},${String(millis).padStart(3, "0")}`;
}

export function wrap(text, maxChars) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// entries: [{ id, text, startSec, endSec, maxChars }]
export function buildSrt(entries, maxChars = 42) {
  const blocks = entries.map((entry, i) => {
    const body = wrap(entry.text, entry.maxChars ?? maxChars).join("\n");
    return `${i + 1}\n${srtTime(entry.startSec)} --> ${srtTime(entry.endSec)}\n${body}\n`;
  });
  return `${blocks.join("\n")}\n`;
}

export function buildTimestampCsv(entries) {
  const header = "scene,title,tool,route,start,end,duration,voiceover";
  const rows = entries.map((entry) =>
    [entry.id, entry.title, entry.tool, entry.route, entry.startSec.toFixed(2), entry.endSec.toFixed(2), (entry.endSec - entry.startSec).toFixed(2), entry.hasVoiceover ? "yes" : "missing"]
      .map((value) => (/[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : value))
      .join(",")
  );
  return `${[header, ...rows].join("\n")}\n`;
}
