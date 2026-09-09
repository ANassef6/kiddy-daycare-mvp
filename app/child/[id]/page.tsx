import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import {
  getChild,
  todayStatus,
  reportFor,
  listContacts,
  newsfeedForChild,
  incidentsForChild,
  statusesForChild,
} from "@/lib/store";
import { CheckInButton } from "@/components/CheckInButton";

export const dynamic = "force-dynamic";

export default async function ChildDetailPage({ params }: { params: { id: string } }) {
  const session = requireSession();
  const child = await getChild(params.id);
  if (!child) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const status = await todayStatus(child.id);
  const checkedIn = !!status.checkedIn && !status.checkedOut;
  const [report, contacts, feed, incidents, statuses] = await Promise.all([
    reportFor(child.id, today),
    listContacts(child.id),
    newsfeedForChild(child.id),
    incidentsForChild(child.id),
    statusesForChild(child.id, today),
  ]);

  const meal = safeJson(report?.meal);
  const sleep = report?.sleep ? String(report.sleep) : "";

  return (
    <div>
      <Link className="small muted" href="/child">← My children</Link>

      <div className="card mt-3">
        <div className="status-card">
          <div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>
              {child.first_name} {child.last_name}
            </div>
            <div className="muted small">{child.dob ?? "No DOB"} · {child.room_name ?? "No room"}</div>
          </div>
          {checkedIn ? (
            <span className="badge badge-green">Checked in</span>
          ) : (
            <span className="badge">Not checked in yet</span>
          )}
        </div>

        <div className="mt-4">
          <CheckInButton childId={child.id as string} checkedIn={checkedIn} />
        </div>

        {status.lastEvent && (
          <p className="muted small mt-2">
            {status.checkedIn && `Checked in at ${time(status.checkedIn.recorded_at)}`}
            {status.checkedIn && status.checkedOut && " · "}
            {status.checkedOut && `Checked out at ${time(status.checkedOut.recorded_at)}`}
          </p>
        )}
      </div>

      <h2 className="title mt-5">Today&apos;s updates</h2>
      {statuses.length === 0 ? (
        <p className="muted small">No status updates posted yet today.</p>
      ) : (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {statuses.map((s: any) => (
            <div className="list-item small" key={s.id}>
              <span className={`status-chip status-chip-${String(s.kind)}`}>{capital(s.kind)}</span>
              <div>
                <strong>{statusValue(String(s.kind), String(s.value))}</strong>
                {s.note ? <span className="muted"> — {s.note}</span> : null}
              </div>
              <span className="muted">{time(s.recorded_at)}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="title mt-5">Today&apos;s report</h2>
      {report ? (
        <div className="card">
          {report.mood && (
            <p className="small"><strong>Mood:</strong> {capital(report.mood)}</p>
          )}
          {report.summary && <p className="mt-2">{report.summary}</p>}
          {report.observation && (
            <p className="muted small mt-2"><strong>Observation:</strong> {report.observation}</p>
          )}
          {meal?.breakfast || meal?.lunch || meal?.snack ? (
            <div className="row mt-3">
              {meal.breakfast && (<div className="col card small"><strong>Breakfast</strong><div>{meal.breakfast}</div></div>)}
              {meal.lunch && (<div className="col card small"><strong>Lunch</strong><div>{meal.lunch}</div></div>)}
              {meal.snack && (<div className="col card small"><strong>Snack</strong><div>{meal.snack}</div></div>)}
            </div>
          ) : null}
          {sleep && <p className="muted small mt-2"><strong>Sleep:</strong> {sleep}</p>}
          {report.diaper && <p className="muted small mt-2"><strong>Diaper:</strong> {report.diaper}</p>}
          {report.sick ? <p className="muted small mt-2" style={{ color: "#b91c1c" }}><strong>Sick today</strong></p> : null}
          {report.note && <p className="muted small mt-2"><strong>Note:</strong> {report.note}</p>}
        </div>
      ) : (
        <p className="muted small">No report posted yet today.</p>
      )}

      <h2 className="title mt-5">Newsfeed</h2>
      {feed.length === 0 ? (
        <p className="muted small">Nothing posted for {child.first_name} yet.</p>
      ) : (
        feed.map((post: any) => (
          <div className="card mb-4" key={post.id}>
            <div className="small muted">{post.author_name} · {new Date(post.created_at).toLocaleString()}</div>
            <p className="mt-2">{post.body}</p>
            {post.media_url && <img src={post.media_url} alt="" style={{ width: "100%", borderRadius: 8, marginTop: 10 }} />}
          </div>
        ))
      )}

      <h2 className="title mt-5">Pickup &amp; contacts</h2>
      {contacts.length === 0 ? (
        <p className="muted small">No contacts added.</p>
      ) : (
        contacts.map((c: any) => (
          <div className="list-item" key={c.id}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.full_name} <span className="muted">({c.relationship})</span></div>
              <div className="muted small">{c.phone}{c.email ? ` · ${c.email}` : ""}</div>
            </div>
            <div>
              {c.is_pickup && <span className="badge">Pickup</span>}{" "}
              {c.is_emergency && <span className="badge badge-red">Emergency</span>}
            </div>
          </div>
        ))
      )}

      {incidents.length > 0 && (
        <>
          <h2 className="title mt-5">Incident reports</h2>
          {incidents.map((i: any) => (
            <div className="card mb-3" key={i.id}>
              <div className="small muted">{capital(i.type)} · {new Date(i.created_at).toLocaleString()}</div>
              <p className="mt-2">{i.description}</p>
              <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>
                {i.acknowledged ? "Acknowledged" : "Needs acknowledgement"}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function safeJson(v: unknown): Record<string, string> {
  if (!v) return {};
  try {
    return JSON.parse(String(v)) as Record<string, string>;
  } catch {
    return {};
  }
}
function time(iso?: unknown): string {
  if (!iso) return "—";
  return new Date(String(iso)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function capital(s: unknown) {
  return capitalize(String(s ?? ""));
}
function statusValue(kind: string, value: string): string {
  if (kind === "sick" && value === "yes") return "Feeling sick";
  if (kind === "sick" && value === "no") return "All good";
  return capitalize(value);
}
