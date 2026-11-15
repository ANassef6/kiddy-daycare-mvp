import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDictionary, tr } from "@/lib/i18n";

const source = readFileSync(join(process.cwd(), "lib/actions.ts"), "utf8");

function actionBody(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("KID-2413 bug 7: server-side validation for forms and incidents", () => {
  it("createFormAction rejects an empty title before createForm", () => {
    const body = actionBody("createFormAction");
    const guard = body.indexOf("if (!title)");
    const create = body.indexOf("await createForm(");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(create);
    expect(body.slice(guard, create)).toContain("error=formTitle");
  });

  it("createIncidentAction rejects an empty description before createIncident", () => {
    const body = actionBody("createIncidentAction");
    const guard = body.indexOf("if (!description)");
    const create = body.indexOf("await createIncident(");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(create);
    expect(body.slice(guard, create)).toContain("error=incidentDescription");
  });

  it("the rejection messages exist in both dictionaries", () => {
    for (const locale of ["en", "ar"] as const) {
      const dict = getDictionary(locale);
      expect(tr(dict, "forms.errorTitleRequired")).not.toMatch(/MISSING|^forms\./);
      expect(tr(dict, "profile.incidentDescriptionRequired")).not.toMatch(/MISSING|^profile\./);
    }
  });
});
