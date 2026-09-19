import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import {
  getChild,
  listContacts,
  listRooms,
  reportFor,
  incidentsForChild,
  todayStatus,
  statusesForChild,
  observationsForChild,
  listChildBilling,
  listMedia,
  listConsents,
} from "@/lib/store";
import {
  saveDailyReportAction,
  updateChildDetailsAction,
  addContactAction,
  createIncidentAction,
  saveChildStatusAction,
  uploadPhotoAction,
  acknowledgeIncidentAction,
} from "@/lib/actions";
import Avatar from "@/components/Avatar";
import MediaDownloadAll from "@/components/MediaDownloadAll";
import { getBranding } from "@/lib/theme";
import { firstInstituteId, fmtDate, cap } from "@/lib/helpers";
import ChildProfileTabs from "@/components/ChildProfileTabs";
import { curriculumTree, ensureCurriculumSeeded } from "@/lib/curriculum";
import ObservationModalTrigger from "@/components/ObservationModalTrigger";
import { queryGet } from "@/lib/db";

export const dynamic = "force-dynamic";

const MOODS = [
  ["happy", "Happy"],
  ["okay", "Okay"],
  ["fussy", "Fussy"],
  ["tired", "Tired"],
] as const;
const DIAPERS = [
  ["wet", "Wet"],
  ["soiled", "Soiled"],
  ["dry", "Dry check"],
] as const;
const SLEEP_VALUES = ["Fell asleep", "Woke up"];
const SICK_VALUES = ["yes", "no"];

export default async function PortalChildPage({ params }: { params: { id: string } }) {
  const session = requireSession();
  const child = await getChild(params.id);
  if (!child) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const iid = await firstInstituteId();
  const [report, contacts, incidents, status, todayStatuses, observations, billing, media, consents, rooms] =
    await Promise.all([
      reportFor(child.id, today),
      listContacts(child.id),
      incidentsForChild(child.id),
      todayStatus(child.id),
      statusesForChild(child.id, today),
      observationsForChild(child.id),
      listChildBilling(child.id),
      iid ? listMedia(iid, child.id) : Promise.resolve([]),
      iid ? listConsents(iid) : Promise.resolve([]),
      iid ? listRooms(iid) : Promise.resolve([]),
    ]);
  const meal = safeJson(report?.meal);
  const branding = await getBranding();
  try {
    await ensureCurriculumSeeded();
  } catch {}
  let areas: any[] = [];
  try {
    areas = await curriculumTree();
  } catch {
    areas = [];
  }

  const me = await queryGet("SELECT full_name, email FROM account WHERE id = ?", session.accountId);
  const byName = String(me?.full_name ?? me?.email ?? session.accountId);

  const tabs = [
    {
      id: "daily",
      label: "Daily report",
      node: dailyReportTab(child, report, today, todayStatuses),
    },
    {
      id: "about",
      label: "About",
      node: aboutTab(child, status, rooms),
    },
    {
      id: "family",
      label: "Family",
      node: contactsTab(child, contacts),
    },
    {
      id: "media",
      label: "Media",
      node: mediaTab(media),
    },
    {
      id: "documents",
      label: "Documents",
      node: documentsTab(consents),
    },
    {
      id: "schedules",
      label: "Schedules (Beta)",
      node: schedulesTab(child),
    },
    {
      id: "invoices",
      label: "Invoices",
      node: invoicesTab(child, billing),
    },
    {
      id: "learning",
      label: "Learning",
      node: learningTab(child, areas, observations, byName),
    },
    {
      id: "incident",
      label: "Incident & Accident",
      node: incidentsTab(child, incidents),
    },
  ];

  return (
    <div>
      <Link className="small muted" href="/portal/children">← Children</Link>
      <div className="row" style={{ alignItems: "center", gap: 14, marginTop: 8 }}>
        <Avatar src={child.photo_url} name={`${child.first_name} ${child.last_name}`} size={56} color={branding.primaryColor} />
        <div style={{ flex: 1 }}>
          <h1 className="title mt-1" style={{ marginBottom: 0 }}>{child.first_name} {child.last_name}</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            Room: {child.room_name ?? "—"} · {child.dob ? `DOB ${fmtDate(child.dob)}` : ""}{child.gender ? ` · ${cap(child.gender)}` : ""} · Today:{" "}
            {status.lastEvent ? cap(status.lastEvent.type) : "not reported yet"}
          </p>
        </div>
        <form action={uploadPhotoAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="hidden" name="entityType" value="child" />
          <input type="hidden" name="entityId" value={child.id as string} />
          <input type="file" name="file" accept="image/*" required id={`photo-${child.id}`} style={{ display: "none" }} />
          <label htmlFor={`photo-${child.id}`} className="btn btn-ghost" style={{ cursor: "pointer", fontSize: 13 }}>{child.photo_url ? "Change photo" : "Add photo"}</label>
          <button className="btn btn-primary" type="submit" style={{ fontSize: 13 }}>Save</button>
        </form>
        <Link href={`/portal/children/${child.id}/development`} className="btn btn-ghost" style={{ fontSize: 13 }}>Development</Link>
      </div>
      <div style={{ marginTop: 18 }}>
        <ChildProfileTabs tabs={tabs} />
      </div>
    </div>
  );
}

function dailyReportTab(child: any, report: any, today: string, todayStatuses: any[]) {
  const meal = safeJson(report?.meal);
  return (
    <div>
      <div className="card mb-4">
        <h3 className="subtitle">Today&apos;s daily report</h3>
        {report?.saved_by_name && (
          <p className="small muted" style={{ marginTop: -4 }}>
            Last saved by <strong>{report.saved_by_name}</strong>
            {report?.created_at ? ` · ${fmtDate(report.created_at)} ${time(report.created_at)}` : ""}
          </p>
        )}
        <form action={saveDailyReportAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <input type="hidden" name="reportDate" value={today} />
          <div className="field">
            <label className="label">Summary</label>
            <textarea className="textarea" name="summary" defaultValue={String(report?.summary ?? "")} />
          </div>
          <div className="row">
            <div className="col field"><label className="label">Mood</label>
              <select className="select" name="mood" defaultValue={String(report?.mood ?? "")}>
                <option value="">—</option>
                <option>Happy</option><option>Okay</option><option>Fussy</option><option>Tired</option>
              </select>
            </div>
            <div className="col field"><label className="label">Sleep</label><input className="input" name="sleep" defaultValue={String(report?.sleep ?? "")} placeholder="12:30-14:00" /></div>
            <div className="col field"><label className="label">Diaper</label><input className="input" name="diaper" defaultValue={String(report?.diaper ?? "")} /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">Breakfast</label><input className="input" name="breakfast" defaultValue={String(meal?.breakfast ?? "")} /></div>
            <div className="col field"><label className="label">Lunch</label><input className="input" name="lunch" defaultValue={String(meal?.lunch ?? "")} /></div>
            <div className="col field"><label className="label">Snack</label><input className="input" name="snack" defaultValue={String(meal?.snack ?? "")} /></div>
          </div>
          <div className="field"><label className="label">Observation (learning note)</label><textarea className="textarea" name="observation" defaultValue={String(report?.observation ?? "")} /></div>
          <div className="field"><label className="label">Note</label><input className="input" name="note" defaultValue={String(report?.note ?? "")} /></div>
          <label className="row" style={{ alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="sick" defaultChecked={!!report?.sick} /> <span>Mark as sick</span>
          </label>
          <div className="mt-3"><button className="btn btn-primary" type="submit">Save report</button></div>
        </form>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">Status log</h3>
        <p className="small muted">Logged instantly with the current time — multiple entries per day.</p>
        <div className="row mt-2">
          <div className="col">
            <div className="label">Mood</div>
            <div className="row" style={{ gap: 6 }}>
              {MOODS.map(([value, label]) => (
                <form key={value} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="mood" />
                  <input type="hidden" name="value" value={value} />
                  <button className="status-chip status-chip-mood" type="submit">{label}</button>
                </form>
              ))}
            </div>
          </div>
          <div className="col">
            <div className="label">Diaper</div>
            <div className="row" style={{ gap: 6 }}>
              {DIAPERS.map(([value, label]) => (
                <form key={value} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="diaper" />
                  <input type="hidden" name="value" value={value} />
                  <button className="status-chip status-chip-diaper" type="submit">{label}</button>
                </form>
              ))}
            </div>
          </div>
          <div className="col">
            <div className="label">Sleep</div>
            <div className="row" style={{ gap: 6 }}>
              {SLEEP_VALUES.map((label) => (
                <form key={label} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="sleep" />
                  <input type="hidden" name="value" value={label} />
                  <button className="status-chip status-chip-sleep" type="submit">{label}</button>
                </form>
              ))}
            </div>
          </div>
          <div className="col">
            <div className="label">Sick</div>
            <div className="row" style={{ gap: 6 }}>
              {SICK_VALUES.map((label) => (
                <form key={label} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="sick" />
                  <input type="hidden" name="value" value={label} />
                  <button className="status-chip status-chip-sick" type="submit">{label === "yes" ? "Feeling sick" : "All good"}</button>
                </form>
              ))}
            </div>
          </div>
        </div>

        <form action={saveChildStatusAction} className="row mt-3" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="col field">
            <label className="label">Custom entry</label>
            <div className="row">
              <select className="select" name="kind" defaultValue="mood" style={{ maxWidth: 130 }}>
                <option value="mood">Mood</option>
                <option value="diaper">Diaper</option>
                <option value="sleep">Sleep</option>
                <option value="sick">Sick</option>
              </select>
              <input className="input" name="value" required placeholder="e.g. 'Rash on arm' or '12:45-13:30'" />
            </div>
          </div>
          <div className="col field"><label className="label">Note</label><input className="input" name="note" placeholder="optional" /></div>
          <div><button className="btn btn-ghost" type="submit">Log status</button></div>
        </form>

        {todayStatuses.length === 0 ? (
          <p className="muted small mt-3">No status entries yet today.</p>
        ) : (
          <div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {todayStatuses.map((s: any) => (
              <div className="list-item small" key={s.id}>
                <span className={`status-chip status-chip-${String(s.kind)}`}>{cap(s.kind)}</span>
                <div>
                  <strong>{displayValue(String(s.kind), String(s.value))}</strong>
                  {s.note ? <span className="muted"> — {s.note}</span> : null}
                </div>
                <span className="muted">{time(s.recorded_at)}{s.recorded_by_name ? ` · ${s.recorded_by_name}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function aboutTab(child: any, status: any, rooms: any[]) {
  const rows: [string, string][] = [
    ["Full name", `${child.first_name} ${child.last_name}`],
    ["Date of birth", child.dob ? fmtDate(child.dob) : "—"],
    ["Gender", child.gender ? cap(child.gender) : "—"],
    ["Room", child.room_name ?? "—"],
    ["Enrolled", child.enrolled_at ? fmtDate(child.enrolled_at) : "—"],
    ["Status", child.status ? cap(String(child.status)) : "Active"],
    ["Check-in today", status.lastEvent ? cap(status.lastEvent.type) : "Not yet"],
  ];
  return (
    <div className="grid">
      <div className="card">
        <h3 className="subtitle">About {child.first_name}</h3>
        <table className="table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="muted" style={{ width: 180 }}>{k}</td>
                <td><strong>{v}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link className="btn btn-ghost small mt-3" href={`/portal/children/${child.id}/development`}>Log learning &amp; development →</Link>
      </div>
      <div className="card">
        <h3 className="subtitle">Edit details</h3>
        <form action={updateChildDetailsAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="row">
            <div className="col field"><label className="label">First name</label><input className="input" name="firstName" defaultValue={String(child.first_name ?? "")} required /></div>
            <div className="col field"><label className="label">Last name</label><input className="input" name="lastName" defaultValue={String(child.last_name ?? "")} required /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">Date of birth</label><input className="input" name="dob" type="date" defaultValue={child.dob ? String(child.dob).slice(0, 10) : ""} /></div>
            <div className="col field"><label className="label">Gender</label>
              <select className="select" name="gender" defaultValue={String(child.gender ?? "")}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>
          <div className="field"><label className="label">Room</label>
            <select className="select" name="roomId" defaultValue={String(child.room_id ?? "")}>
              <option value="">—</option>
              {(rooms as any[]).map((r: any) => (
                <option key={r.id} value={String(r.id)}>{r.name}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Save changes</button>
        </form>
      </div>
    </div>
  );
}

function contactsTab(child: any, contacts: any[]) {
  return (
    <div className="grid">
      <div className="card">
        <h3 className="subtitle">Pickup &amp; family contacts</h3>
        {contacts.length === 0 ? <p className="muted small">None.</p> : null}
        {contacts.map((c: any) => (
          <div className="list-item" key={c.id}>
            <div className="small"><strong>{c.full_name}</strong> ({c.relationship})<br /><span className="muted">{c.phone}</span>{c.email ? <><br /><span className="muted">{c.email}</span></> : null}</div>
            <div>{c.is_pickup && <span className="badge">Pickup</span>}{c.is_emergency && <span className="badge badge-red">Emerg</span>}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="subtitle">Add contact</h3>
        <form action={addContactAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="field"><label className="label">Full name</label><input className="input" name="fullName" required /></div>
          <div className="field"><label className="label">Relationship</label><input className="input" name="relationship" required /></div>
          <div className="field"><label className="label">Phone</label><input className="input" name="phone" /></div>
          <div className="field"><label className="label">Email</label><input className="input" name="email" /></div>
          <label className="row small" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" name="isPickup" /> Authorized pickup</label>
          <label className="row small mt-2" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" name="isEmergency" /> Emergency contact</label>
          <div className="mt-3"><button className="btn btn-ghost" type="submit">Add contact</button></div>
        </form>
      </div>
    </div>
  );
}

function mediaTab(media: any[]) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="subtitle">Media ({media.length})</h3>
        <MediaDownloadAll files={(media as any[]).map((m: any) => ({ url: String(m.url), caption: String(m.caption ?? "") }))} />
      </div>
      {media.length === 0 ? <p className="muted small">No photos or media yet — add them from the Check-in flow or newsfeed.</p> : null}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {media.map((m: any) => (
          <a key={m.id} href={m.url} target="_blank" rel="noreferrer" style={{ display: "block", width: 120, height: 120, borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)" }}>
            <img src={m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </a>
        ))}
      </div>
    </div>
  );
}

function documentsTab(consents: any[]) {
  return (
    <div className="card">
      <h3 className="subtitle">Signed documents &amp; consents</h3>
      {consents.length === 0 ? <p className="muted small">No documents yet.</p> : null}
      {consents.map((c: any) => (
        <div className="list-item small" key={c.id}>
          <div><strong>{c.title}</strong><br /><span className="muted">{fmtDate(c.created_at)} — {c.description ?? ""}</span></div>
          <span className="badge badge-green">{c.consentee_name ? `Signed · ${c.consentee_name}` : cap(c.status ?? "open")}</span>
        </div>
      ))}
    </div>
  );
}

function schedulesTab(child: any) {
  return (
    <div className="card">
      <h3 className="subtitle">Schedules <span className="badge badge-gray">Beta</span></h3>
      <p className="muted small">Daycare schedules (daily routine, nap times, feeding plan) for {child.first_name} ship in a beta iteration. Room routines already follow the daily report above.</p>
    </div>
  );
}

function invoicesTab(child: any, billing: any[]) {
  const totals = billing.reduce((acc: any, b: any) => acc + Number(b.amount ?? 0), 0);
  const overdue = billing.filter((b: any) => b.status === "overdue").length;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="subtitle">Invoices</h3>
        <Link href={`/portal/children/${child.id}/billing`} className="btn btn-accent small">Manage billing</Link>
      </div>
      <p className="small">
        <strong>{billing.length}</strong> invoices · total <strong>AED {totals.toFixed(2)}</strong> · {overdue} overdue
      </p>
      {billing.length === 0 ? <p className="muted small">No invoices yet.</p> : null}
      {billing.map((b: any) => (
        <div className="list-item small" key={b.id}>
          <div><strong>{b.period ?? "Invoice"}</strong><br /><span className="muted">{b.reference ?? b.id}</span></div>
          <div style={{ textAlign: "right" }}>
            <strong>AED {Number(b.amount ?? 0).toFixed(2)}</strong><br />
            <span className={`badge ${b.status === "paid" || b.status === "approved" ? "badge-green" : b.status === "overdue" ? "badge-red" : "badge-gray"}`}>{cap(b.status ?? "draft")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function learningTab(child: any, areas: any[], observations: any[], byName: string) {
  return (
    <div className="grid">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="subtitle">Learning history</h3>
          <Link className="btn btn-ghost small" href={`/portal/children/${child.id}/development`}>Full development →</Link>
        </div>
        {observations.length === 0 ? <p className="muted small">No observations yet.</p> : null}
        {observations.slice(0, 6).map((o: any) => (
          <div className="list-item small" key={o.id}>
            <div>
              <span className="badge">{cap(o.kind)}</span>{" "}
              <strong>{o.title ?? "Observation"}</strong>
              <span className="muted"> · {fmtDate(o.recorded_at ?? o.created_at)}</span>
              {o.milestone_name && <div className="mt-1"><span className="badge badge-green">{o.milestone_name}</span></div>}
              {o.body ? <div className="muted mt-1">{o.body}</div> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="subtitle">New observation</h3>
        <p className="small muted">Attach curriculum goals from the Egyptian kindergarten curriculum.</p>
        <ObservationModalTrigger
          children={[child]}
          areas={areas}
          byName={byName}
          defaultChildId={String(child.id)}
          trigger={<button type="button" className="btn btn-primary small">Log observation</button>}
        />
      </div>
    </div>
  );
}

function incidentsTab(child: any, incidents: any[]) {
  return (
    <div className="grid">
      <div className="card">
        <h3 className="subtitle">Incidents &amp; accidents</h3>
        {incidents.length === 0 ? <p className="muted small">None.</p> : null}
        {incidents.map((i: any) => (
          <div className="list-item small" key={i.id}>
            <div><strong>{cap(i.type)}</strong> — {new Date(i.created_at).toDateString()}<br /><span className="muted">{i.description}</span></div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>{i.acknowledged ? "Acked" : "Open"}</span>
              {!i.acknowledged && (
                <form action={acknowledgeIncidentAction}>
                  <input type="hidden" name="id" value={String(i.id)} />
                  <input type="hidden" name="portal" value="1" />
                  <button className="btn btn-ghost small" type="submit">Acknowledge</button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="subtitle">Log incident</h3>
        <form action={createIncidentAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="field"><label className="label">Type</label>
            <select className="select" name="type"><option value="incident">Incident</option><option value="accident">Accident</option></select>
          </div>
          <div className="field"><label className="label">Description</label><textarea className="textarea" name="description" required /></div>
          <button className="btn btn-danger" type="submit">Log incident</button>
        </form>
      </div>
    </div>
  );
}

function safeJson(v: unknown): Record<string, string> {
  if (!v) return {};
  try { return JSON.parse(String(v)); } catch { return {}; }
}
function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }
function time(v?: unknown): string {
  if (!v) return "—";
  return new Date(String(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function displayValue(kind: string, value: string): string {
  if (kind === "sick" && value === "yes") return "Feeling sick";
  if (kind === "sick" && value === "no") return "All good";
  return value.charAt(0).toUpperCase() + value.slice(1);
}