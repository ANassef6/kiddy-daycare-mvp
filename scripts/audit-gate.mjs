#!/usr/bin/env node
// KID-1176 (P2 hygiene): CI dependency-audit gate.
//
// Fails (exit 1) when `npm audit` reports any unresolved critical/high
// vulnerability that is not covered by a reviewed exception in
// scripts/audit-exceptions.json. Findings below high never fail the gate.
//
// Usage:
//   node scripts/audit-gate.mjs              # real gate (runs npm audit --json)
//   node scripts/audit-gate.mjs --self-test  # runs the logic against a fixture
//
// Exception lifecycle: every exception carries a reason, an approver and an
// expiry date. An expired exception that is still needed FAILS the gate with
// a renewal message instead of silently passing — exceptions must be actively
// re-reviewed, never forgotten.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exceptionsPath = path.join(root, "scripts", "audit-exceptions.json");

const FAIL_LEVELS = new Set(["critical", "high"]);

function loadExceptions() {
  try {
    const parsed = JSON.parse(readFileSync(exceptionsPath, "utf8"));
    return Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
  } catch (err) {
    console.error(`audit-gate: could not read ${exceptionsPath}: ${err.message}`);
    process.exit(1);
  }
}

const today = new Date().toISOString().slice(0, 10);

function checkExceptions(finding, exceptions) {
  const exceptionsForId = exceptions.filter((e) => e.id === finding.id);
  if (exceptionsForId.length === 0) return null;
  const active = exceptionsForId.find((e) => !e.expires || e.expires >= today);
  if (active) return active;
  return { expired: exceptionsForId[0] };
}

// findings: [{ id, package, severity, title, url }] — the flatten of npm
// audit --json vulnerabilities.
function evaluate(findings, exceptions) {
  const failures = [];
  const excepted = [];
  for (const f of findings) {
    if (!FAIL_LEVELS.has(f.severity)) continue;
    const exc = checkExceptions(f, exceptions);
    if (exc && exc.expired) {
      failures.push(
        `EXPIRED exception for ${f.id} (${f.package}, ${f.severity}) — ` +
        `expired ${exc.expired.expires}: ${exc.expired.reason}. ` +
        `Re-review and update scripts/audit-exceptions.json or remediate.`
      );
    } else if (exc) {
      excepted.push(f);
    } else {
      failures.push(
        `UNRESOLVED ${f.severity} vulnerability in ${f.package}: ${f.title} (${f.id}) — ` +
        `upgrade the package or add a reviewed, expiring exception in scripts/audit-exceptions.json.`
      );
    }
  }
  return { failures, excepted };
}

function flattenAuditReport(report) {
  const out = [];
  const vulns = report?.vulnerabilities ?? {};
  for (const [name, v] of Object.entries(vulns)) {
    for (const via of v.via ?? []) {
      if (typeof via === "object" && via?.id && via?.severity) {
        out.push({
          id: via.id,
          package: name,
          severity: String(via.severity).toLowerCase(),
          title: via.title ?? "",
          url: via.url ?? "",
        });
      }
    }
  }
  return out;
}

function run() {
  const exceptions = loadExceptions();

  if (process.argv.includes("--self-test")) {
    const fixture = [
      { id: "GHSA-TEST-HIGH", package: "example-pkg", severity: "high", title: "fixture high", url: "" },
      { id: "GHSA-TEST-EXC", package: "excepted-pkg", severity: "critical", title: "fixture critical", url: "" },
      { id: "GHSA-TEST-EXPIRED", package: "expired-pkg", severity: "high", title: "fixture expired", url: "" },
      { id: "GHSA-TEST-LOW", package: "low-pkg", severity: "low", title: "fixture low (never fails)", url: "" },
    ];
    const fixtureExceptions = [
      { id: "GHSA-TEST-EXC", package: "excepted-pkg", severity: "critical", reason: "reviewed demo exception", approvedBy: "self-test", expires: "2999-12-31" },
      { id: "GHSA-TEST-EXPIRED", package: "expired-pkg", severity: "high", reason: "reviewed but lapsed", approvedBy: "self-test", expires: "2000-01-01" },
    ];
    const { failures } = evaluate(fixture, fixtureExceptions);
    const failedHigh = failures.some((f) => f.includes("GHSA-TEST-HIGH"));
    const failedExpired = failures.some((f) => f.includes("GHSA-TEST-EXPIRED"));
    const passedExc = !failures.some((f) => f.includes("GHSA-TEST-EXC"));
    const passedLow = !failures.some((f) => f.includes("GHSA-TEST-LOW"));
    if (failedHigh && failedExpired && passedExc && passedLow) {
      console.log("audit-gate self-test: PASS (high fails, expired exception fails, reviewed exception passes, low passes)");
      return 0;
    }
    console.error("audit-gate self-test: FAIL", failures);
    return 1;
  }

  let report;
  try {
    const json = execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    report = JSON.parse(json);
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities exist; the JSON is on stdout.
    try {
      report = JSON.parse(err.stdout);
    } catch {
      console.error(`audit-gate: npm audit could not run: ${err.message}`);
      process.exit(1);
    }
  }

  const findings = flattenAuditReport(report);
  const { failures, excepted } = evaluate(findings, exceptions);

  if (excepted.length > 0) {
    for (const f of excepted) {
      console.log(`audit-gate: excepted (reviewed) — ${f.severity} ${f.id} in ${f.package}`);
    }
  }
  if (failures.length > 0) {
    console.error(`audit-gate: FAIL — ${failures.length} unresolved critical/high finding(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log("audit-gate: PASS — no unresolved critical/high dependency vulnerabilities.");
  return 0;
}

process.exit(run());
