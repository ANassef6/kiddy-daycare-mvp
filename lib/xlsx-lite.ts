// KID-2478: a tiny, dependency-free reader for the first worksheet of an
// .xlsx file.
//
// The bulk-upload writer uses ExcelJS to BUILD the two templates. Reading is
// deliberately separate: ExcelJS 4.4 throws while reconciling the cell
// comments our approved draft templates carry, and a founder may upload a
// template that still has them. This reader only needs what the bulk sheets
// contain — cell text, shared strings and numeric/date values — so it parses
// the OpenXML parts directly with the platform zlib. Anything it cannot
// understand surfaces as an empty cell rather than a crash; validation then
// reports the row.

import { inflateRawSync } from "node:zlib";

export type SheetCell = string | number | boolean | null;
export type SheetRow = { rowNumber: number; cells: Map<number, SheetCell> };

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("xlsx-eocd");
}

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

function readEntries(buffer: Buffer): Map<string, ZipEntry> {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== SIG_CENTRAL) break;
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const offset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    entries.set(name.replace(/\\/g, "/"), { name, method, compressedSize, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (buffer.readUInt32LE(entry.offset) !== SIG_LOCAL) throw new Error("xlsx-local-header");
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`xlsx-compression-${entry.method}`);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return match ? decodeXmlText(match[1]) : null;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function textContent(xml: string): string {
  const parts: string[] = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) parts.push(decodeXmlText(match[1]));
  return parts.join("");
}

function firstSheetPath(files: Map<string, string>): string | null {
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const sheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
    const relId = sheet ? attribute(sheet[1], "r:id") : null;
    if (relId) {
      const relRe = /<Relationship\b([^>]*)\/?>/g;
      let rel: RegExpExecArray | null;
      while ((rel = relRe.exec(rels))) {
        if (attribute(rel[1], "Id") !== relId) continue;
        const target = attribute(rel[1], "Target") ?? "";
        const normalized = target.startsWith("/")
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, "")}`;
        if (files.has(normalized)) return normalized;
      }
    }
  }
  const fallback = [...files.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  return fallback ?? null;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const values: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) values.push(textContent(match[1]));
  return values;
}

function parseSheet(xml: string, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowAttrs = rowMatch[1];
    const rowNumber = Number(attribute(rowAttrs, "r") ?? 0) || rows.length + 1;
    const body = rowMatch[2] ?? "";
    const cells = new Map<number, SheetCell>();
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(body))) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] ?? "";
      const ref = attribute(attrs, "r") ?? "";
      const index = ref ? columnIndex(ref) : cells.size;
      const type = attribute(attrs, "t") ?? "n";
      const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const value = rawValue === undefined ? "" : decodeXmlText(rawValue);
      let cell: SheetCell = value;
      if (type === "s") {
        cell = shared[Number(value)] ?? "";
      } else if (type === "inlineStr") {
        cell = textContent(inner);
      } else if (type === "str") {
        cell = value;
      } else if (type === "b") {
        cell = value === "1" || value.toLowerCase() === "true";
      } else if (type === "d") {
        cell = value;
      } else if (type !== "n") {
        cell = value;
      } else if (value !== "") {
        const numeric = Number(value);
        cell = Number.isFinite(numeric) ? numeric : value;
      } else {
        cell = null;
      }
      if (cell === "") cell = null;
      cells.set(index, cell);
    }
    if (cells.size > 0) rows.push({ rowNumber, cells });
  }
  return rows;
}

/** Read the first worksheet. Returns each non-empty row with 0-based columns. */
export function readXlsxRows(buffer: Buffer): SheetRow[] {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("xlsx-empty");
  const entries = readEntries(buffer);
  const files = new Map<string, string>();
  const wanted = new Set([
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/sharedStrings.xml",
  ]);
  for (const [name] of entries) {
    if (wanted.has(name) || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      files.set(name, readEntry(buffer, entries.get(name)!).toString("utf8"));
    }
  }
  const sheetPath = firstSheetPath(files);
  if (!sheetPath) throw new Error("xlsx-no-sheet");
  const shared = parseSharedStrings(files.get("xl/sharedStrings.xml"));
  return parseSheet(files.get(sheetPath)!, shared);
}
