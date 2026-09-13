// Curriculum data-layer tests (KID-43): starter-curriculum seeding, the
// structured JSON import format for the founder's real curriculum, and the
// point → age group → milestone observation cascade, all against the isolated
// SQLite mirror.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import {
  AGE_GROUPS,
  ageGroupForDob,
  createCurriculumArea,
  createLearningPoint,
  createMilestone,
  curriculumTree,
  ensureCurriculumSeeded,
  ingestCurriculum,
  listCurriculumAreas,
  listLearningPoints,
  listMilestones,
} from "@/lib/curriculum";
import { seedFixture, mustGet } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

function dobYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe("age-group derivation", () => {
  it("AGE_GROUPS covers the 0-5 age bands", () => {
    expect(AGE_GROUPS).toEqual(["0-1y", "1-2y", "2-3y", "3-4y", "4-5y"]);
  });

  it("maps a date of birth to the right age band", () => {
    expect(ageGroupForDob(dobYearsAgo(0))).toBe("0-1y");
    expect(ageGroupForDob(dobYearsAgo(1))).toBe("1-2y");
    expect(ageGroupForDob(dobYearsAgo(2))).toBe("2-3y");
    expect(ageGroupForDob(dobYearsAgo(3))).toBe("3-4y");
    expect(ageGroupForDob(dobYearsAgo(4))).toBe("4-5y");
  });

  it("returns empty for missing, invalid, or future dates", () => {
    expect(ageGroupForDob(null)).toBe("");
    expect(ageGroupForDob("")).toBe("");
    expect(ageGroupForDob("not-a-date")).toBe("");
    expect(ageGroupForDob("2999-01-01")).toBe("");
  });
});

describe("starter curriculum seeding (KID-43)", () => {
  it("seeds the seven EYFS-style areas on fixture setup", async () => {
    const areas = await listCurriculumAreas();
    expect(areas.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "Communication & Language",
        "Physical Development",
        "Personal, Social & Emotional Development",
        "Literacy",
        "Mathematics",
        "Understanding the World",
        "Expressive Arts & Design",
      ])
    );
  });

  it("seeds learning points and milestones within each area", async () => {
    const tree = await curriculumTree();
    const pd = tree.find((a) => a.name === "Physical Development")!;
    expect(pd).toBeDefined();
    expect(pd.learning_points.length).toBeGreaterThanOrEqual(2);
    const grossMotor = pd.learning_points.find((lp: any) => lp.name === "Gross motor");
    expect(grossMotor).toBeDefined();
    expect(grossMotor.milestones.length).toBeGreaterThanOrEqual(2);
    expect(grossMotor.milestones.map((m: any) => m.name)).toContain("Takes first independent steps");
  });

  it("every milestone pins an age band", async () => {
    const milestones = await mustGet("SELECT COUNT(*) AS c FROM curriculum_milestone");
    const unpinned = await mustGet(
      "SELECT COUNT(*) AS c FROM curriculum_milestone WHERE age_group NOT IN ('0-1y', '1-2y', '2-3y', '3-4y', '4-5y')"
    );
    expect(milestones.c).toBeGreaterThan(0);
    expect(unpinned.c).toBe(0);
  });

  it("ensureCurriculumSeeded is idempotent", async () => {
    const before = await mustGet("SELECT COUNT(*) AS c FROM curriculum_area");
    await ensureCurriculumSeeded();
    await ensureCurriculumSeeded();
    const after = await mustGet("SELECT COUNT(*) AS c FROM curriculum_area");
    expect(after.c).toBe(before.c);
  });

  it("curriculumTree returns areas each with learning_points and milestones", async () => {
    const tree = await curriculumTree();
    expect(tree.length).toBeGreaterThan(0);
    for (const area of tree) {
      expect(area.learning_points).toBeDefined();
      for (const lp of area.learning_points) {
        expect(lp.milestones).toBeDefined();
      }
    }
  });
});

describe("structured curriculum import (founder's real curriculum)", () => {
  it("ingests a fresh area, its points, and their milestones", async () => {
    await ingestCurriculum({
      areas: [
        {
          name: "Arabicity",
          learningPoints: [
            {
              name: "Storytelling circle",
              ageGroup: "3-4y",
              milestones: [
                { name: "Retells a familiar folk tale", ageGroup: "3-4y", description: "Sequences the beginning, middle and end." },
                { name: "Inventive play retellings", ageGroup: "4-5y", description: "Adapts stories with new characters." },
              ],
            },
          ],
        },
      ],
    });
    const area = await mustGet("SELECT * FROM curriculum_area WHERE name = 'Arabicity'");
    const points = await listLearningPoints({ areaId: String(area.id) });
    expect(points).toHaveLength(1);
    const milestones = await listMilestones({ learningPointId: String(points[0].id) });
    expect(milestones).toHaveLength(2);
    expect(milestones.map((m) => m.age_group)).toEqual(["3-4y", "4-5y"]);
  });

  it("re-importing the same content never duplicates or clobbers", async () => {
    const importPayload = {
      areas: [
        {
          name: "Mathematics",
          learningPoints: [
            {
              name: "Number",
              ageGroup: "2-3y",
              milestones: [{ name: "Counts objects to five", ageGroup: "2-3y" }],
            },
          ],
        },
      ],
    };
    await ingestCurriculum(importPayload);
    await ingestCurriculum(importPayload);
    const count = await mustGet("SELECT COUNT(*) AS c FROM curriculum_milestone WHERE name = 'Counts objects to five'");
    expect(count.c).toBe(1);
  });

  it("a milestone can derive its age band from its learning point", async () => {
    const area = await createCurriculumArea("Custom");
    const lp = await createLearningPoint({ areaId: String(area.id), name: "Noisy play", ageGroup: "1-2y" });
    await createMilestone({ learningPointId: String(lp.id), name: "Bangs a drum" });
    const ms = await mustGet("SELECT * FROM curriculum_milestone WHERE name = 'Bangs a drum'");
    expect(ms.age_group).toBe("1-2y");
  });
});

describe("observation cascade persistence (KID-43)", () => {
  let accountId: string;

  beforeEach(async () => {
    const admin = await mustGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");
    accountId = String(admin.id);
  });

  it("persists age group, learning point, and milestone on an observation", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const grossMotor = await mustGet(
      "SELECT lp.* FROM curriculum_learning_point lp JOIN curriculum_area a ON a.id = lp.area_id WHERE a.name = 'Physical Development' AND lp.name = 'Gross motor'"
    );
    const milestone = await mustGet(
      "SELECT * FROM curriculum_milestone WHERE learning_point_id = ? AND name = 'Takes first independent steps'",
      grossMotor.id
    );

    const obs = await store.createObservation({
      instituteId: inst.id,
      childId: child.id,
      accountId,
      kind: "milestone",
      title: "Solo steps",
      body: "Walked across the mat unaided.",
      ageGroup: "1-2y",
      learningPointId: String(grossMotor.id),
      milestoneId: String(milestone.id),
      recordedAt: "2026-09-10",
    });

    expect(obs.age_group).toBe("1-2y");
    expect(obs.learning_point_id).toBe(String(grossMotor.id));
    expect(obs.milestone_id).toBe(String(milestone.id));
  });

  it("listObservations joins the curriculum names for display", async () => {
    const inst = (await store.listInstitutes())[0];
    const rows = await store.listObservations(inst.id);
    const withCurriculum = rows.find((r) => r.learning_point_name)!;
    expect(withCurriculum).toBeDefined();
    expect(withCurriculum.area_name).toBe("Physical Development");
    expect(withCurriculum.milestone_name).toBe("Takes first independent steps");
  });

  it("observationsForChild returns the parent-facing curriculum fields", async () => {
    const inst = (await store.listInstitutes())[0];
    const rows = await store.listObservations(inst.id);
    const obs = rows.find((r) => r.learning_point_name)!;
    const childRows = await store.observationsForChild(String(obs.child_id));
    const match = childRows.find((r) => r.id === obs.id)!;
    expect(match).toBeDefined();
    expect(match.learning_point_name).toBe(obs.learning_point_name);
    expect(match.milestone_name).toBe(obs.milestone_name);
  });

  it("observations can still be created without curriculum fields (backwards compatible)", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const obs = await store.createObservation({
      instituteId: inst.id,
      childId: child.id,
      accountId,
      body: "Free-text note without curriculum links.",
    });
    expect(obs.age_group).toBeNull();
    expect(obs.learning_point_id).toBeNull();
    expect(obs.milestone_id).toBeNull();
  });
});