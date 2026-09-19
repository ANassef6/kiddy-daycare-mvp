import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listTags, listChildren } from "@/lib/store";
import { firstInstituteId, fmtDate } from "@/lib/helpers";
import { createSmartListAction } from "@/lib/actions";
import SmartListColumns from "@/components/SmartListColumns";

export const dynamic = "force-dynamic";

const COLUMNS = ["Name", "DOB", "Age", "Gender", "Room", "Allergies"] as const;
const COL_KEYS: Record<string, string> = { Name: "name", DOB: "dob", Age: "age", Gender: "gender", Room: "room", Allergies: "allergies" };

export default async function PortalTagsPage({
  searchParams,
}: {
  searchParams: {
    list?: string;
    child?: string;
    gender?: string;
    maxAge?: string;
    roomId?: string;
    enrolledFrom?: string;
    cols?: string;
  };
}) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [tags, children, rooms] = await Promise.all([
    listTags(instituteId),
    listChildren(instituteId),
    (await import("@/lib/store")).listRooms(instituteId),
  ]);

  const builderName = searchParams.list ?? "Untitled list";
  const showing = Boolean(searchParams.list);

  const gender = searchParams.gender ?? "";
  const maxAge = searchParams.maxAge ?? "";
  const roomId = searchParams.roomId ?? "";
  const enrolledFrom = searchParams.enrolledFrom ?? "";
  const child = searchParams.child ?? "";
  const cols = (searchParams.cols ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c in COL_KEYS);

  const qs = new URLSearchParams({
    child,
    gender,
    maxAge,
    roomId,
    enrolledFrom,
    cols: cols.join(",") || "name,dob,age,gender,room,allergies",
  }).toString();

  let filtered = children;
  if (child) filtered = filtered.filter((c: any) => `${c.first_name} ${c.last_name}`.toLowerCase().includes(child.toLowerCase()));
  if (gender) filtered = filtered.filter((c: any) => String(c.gender ?? "").toLowerCase() === gender);
  if (roomId) filtered = filtered.filter((c: any) => String(c.room_id ?? "") === roomId);
  if (enrolledFrom) filtered = filtered.filter((c: any) => String(c.enrolled_at ?? "").slice(0, 10) >= enrolledFrom);
  if (maxAge) {
    const cutoff = Number(maxAge);
    filtered = filtered.filter((c: any) => {
      if (!c.dob) return false;
      return (Date.now() - new Date(c.dob).getTime()) / (365.25 * 24 * 3600 * 1000) < cutoff;
    });
  }

  return (
    <div>
      <h1 className="title">Smart Lists</h1>
      <p className="subtitle">Build reusable lists of children and export them — or manage saved lists below.</p>

      <div className="card mb-4">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="subtitle">Saved lists</h3>
            <p className="small muted">{tags.length} saved list{tags.length === 1 ? "" : "s"}</p>
          </div>
          <details>
            <summary className="btn btn-primary" style={{ cursor: "pointer", listStyle: "none" }}>+ Create a list</summary>
            <form action={createSmartListAction} className="mt-2 row" style={{ gap: 8, alignItems: "center" }}>
              <input className="input" name="name" required placeholder="List name (e.g. All babies, New families…)" style={{ minWidth: 260 }} />
              <button className="btn btn-primary small" type="submit">Save list</button>
            </form>
          </details>
        </div>

        <table className="data">
          <thead><tr><th>List name</th><th>Date created</th><th>Open</th></tr></thead>
          <tbody>
            {tags.length === 0 && <tr><td colSpan={3} className="muted small">No saved lists yet.</td></tr>}
            {tags.map((t: any) => (
              <tr key={t.id}>
                <td><span className="badge" style={{ background: t.color, color: "#fff" }}>{t.name}</span> <span className="muted small">· {t.child_count ?? 0} children</span></td>
                <td className="small">{t.created_at ? fmtDate(t.created_at) : "—"}</td>
                <td><Link className="btn btn-ghost small" href={`/portal/tags?list=${encodeURIComponent(t.name)}`}>Open builder</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Builder */}
      <div className="card mb-4">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="subtitle">Builder — {builderName}</h3>
          <a className="btn btn-primary small" href={`/api/export?type=children&${qs}`}>Download CSV</a>
        </div>
        <p className="small muted">Filters below apply to the children table and the download. Pick columns with “Add column”.</p>

        <form method="get" className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="list" value={builderName} />
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Name contains</label>
            <input className="input" name="child" defaultValue={child} placeholder="Child name…" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Gender</label>
            <select className="select" name="gender" defaultValue={gender}>
              <option value="">Any</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Room</label>
            <select className="select" name="roomId" defaultValue={roomId}>
              <option value="">Any</option>
              {rooms.map((r: any) => (<option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Max age (years)</label>
            <input className="input" type="number" step="0.5" name="maxAge" defaultValue={maxAge} placeholder="e.g. 2" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Enrolled after</label>
            <input className="input" type="date" name="enrolledFrom" defaultValue={enrolledFrom} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">Add column</label>
            <SmartListColumns cols={cols} qs={qs} builderName={builderName} />
          </div>
          <button className="btn btn-primary small" type="submit">Apply</button>
        </form>

        <div className="mt-3" style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
          <div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {cols.map((c) => (
                <span key={c} className="badge badge-gray">{c} <a href={`/portal/tags?${qs.replace(`cols=${encodeURIComponent(cols.join(","))}`, `cols=${encodeURIComponent(cols.filter((x) => x !== c).join(","))}`)}&list=${encodeURIComponent(builderName)}`} style={{ textDecoration: "none" }}>×</a></span>
              ))}
            </div>
            {showing && <p className="muted small mt-2">List “{builderName}” saved — reopen it anytime from Saved lists.</p>}
          </div>
          <div>
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>DOB / age</th>
                  <th>Gender</th>
                  <th>Room</th>
                  <th>Allergies</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={5} className="muted small">No children match these filters.</td></tr>}
                {filtered.map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/portal/children/${c.id}`} style={{ fontWeight: 700, color: "inherit" }}>{c.first_name} {c.last_name}</Link>
                      <div className="muted small">{ (c.tags ?? []).length ? c.tags.map((t: any) => t.name).join(", ") : "" }</div>
                    </td>
                    <td className="small">{c.dob ? fmtDate(c.dob) : "—"}{c.dob ? ` · ${Math.floor((Date.now() - new Date(c.dob).getTime()) / (365.25 * 24 * 3600 * 1000))}y` : ""}</td>
                    <td className="small">{c.gender ? String(c.gender).slice(0, 1).toUpperCase() + String(c.gender).slice(1) : "—"}</td>
                    <td className="small">{c.room_name ?? "—"}</td>
                    <td className="small">{c.allergies ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted mt-2">{filtered.length} child{filtered.length === 1 ? "" : "ren"} · columns: {cols.length ? cols.join(", ") : COLUMNS.map((c) => COL_KEYS[c]).join(", ")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}