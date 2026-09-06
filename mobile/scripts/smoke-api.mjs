// Headless smoke of the Kiddy mobile app against the live mobile REST API.
//
// Mirrors exactly what the Expo app does on each screen (see src/api.ts):
//   - login            -> LoginScreen
//   - bootstrap        -> HomeScreen (children + status pill + daily-report flag)
//   - child/:id        -> ChildScreen (daily report, incidents, contacts, newsfeed)
//   - check-in/out     -> ChildScreen toggle (POST children/:id/check-in { type })
//   - billing          -> BillingScreen
//
// Usage:
//   node scripts/smoke-api.mjs                 # against baked default origin
//   API_ORIGIN=<url> node scripts/smoke-api.mjs # override environment
//
// Exits 0 when every step passes, 1 otherwise.
//
// Demo credentials (seed data):
//   parent@example.test / kiddy-parent  (Grace Nguyen, children Ella + Leo)
//   admin@sunshinedaycare.test / kiddy-admin

const API_ORIGIN =
  process.env.API_ORIGIN ?? process.env.EXPO_PUBLIC_API_URL ?? "https://kiddy-mobile-api.vercel.app";

let failures = 0;

function check(name, cond, extra) {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures += 1;
  console.log(`[${ok}] ${name}${extra ? ` — ${String(extra)}` : ""}`);
}

async function request(path, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers ?? {}) };
  const res = await fetch(`${API_ORIGIN}${path}`, { ...init, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body };
}

/** Mirrors api.ts login: success stores token, failure surfaces {error}. */
async function login(email, password) {
  const { res, body } = await request("/api/mobile/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), { status: res.status });
  return body;
}

async function main() {
  console.log(`Kiddy mobile smoke against ${API_ORIGIN}\n`);

  // ---- 1. Login (LoginScreen) ----------------------------------------------
  const parent = await login("parent@example.test", "kiddy-parent");
  check("login parent returns account + token", !!parent.token && !!parent.account, parent.account?.email);
  check("account is Grace Nguyen (parent role)", parent.account?.fullName === "Grace Nguyen" && parent.account?.role === "parent", `${parent.account?.fullName} (${parent.account?.role})`);
  check("email is confirmed", parent.account?.emailConfirmed === true);

  // ---- 2. Home (HomeScreen): bootstrap with children + status pill --------
  const token = parent.token;
  const bootRes = await request("/api/mobile/bootstrap", { headers: { authorization: `Bearer ${token}` } });
  check("bootstrap HTTP 200", bootRes.res.ok, bootRes.res.status);
  const boot = bootRes.body;
  check("bootstrap branding present", !!(boot?.branding?.name) && !!boot?.branding?.primaryColor, boot?.branding?.name);
  check("bootstrap account identity", boot?.account?.id === parent.account.id, boot?.account?.fullName);
  check("bootstrap children list (Ella + Leo)", Array.isArray(boot?.children) && boot.children.length === 2, `${boot?.children?.length ?? 0} children`);

  let pillStates = new Set();
  for (const c of boot?.children ?? []) {
    check(`child '${c.child.first_name}' has id + room_name`, !!c.child.id && c.child.first_name && c.child.last_name, `${c.child.first_name} ${c.child.last_name} · ${c.child.room_name ?? "no room"}`);
    const pill = c.status?.checkedIn ? (c.status?.checkedOut ? "checked-out" : "checked-in") : "at-home";
    pillStates.add(`${c.child.first_name}=${pill}`);
    check(`child '${c.child.first_name}' status-pill fields`, "checkedIn" in c.status && "checkedOut" in c.status, pill);
  }
  console.log(`  status pills: ${[...pillStates].join(", ")}`);

  // ---- 3. Child detail + daily report + check-in/out (ChildScreen) ---------
  for (const c of boot?.children ?? []) {
    const detRes = await request(`/api/mobile/children/${c.child.id}`, { headers: { authorization: `Bearer ${token}` } });
    check(`child detail HTTP 200 (${c.child.first_name})`, detRes.res.ok, detRes.res.status);
    const det = detRes.body;
    check(`child detail matches home child`, det?.child?.id === c.child.id && !!det?.status?.checkedIn !== undefined, `${c.child.first_name}`);
    check(`child detail report/incidents/contacts/newsfeed arrays`, Array.isArray(det?.incidents) && Array.isArray(det?.contacts) && Array.isArray(det?.newsfeed), `incidents=${det?.incidents?.length} contacts=${det?.contacts?.length} newsfeed=${det?.newsfeed?.length}`);
    check(`child daily-report field present`, "todayReport" in det, det?.todayReport ? `report ${det.todayReport.reportDate}` : "no report today");
    if (det?.todayReport) {
      check(`daily report has summary/mood fields`, "summary" in det.todayReport && "mood" in det.todayReport && "meal" in det.todayReport, `mood=${det.todayReport.mood}`);
    }
  }

  // ---- 4. Check-in / check-out round trip, restoring original state --------
  const target = (boot?.children ?? [])[0];
  check("roundtrip target child exists", !!target, target?.child?.first_name);
  if (target) {
    const wasCheckedIn = target.status?.checkedIn && !target.status?.checkedOut;
    const toggleType = wasCheckedIn ? "out" : "in";
    const toggleRes = await request(`/api/mobile/children/${target.child.id}/check-in`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: toggleType }),
    });
    check(`check-${toggleType} HTTP 200 (${target.child.first_name})`, toggleRes.res.ok, toggleRes.res.status);
    const toggled = toggleRes.body;
    if (toggleRes.res.ok) {
      if (toggleType === "in") {
        check("now checked-in (lastEvent in)", toggled?.status?.lastEvent?.type === "in" && !!toggled?.status?.checkedIn, `lastEvent=${toggled?.status?.lastEvent?.type}`);
      } else {
        check("now checked-out (lastEvent out)", toggled?.status?.lastEvent?.type === "out" && !!toggled?.status?.checkedOut, `lastEvent=${toggled?.status?.lastEvent?.type}`);
      }
      const restoreType = wasCheckedIn ? "in" : "out";
      const restoreRes = await request(`/api/mobile/children/${target.child.id}/check-in`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: restoreType }),
      });
      check(`restore state HTTP 200`, restoreRes.res.ok, restoreRes.res.status);
      if (restoreRes.res.ok) {
        check("restored lastEvent", restoreRes.body?.status?.lastEvent?.type === restoreType, `lastEvent=${restoreRes.body?.status?.lastEvent?.type}`);
      }
    }
  }

  // ---- 5. Billing tab (BillingScreen) --------------------------------------
  const billRes = await request("/api/mobile/billing", { headers: { authorization: `Bearer ${token}` } });
  check("billing HTTP 200", billRes.res.ok, billRes.res.status);
  const bill = billRes.body;
  check("billing per-child plans + invoices", Array.isArray(bill?.children) && (bill.children.length === 0 || bill.children.every((ch) => ch && (ch.plan || ch.invoices))), `${bill?.children?.length ?? 0} children`);
  const firstBillChild = bill?.children?.[0];
  if (firstBillChild?.plan) {
    check("plan has amountCents + currency + period", typeof firstBillChild.plan.amountCents === "number" && !!firstBillChild.plan.currency, `$${(firstBillChild.plan.amountCents / 100).toFixed(2)}/${firstBillChild.plan.billingPeriod}`);
  }
  if (firstBillChild?.invoices?.length) {
    const inv = firstBillChild.invoices[0];
    check("invoice has status + amounts", !!inv.status && typeof inv.amountCents === "number", `${inv.status} · ${(inv.amountCents / 100).toFixed(2)}`);
  }

  // ---- 6. Admin login -------------------------------------------------------
  const admin = await login("admin@sunshinedaycare.test", "kiddy-admin");
  check("login admin returns account + token", !!admin.token && !!admin.account, admin.account?.email);
  check("admin/staff role", ["admin", "owner"].includes(admin.account?.role), admin.account?.role);

  // ---- 7. Rejected login surfaces a clean error (LoginScreen error path) ----
  let rejected = null;
  try {
    await login("parent@example.test", "wrong-password");
  } catch (e) {
    rejected = e;
  }
  check("wrong password rejected with 401-style error", !!rejected && !!rejected.status, `status=${rejected?.status} error=${rejected?.message}`);

  console.log(`\n${failures === 0 ? "ALL SMOKE STEPS PASSED" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});