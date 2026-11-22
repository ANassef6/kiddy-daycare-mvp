import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listTags, listChildren } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createSmartListAction } from "@/lib/actions";
import SmartListColumns from "@/components/SmartListColumns";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, fmtDateFor } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const COLUMNS: Record<string, string> = { name: "common.name", dob: "smartList.colDob", age: "smartList.colAge", gender: "profile.gender", room: "common.room", allergies: "smartList.colAllergies" };
const COL_KEYS: Record<string, string> = { Name: "name", DOB: "dob", Age: "age", Gender: "gender", Room: "room", Allergies: "allergies" };

export default async function PortalTagsPage(
  props: {
    searchParams: Promise<{
      list?: string;
      child?: string;
      gender?: string;
      maxAge?: string;
      roomId?: string;
      enrolledFrom?: string;
      cols?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const { dict, locale } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "smartList.noInstitute")}</p>;
  // KID-103: smart lists respect classroom scoping.
  const [tags, children, rooms] = await Promise.all([
    listTags(instituteId),
    listChildren(instituteId, { accountId: session.accountId }),
    (await import("@/lib/store")).listRoomsScoped(instituteId, session.accountId),
  ]);

  const COLUMN_LABELS: Record<string, string> = {
    name: tr(dict, "common.name"),
    dob: tr(dict, "smartList.colDob"),
    age: tr(dict, "smartList.colAge"),
    gender: tr(dict, "profile.gender"),
    room: tr(dict, "common.room"),
    allergies: tr(dict, "smartList.colAllergies"),
  };

  const builderName = searchParams.list ?? tr(dict, "smartList.untitledList");
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
      <h1 className="title">{tr(dict, "smartList.title")}</h1>
      <p className="subtitle">{tr(dict, "smartList.subtitle")}</p>

      <div className="card mb-4">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="subtitle">{tr(dict, "smartList.savedLists")}</h3>
            <p className="small muted">{tr(dict, "smartList.savedCount", { count: tags.length })}</p>
          </div>
          <details>
            <summary className="btn btn-primary" style={{ cursor: "pointer", listStyle: "none" }}>{tr(dict, "smartList.createListBtn")}</summary>
            <form action={createSmartListAction} className="mt-2 row" style={{ gap: 8, alignItems: "center" }}>
              <input className="input" name="name" required placeholder={tr(dict, "smartList.listNamePlaceholder")} style={{ minWidth: 260 }} />
              <button className="btn btn-primary small" type="submit">{tr(dict, "smartList.saveListBtn")}</button>
            </form>
          </details>
        </div>

        <table className="data">
          <thead><tr><th>{tr(dict, "smartList.colListName")}</th><th>{tr(dict, "smartList.colDateCreated")}</th><th>{tr(dict, "smartList.colOpen")}</th></tr></thead>
          <tbody>
            {tags.length === 0 && <tr><td colSpan={3} className="muted small">{tr(dict, "smartList.emptySavedLists")}</td></tr>}
            {tags.map((t: any) => (
              <tr key={t.id}>
                <td><span className="badge" style={{ background: t.color, color: "#fff" }}>{t.name}</span> <span className="muted small">{tr(dict, "smartList.childrenCountSuffix", { count: t.child_count ?? 0 })}</span></td>
                <td className="small">{t.created_at ? fmtDateFor(locale, t.created_at) : "—"}</td>
                <td><Link className="btn btn-ghost small" href={`/portal/tags?list=${encodeURIComponent(t.name)}`}>{tr(dict, "smartList.openBuilderBtn")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Builder */}
      <div className="card mb-4">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="subtitle">{tr(dict, "smartList.builderHeading", { name: builderName })}</h3>
          <a className="btn btn-primary small" href={`/api/export?type=children&${qs}`}>{tr(dict, "smartList.downloadCsvBtn")}</a>
        </div>
        <p className="small muted">{tr(dict, "smartList.builderHint")}</p>

        <form method="get" className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="list" value={builderName} />
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "smartList.fNameLabel")}</label>
            <input className="input" name="child" defaultValue={child} placeholder={tr(dict, "smartList.fNamePlaceholder")} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "profile.gender")}</label>
            <select className="select" name="gender" defaultValue={gender}>
              <option value="">{tr(dict, "smartList.anyOption")}</option>
              <option value="female">{tr(dict, "profile.female")}</option>
              <option value="male">{tr(dict, "profile.male")}</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "common.room")}</label>
            <select className="select" name="roomId" defaultValue={roomId}>
              <option value="">{tr(dict, "smartList.anyOption")}</option>
              {rooms.map((r: any) => (<option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "smartList.fMaxAgeLabel")}</label>
            <input className="input" type="number" step="0.5" name="maxAge" defaultValue={maxAge} placeholder={tr(dict, "smartList.fMaxAgePlaceholder")} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "smartList.fEnrolledAfterLabel")}</label>
            <input className="input" type="date" name="enrolledFrom" defaultValue={enrolledFrom} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "smartList.addColumnLabel")}</label>
            <SmartListColumns
              cols={cols}
              qs={qs}
              builderName={builderName}
              labels={{ addColumnOption: tr(dict, "smartList.addColumnOption"), columns: COLUMN_LABELS }}
            />
          </div>
          <button className="btn btn-primary small" type="submit">{tr(dict, "smartList.apply")}</button>
        </form>

        <div className="mt-3 tags-layout" style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
          <div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {cols.map((c) => (
                <span key={c} className="badge badge-gray">{c} <a href={`/portal/tags?${qs.replace(`cols=${encodeURIComponent(cols.join(","))}`, `cols=${encodeURIComponent(cols.filter((x) => x !== c).join(","))}`)}&list=${encodeURIComponent(builderName)}`} style={{ textDecoration: "none" }}>×</a></span>
              ))}
            </div>
            {showing && <p className="muted small mt-2">{tr(dict, "smartList.savedConfirm", { name: builderName })}</p>}
          </div>
          <div>
            <table className="data">
              <thead>
                <tr>
                  <th>{tr(dict, "common.name")}</th>
                  <th>{tr(dict, "smartList.colDobAge")}</th>
                  <th>{tr(dict, "profile.gender")}</th>
                  <th>{tr(dict, "common.room")}</th>
                  <th>{tr(dict, "smartList.colAllergies")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={5} className="muted small">{tr(dict, "smartList.emptyFiltered")}</td></tr>}
                {filtered.map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/portal/children/${c.id}`} style={{ fontWeight: 700, color: "inherit" }}>{c.first_name} {c.last_name}</Link>
                      <div className="muted small">{ (c.tags ?? []).length ? c.tags.map((t: any) => t.name).join(", ") : "" }</div>
                    </td>
                    <td className="small">{c.dob ? fmtDateFor(locale, c.dob) : "—"}{c.dob ? ` · ${tr(dict, "smartList.ageYears", { years: Math.floor((Date.now() - new Date(c.dob).getTime()) / (365.25 * 24 * 3600 * 1000)) })}` : ""}</td>
                    <td className="small">{String(c.gender ?? "").toLowerCase() === "male" ? tr(dict, "profile.male") : String(c.gender ?? "").toLowerCase() === "female" ? tr(dict, "profile.female") : c.gender ? String(c.gender) : "—"}</td>
                    <td className="small">{c.room_name ?? "—"}</td>
                    <td className="small">{c.allergies ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted mt-2">{tr(dict, "smartList.resultCount", { count: filtered.length, cols: cols.length ? cols.map((c) => COLUMN_LABELS[COL_KEYS[c]] ?? c).join(", ") : Object.values(COLUMNS).map((p) => tr(dict, p)).join(", ") })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}