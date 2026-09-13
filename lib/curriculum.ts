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
// JSON shape (see DEFAULT_CURRICULUM for a concrete example):
// {
//   "areas": [
//     {
//       "name": "Communication & Language",
//       "learningPoints": [
//         {
//           "name": "Listening & attention",
//           "ageGroup": "3-4y",
//           "milestones": [
//             { "name": "Listen to others in a group", "ageGroup": "3-4y", "description": "..." }
//           ]
//         }
//       ]
//     }
//   ]
// }
import { queryAll, queryGet, queryRun, ensureSchema, uid, type Row } from "./db";

export const AGE_GROUPS = ["0-1y", "1-2y", "2-3y", "3-4y", "4-5y"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

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

// Derive the child's current age band ("0-1y"..."4-5y") from date of birth.
export function ageGroupForDob(dob: string | null | undefined): string {
  if (!dob) return "";
  const born = new Date(dob);
  const now = new Date();
  if (Number.isNaN(born.getTime()) || born > now) return "";
  const years = Math.floor((now.getTime() - born.getTime()) / (365.25 * 24 * 3600 * 1000));
  if (years >= 4) return "4-5y";
  if (years >= 3) return "3-4y";
  if (years >= 2) return "2-3y";
  if (years >= 1) return "1-2y";
  return "0-1y";
}

// ---------- Areas ----------
export async function listCurriculumAreas(instituteId?: string): Promise<Row[]> {
  return queryAll(
    `SELECT * FROM curriculum_area
     WHERE (? IS NULL OR institute_id = ? OR institute_id IS NULL)
     ORDER BY sort_order, name`,
    instituteId ?? null,
    instituteId ?? null
  );
}

export async function createCurriculumArea(name: string, instituteId?: string): Promise<Row> {
  const id = uid();
  const sort = (await queryGet("SELECT COUNT(*) AS c FROM curriculum_area"))?.c ?? 0;
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
  const sort = (await queryGet("SELECT COUNT(*) AS c FROM curriculum_learning_point WHERE area_id = ?", data.areaId))?.c ?? 0;
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
  const sort = (await queryGet("SELECT COUNT(*) AS c FROM curriculum_milestone WHERE learning_point_id = ?", data.learningPointId))?.c ?? 0;
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
  if ((count?.c as number) === 0) {
    await ingestCurriculum(DEFAULT_CURRICULUM);
  }
}

// EYFS-style starter curriculum. Placeholder content that proves the
// point → age group → milestone cascade end to end; the founder's curriculum
// from /home/nassef/Documents/replica/curri replaces this via ingestCurriculum.
export const DEFAULT_CURRICULUM: CurriculumInput = {
  areas: [
    {
      name: "Communication & Language",
      learningPoints: [
        {
          name: "Listening & attention",
          ageGroup: "0-1y",
          milestones: [
            { name: "Turns head toward familiar sounds", ageGroup: "0-1y", description: "Reacts to voices and rattles nearby." },
            { name: "Listens to a simple story for a moment", ageGroup: "1-2y", description: "Settles for a short picture book." },
            { name: "Listens to others in a small group", ageGroup: "3-4y", description: "Attends during carpet-time discussions." },
            { name: "Follows a two-part instruction", ageGroup: "4-5y", description: "For example: 'put your cup down and wash your hands'." },
          ],
        },
        {
          name: "Speaking",
          ageGroup: "1-2y",
          milestones: [
            { name: "Babbles and copies sounds", ageGroup: "0-1y", description: "Experiments with voice." },
            { name: "Uses single words with meaning", ageGroup: "1-2y", description: "'Mama', 'ball', 'more'." },
            { name: "Joins two words together", ageGroup: "2-3y", description: "'Mummy go', 'more milk'." },
            { name: "Describes events in simple sentences", ageGroup: "3-4y", description: "Tells the group about the weekend." },
          ],
        },
      ],
    },
    {
      name: "Physical Development",
      learningPoints: [
        {
          name: "Gross motor",
          ageGroup: "1-2y",
          milestones: [
            { name: "Rolls over and sits with support", ageGroup: "0-1y", description: "Gains head control and sitting balance." },
            { name: "Takes first independent steps", ageGroup: "1-2y", description: "Walks unaided across the room." },
            { name: "Runs, jumps and climbs", ageGroup: "2-3y", description: "Confident on climbing equipment." },
            { name: "Balances and moves with control", ageGroup: "4-5y", description: "Hopping, skipping and negotiating obstacles." },
          ],
        },
        {
          name: "Fine motor",
          ageGroup: "1-2y",
          milestones: [
            { name: "Reaches for and grasps objects", ageGroup: "0-1y", description: "Brings toys to the mouth." },
            { name: "Picks up small objects with thumb & fingers", ageGroup: "1-2y", description: "Pincer grip emerging." },
            { name: "Holds a crayon and makes marks", ageGroup: "2-3y", description: "Scribbles with intent." },
            { name: "Uses scissors and draws recognizable shapes", ageGroup: "4-5y", description: "Snips paper and copies simple drawings." },
          ],
        },
      ],
    },
    {
      name: "Personal, Social & Emotional Development",
      learningPoints: [
        {
          name: "Building relationships",
          ageGroup: "1-2y",
          milestones: [
            { name: "Enjoys cuddles and familiar faces", ageGroup: "0-1y", description: "Soothes in the arms of a key person." },
            { name: "Plays alongside others", ageGroup: "1-2y", description: "Parallel play in the home corner." },
            { name: "Takes turns with adult support", ageGroup: "2-3y", description: "Shares a popular toy with prompting." },
            { name: "Forms friendships and plays co-operatively", ageGroup: "4-5y", description: "Negotiates roles in group play." },
          ],
        },
        {
          name: "Managing feelings & behaviour",
          ageGroup: "2-3y",
          milestones: [
            { name: "Shows simple emotions", ageGroup: "0-1y", description: "Smiles, frowns, cries to communicate." },
            { name: "Begins to use words for feelings", ageGroup: "1-2y", description: "'Happy', 'sad', 'angry'." },
            { name: "Calms with adult comfort", ageGroup: "2-3y", description: "Accepts a hug after a upset." },
            { name: "Talks about feelings and follows routines", ageGroup: "4-5y", description: "Names emotions and follows rules." },
          ],
        },
      ],
    },
    {
      name: "Literacy",
      learningPoints: [
        {
          name: "Reading",
          ageGroup: "2-3y",
          milestones: [
            { name: "Turns pages of a board book", ageGroup: "0-1y", description: "Shows interest in pictures." },
            { name: "Joins in with familiar stories", ageGroup: "1-2y", description: "Fills in words and phrases." },
            { name: "Recognizes own name in print", ageGroup: "2-3y", description: "Finds the name card on the register." },
            { name: "Reads simple words and sentences", ageGroup: "4-5y", description: "Early phonics decoding." },
          ],
        },
        {
          name: "Writing",
          ageGroup: "2-3y",
          milestones: [
            { name: "Makes random marks", ageGroup: "1-2y", description: "Enjoys sensory writing with fingers and paint." },
            { name: "Writes some letter-like shapes", ageGroup: "2-3y", description: "Early emergent writing." },
            { name: "Holds a pencil correctly", ageGroup: "3-4y", description: "Tripod grip for drawing." },
            { name: "Writes own name and simple captions", ageGroup: "4-5y", description: "Spells some common words." },
          ],
        },
      ],
    },
    {
      name: "Mathematics",
      learningPoints: [
        {
          name: "Number",
          ageGroup: "2-3y",
          milestones: [
            { name: "Notices number rhymes", ageGroup: "0-1y", description: "Engages with counting songs." },
            { name: "Says some number names in order", ageGroup: "1-2y", description: "'One, two, three!' while playing." },
            { name: "Counts objects to five", ageGroup: "2-3y", description: "Matches number words to objects." },
            { name: "Counts to 20 and recognizes numerals", ageGroup: "4-5y", description: "Counting and simple composition of numbers." },
          ],
        },
        {
          name: "Shape, space & measures",
          ageGroup: "2-3y",
          milestones: [
            { name: "Recognizes big and small", ageGroup: "0-1y", description: "Responds to size words during play." },
            { name: "Sorts objects by shape or color", ageGroup: "1-2y", description: "Matches like blocks." },
            { name: "Builds towers and simple puzzles", ageGroup: "2-3y", description: "Three-to-five piece puzzles." },
            { name: "Uses positional language", ageGroup: "4-5y", description: "'Under', 'behind', 'next to'." },
          ],
        },
      ],
    },
    {
      name: "Understanding the World",
      learningPoints: [
        {
          name: "People, culture & communities",
          ageGroup: "2-3y",
          milestones: [
            { name: "Shows interest in family photos", ageGroup: "0-1y", description: "Responds to familiar faces." },
            { name: "Points at self in the mirror", ageGroup: "1-2y", description: "Early sense of self." },
            { name: "Talks about family and home", ageGroup: "2-3y", description: "Shares everyday experiences." },
            { name: "Describes community roles", ageGroup: "4-5y", description: "Doctors, fire-fighters, shopkeepers." },
          ],
        },
        {
          name: "The natural world",
          ageGroup: "1-2y",
          milestones: [
            { name: "Reacts to outdoor sounds", ageGroup: "0-1y", description: "Birds, wind, rain outside." },
            { name: "Explores natural materials", ageGroup: "1-2y", description: "Leaves, sand, water play." },
            { name: "Notices weather and seasons", ageGroup: "2-3y", description: "'It's raining', 'The leaves fell down'." },
            { name: "Cares for plants and animals", ageGroup: "4-5y", description: "Watering plants, observing bugs." },
          ],
        },
      ],
    },
    {
      name: "Expressive Arts & Design",
      learningPoints: [
        {
          name: "Creating with materials",
          ageGroup: "1-2y",
          milestones: [
            { name: "Explores paint and textures", ageGroup: "0-1y", description: "Finger painting and sensory trays." },
            { name: "Glues and sticks collage pieces", ageGroup: "1-2y", description: "Making simple pictures." },
            { name: "Makes models with play dough", ageGroup: "2-3y", description: "Rolling, squashing and joining." },
            { name: "Creates art with intent", ageGroup: "4-5y", description: "Plans and reviews their own creations." },
          ],
        },
        {
          name: "Being imaginative",
          ageGroup: "1-2y",
          milestones: [
            { name: "Responds to music and song", ageGroup: "0-1y", description: "Waves arms, bounces, smiles." },
            { name: "Pretends with objects", ageGroup: "1-2y", description: "Feeds a teddy or rocks a doll." },
            { name: "Takes on simple roles in play", ageGroup: "2-3y", description: "Cooking in the home corner." },
            { name: "Creates and performs stories", ageGroup: "4-5y", description: "Imagines settings and characters." },
          ],
        },
      ],
    },
  ],
};