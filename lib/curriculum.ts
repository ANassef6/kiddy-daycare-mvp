// Curriculum data layer.
//
// The founder's real curriculum lives in /home/nassef/Documents/replica/curri,
// out of agent reach. This module defines the canonical model (areas → learning
// points → milestones, each pinned to an age band) plus a simple JSON import
// format so the real curriculum can be dropped in later WITHOUT code changes:
//
//   import { ingestCurriculum } from "@/lib/curriculum";
//   const json = fs.readFileSync("curriculum.json", "utf8");
//   await ingestCurriculum(instituteId, JSON.parse(json));
//
// The current content is the Egyptian kindergarten framework (Nursery/KG1/KG2)
// stored in data/curriculum-eg-kg.json — swap that file to replace the
// curriculum with no code change.
//
// JSON shape (see data/curriculum-eg-kg.json for a concrete example):
// {
//   "areas": [
//     {
//       "name": "Language & Communication",
//       "learningPoints": [
//         {
//           "name": "Listening & comprehension",
//           "ageGroup": "2-3y",
//           "milestones": [
//             { "name": "Listens to a short story", "ageGroup": "2-3y", "description": "..." }
//           ]
//         }
//       ]
//     }
//   ]
// }
import { queryAll, queryGet, queryRun, ensureSchema, uid, type Row } from "./db";

// Egyptian early-years age bands: 2-3y Nursery, 3-4y, 4-5y KG1, 5-6y KG2.
export const AGE_GROUPS = ["2-3y", "3-4y", "4-5y", "5-6y"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

// Human labels for the age-band select (raw band value is what gets stored).
export const AGE_GROUP_LABELS: Record<string, string> = {
  "2-3y": "2-3y (Nursery)",
  "3-4y": "3-4y",
  "4-5y": "4-5y (KG1)",
  "5-6y": "5-6y (KG2)",
};

export type CurriculumAreaInput = {
  name: string;
  learningPoints?: LearningPointInput[];
};
export type LearningPointInput = {
  name: string;
  ageGroup?: string;
  milestones?: MilestoneInput[];
};
export type MilestoneInput = {
  name: string;
  ageGroup?: string;
  description?: string;
};
export type CurriculumInput = {
  areas?: CurriculumAreaInput[];
};

// Derive the child's current age band ("2-3y".."5-6y") from date of birth.
// Children below nursery age clamp to the first band, older children to KG2.
export function ageGroupForDob(dob: string | null | undefined): string {
  if (!dob) return "";
  const born = new Date(dob);
  const now = new Date();
  if (Number.isNaN(born.getTime()) || born > now) return "";
  const years = Math.floor((now.getTime() - born.getTime()) / (365.25 * 24 * 3600 * 1000));
  if (years >= 5) return "5-6y";
  if (years >= 4) return "4-5y";
  if (years >= 3) return "3-4y";
  return "2-3y";
}

// ---------- Areas ----------
export async function listCurriculumAreas(instituteId?: string): Promise<Row[]> {
  // NOTE: pg gets explicit params (no NULL placeholders) — node-pg cannot
  // always infer the type of a NULL bind used in `? IS NULL`, which 500s the
  // learning pages on the live Postgres DB while SQLite tolerates it.
  if (instituteId) {
    return queryAll(
      `SELECT * FROM curriculum_area
       WHERE (institute_id = ? OR institute_id IS NULL)
       ORDER BY sort_order, name`,
      instituteId
    );
  }
  return queryAll(`SELECT * FROM curriculum_area ORDER BY sort_order, name`);
}

export async function createCurriculumArea(name: string, instituteId?: string): Promise<Row> {
  const id = uid();
  // NOTE: pg returns COUNT(*) as a string — Number() it, or a fresh database
  // ("0") would never seed and every insert would reuse sort_order 0.
  const sort = Number((await queryGet("SELECT COUNT(*) AS c FROM curriculum_area"))?.c ?? 0);
  await queryRun(
    "INSERT INTO curriculum_area (id, institute_id, name, sort_order) VALUES (?, ?, ?, ?)",
    id,
    instituteId ?? null,
    name,
    sort
  );
  return (await queryGet("SELECT * FROM curriculum_area WHERE id = ?", id))!;
}

// ---------- Learning points ----------
export async function listLearningPoints(opts: { areaId?: string; ageGroup?: string } = {}): Promise<Row[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.areaId) {
    where.push("lp.area_id = ?");
    args.push(opts.areaId);
  }
  if (opts.ageGroup) {
    where.push("lp.age_group = ?");
    args.push(opts.ageGroup);
  }
  return queryAll(
    `SELECT lp.*, a.name AS area_name
     FROM curriculum_learning_point lp
     LEFT JOIN curriculum_area a ON a.id = lp.area_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY lp.sort_order, lp.name`,
    ...args
  );
}

export async function createLearningPoint(data: {
  areaId: string;
  name: string;
  ageGroup?: string;
}): Promise<Row> {
  const id = uid();
  const sort = Number((await queryGet("SELECT COUNT(*) AS c FROM curriculum_learning_point WHERE area_id = ?", data.areaId))?.c ?? 0);
  await queryRun(
    "INSERT INTO curriculum_learning_point (id, area_id, name, age_group, sort_order) VALUES (?, ?, ?, ?, ?)",
    id,
    data.areaId,
    data.name,
    data.ageGroup ?? "0-1y",
    sort
  );
  return (await queryGet("SELECT * FROM curriculum_learning_point WHERE id = ?", id))!;
}

// ---------- Milestones ----------
export async function listMilestones(opts: { learningPointId?: string; ageGroup?: string } = {}): Promise<Row[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.learningPointId) {
    where.push("m.learning_point_id = ?");
    args.push(opts.learningPointId);
  }
  if (opts.ageGroup) {
    where.push("m.age_group = ?");
    args.push(opts.ageGroup);
  }
  return queryAll(
    `SELECT m.*, lp.name AS learning_point_name
     FROM curriculum_milestone m
     LEFT JOIN curriculum_learning_point lp ON lp.id = m.learning_point_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY m.sort_order, m.name`,
    ...args
  );
}

export async function createMilestone(data: {
  learningPointId: string;
  name: string;
  ageGroup?: string;
  description?: string;
}): Promise<Row> {
  const id = uid();
  // Derive the age band from the learning point when the milestone doesn't
  // pin its own (the founder's import format keeps ageGroup optional).
  const derived = data.ageGroup
    ? data.ageGroup
    : String((await queryGet("SELECT age_group FROM curriculum_learning_point WHERE id = ?", data.learningPointId))?.age_group ?? "0-1y");
  const sort = Number((await queryGet("SELECT COUNT(*) AS c FROM curriculum_milestone WHERE learning_point_id = ?", data.learningPointId))?.c ?? 0);
  await queryRun(
    "INSERT INTO curriculum_milestone (id, learning_point_id, name, age_group, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    data.learningPointId,
    data.name,
    derived,
    data.description ?? null,
    sort
  );
  return (await queryGet("SELECT * FROM curriculum_milestone WHERE id = ?", id))!;
}

// ---------- Lookups for the observation cascade ----------
export async function getMilestone(id: string): Promise<Row | undefined> {
  return queryGet(
    `SELECT m.*, lp.name AS learning_point_name, lp.area_id, a.name AS area_name
     FROM curriculum_milestone m
     LEFT JOIN curriculum_learning_point lp ON lp.id = m.learning_point_id
     LEFT JOIN curriculum_area a ON a.id = lp.area_id
     WHERE m.id = ?`,
    id
  );
}

// Full curriculum tree used by the learning page for the cascade form.
export async function curriculumTree(): Promise<Row[]> {
  const areas = await listCurriculumAreas();
  for (const area of areas) {
    area.learning_points = await queryAll(
      `SELECT * FROM curriculum_learning_point WHERE area_id = ? ORDER BY sort_order, name`,
      area.id
    );
    for (const lp of area.learning_points) {
      lp.milestones = await queryAll(
        `SELECT * FROM curriculum_milestone WHERE learning_point_id = ? ORDER BY sort_order, name`,
        lp.id
      );
    }
  }
  return areas;
}

// ---------- Import / ingest ----------
// Idempotent per name: existing areas/points/milestones are left untouched so a
// re-import never duplicates or clobbers curated edits.
export async function ingestCurriculum(data: CurriculumInput): Promise<void> {
  for (const area of data.areas ?? []) {
    let areaRow = await queryGet("SELECT * FROM curriculum_area WHERE name = ?", area.name);
    if (!areaRow) areaRow = await createCurriculumArea(area.name);
    for (const lp of area.learningPoints ?? []) {
      let lpRow = await queryGet(
        "SELECT * FROM curriculum_learning_point WHERE area_id = ? AND name = ?",
        areaRow.id,
        lp.name
      );
      if (!lpRow) {
        lpRow = await createLearningPoint({ areaId: areaRow.id as string, name: lp.name, ageGroup: lp.ageGroup });
      }
      for (const ms of lp.milestones ?? []) {
        const existing = await queryGet(
          "SELECT * FROM curriculum_milestone WHERE learning_point_id = ? AND name = ?",
          lpRow.id,
          ms.name
        );
        if (!existing) {
          await createMilestone({
            learningPointId: lpRow.id as string,
            name: ms.name,
            ageGroup: ms.ageGroup ?? lp.ageGroup,
            description: ms.description,
          });
        }
      }
    }
  }
}

// Re-seed any institute that is missing the curriculum (e.g. an existing
// database created before the curriculum tables shipped). Ensures the schema
// first so it is safe to call from pages/actions in any boot order.
export async function ensureCurriculumSeeded(): Promise<void> {
  await ensureSchema();
  const count = await queryGet("SELECT COUNT(*) AS c FROM curriculum_area");
  // NOTE: pg returns COUNT(*) as a string ("0"), so a strict `=== 0` never
  // matches and a fresh database would stay unseeded. Number() both engines.
  if (Number(count?.c ?? 0) === 0) {
    await ingestCurriculum(DEFAULT_CURRICULUM);
  }
}

// Egyptian kindergarten starter curriculum, stored as structured JSON in
// data/curriculum-eg-kg.json. Loading from the repo file (instead of an inline
// object) means the founder's real curriculum replaces this content by swapping
// the file — no code change. Falls back to an empty curriculum if the file is
// missing so nothing crashes in odd packaging.
function loadDefaultCurriculum(): CurriculumInput {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = readFileSync(
      [process.cwd(), "data", "curriculum-eg-kg.json"].join("/"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as CurriculumInput;
    return { areas: Array.isArray(parsed.areas) ? parsed.areas : [] };
  } catch {
    return { areas: [] };
  }
}

export const DEFAULT_CURRICULUM: CurriculumInput = loadDefaultCurriculum();