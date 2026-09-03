import Link from "next/link";
import { requireSession } from "@/lib/require";
import { familiesForAccount, todayStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function MyChildrenPage() {
  const session = requireSession();
  const families = familiesForAccount(session.accountId);

  if (families.length === 0) {
    return (
      <div className="card mt-5">
        <h1 className="title">No children linked yet</h1>
        <p className="subtitle">
          Use your invite code from the daycare to link to your child&apos;s account.
          <a className="mt-3 btn btn-primary" href="/register">Register with an invite</a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="title">My children</h1>
      <div className="grid">
        {families.map((child: any) => {
          const status = todayStatus(child.id);
          const seen = status.lastEvent?.type === "in";
          return (
            <Link key={child.id} href={`/child/${child.id}`} className="card" style={{ color: "var(--color-text)" }}>
              <div className="status-card">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>
                    {child.first_name} {child.last_name}
                  </div>
                  <div className="muted small">{child.room_name ?? "No room"}</div>
                </div>
                {status.checkedIn && !status.checkedOut ? (
                  <span className="badge badge-green">Checked in</span>
                ) : status.checkedOut ? (
                  <span className="badge badge-gray">Checked out</span>
                ) : (
                  <span className="badge">Not checked in yet</span>
                )}
              </div>
              {status.lastEvent && (
                <div className="muted small mt-2">
                  {seen ? `Checked in at ${time(status.checkedIn?.recorded_at)}` : `Checked out at ${time(status.checkedOut?.recorded_at)}`}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function time(iso?: unknown): string {
  if (!iso) return "—";
  return new Date(String(iso)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
