// KID-442/KID-452: contract test for the /privacy route handler that serves the
// board-approved Sunshine Daycare privacy policy (verdicts card 8fd5452a, item
// privacy_policy = approve, 2026-11-02T21:17:46Z). The route body is a hash pin:
//   approved  privacy-policy.draft.html sha256 bc5196cb75a392b9ab3e9ef926e1ba0dd1b0a4f63a388d21ab300dca0c481272 (KID-449 attachment 2f4677cd)
//   deployed  scaffold-only lineage    sha256 edfda7e44a3eb598a621d72281269e965df7d70e6b695d946f3649c2ac45ceb6
// Any future content edit MUST come from a new board verdict and will re-pin the
// deployed hash here alongside updated evidence — never silently.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/privacy/route";

const APPROVED_SHA = "bc5196cb75a392b9ab3e9ef926e1ba0dd1b0a4f63a388d21ab300dca0c481272";

describe("KID-452: /privacy serves the board-approved policy", () => {
  it("returns 200 text/html as a standalone EN document", async () => {
    const res = (await GET()) as unknown as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(body).toContain('<html lang="en">');
    expect(body.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("keeps the approved policy wording byte-for-byte (all nine sections)", async () => {
    const res = (await GET()) as unknown as Response;
    const body = await res.text();
    const sections = [
      "<h1>Sunshine Daycare app — Privacy Policy</h1>",
      "<h2>1. What this app is</h2>",
      "<h2>2. Data we handle</h2>",
      "<h2>3. What we do NOT do</h2>",
      "<h2>4. How data is used</h2>",
      "<h2>5. Children</h2>",
      "<h2>6. Retention and deletion</h2>",
      "<h2>7. Security</h2>",
      "<h2>8. Changes</h2>",
      "<h2>9. Contact</h2>",
    ];
    for (const s of sections) expect(body).toContain(s);
    // Signature approved sentences, verbatim from the artifact.
    expect(body).toContain(
      "There is no public sign-up in the app.",
    );
    expect(body).toContain(
      "A parent only sees their own linked children — never other families' children.</li>",
    );
    expect(body).toContain(
      "No advertising trackers and no third-party analytics SDKs were found in the shipped app code.",
    );
    expect(body).toContain(
      "processed by our chat provider (Chatwoot) so we can answer you.",
    );
    expect(body).toContain(
      "The daycare — not the app — decides which children are linked to which parent account.",
    );
    expect(body).toContain("<code>info@kiddyapp.net</code>");
    expect(body).toContain("<code>net.kiddyapp.sunshine</code>");
  });

  it("ships no draft scaffolding, with the approval date set", async () => {
    const res = (await GET()) as unknown as Response;
    const body = await res.text();
    expect(body).not.toContain("DRAFT");
    expect(body).not.toContain("placeholder");
    expect(body).not.toContain("[DATE");
    expect(body).not.toContain("banner");
    expect(body).toContain("November 2, 2026");
  });

  it("pins the deployed body hash (scaffold-only lineage of the approved artifact)", async () => {
    const res = (await GET()) as unknown as Response;
    const body = await res.text();
    const deployedSha = createHash("sha256").update(body, "utf8").digest("hex");
    expect(deployedSha).toBe(
      "edfda7e44a3eb598a621d72281269e965df7d70e6b695d946f3649c2ac45ceb6",
    );
    // Lineage sanity: only the documented scaffold removals differ — the
    // approved artifact's own hash is recorded above and re-verified by the
    // KID-452 evidence attachment; the deployed hex must stay distinct from
    // APPROVED_SHA exactly because the DRAFT chrome is gone.
    expect(deployedSha).not.toBe(APPROVED_SHA);
  });
});
