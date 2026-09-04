import { requireSession } from "@/lib/require";
import { familiesForAccount } from "@/lib/store";
import { queryAll } from "@/lib/db";
import { respondConsentAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ParentConsentsPage() {
  const session = requireSession();
  const families = await familiesForAccount(session.accountId);
  const childIds = families.map((f) => f.id as string);
  const consents = childIds.length
    ? await queryAll(
        `SELECT cr.*, c.first_name FROM consent_request cr
         LEFT JOIN child c ON c.id = cr.child_id
         WHERE cr.child_id IN (${childIds.map(() => "?").join(",")})
         ORDER BY cr.created_at DESC`,
        ...childIds
      )
    : [];

  return (
    <div>
      <h1 className="title">Consents &amp; approvals</h1>
      {consents.length === 0 ? (
        <p className="muted">No consent requests for your children right now.</p>
      ) : (
        consents.map((c: any) => (
          <div className="card mb-4" key={c.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{c.title}</div>
                <div className="muted small">{c.first_name}</div>
              </div>
              <span className={c.status === "approved" ? "badge badge-green" : c.status === "denied" ? "badge badge-red" : "badge"}>
                {c.status}
              </span>
            </div>
            {c.body && <p className="mt-2">{c.body}</p>}
            {c.status === "pending" && (
              <form className="row mt-3" action={respondConsentAction}>
                <input type="hidden" name="id" value={c.id} />
                <button className="btn btn-accent" name="status" value="approved" type="submit">Approve</button>
                <button className="btn btn-ghost" name="status" value="denied" type="submit">Deny</button>
              </form>
            )}
          </div>
        ))
      )}
    </div>
  );
}
