import { requireSession } from "@/lib/require";
import { centerContactAccount, conversation } from "@/lib/store";
import { getAccount } from "@/lib/auth";
import { firstInstituteId, fmtTime } from "@/lib/helpers";
import { sendParentMessageAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ParentMessagesPage() {
  const session = requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No daycare configured yet.</p>;
  const center = await centerContactAccount(instituteId);
  if (!center) return <p className="muted">No daycare contact account configured yet.</p>;

  const me = await getAccount(session.accountId);
  const thread = await conversation(me!.id, center.id);

  return (
    <div>
      <h1 className="title">Chat with {center.full_name}</h1>
      <div className="subtitle">Live messages between you and the daycare. They can see your replies in the portal.</div>

      <div className="card mb-4" style={{ minHeight: 200, maxHeight: 360, overflowY: "auto" }}>
        {thread.length === 0 && <p className="muted small">No messages yet — say hello to your daycare.</p>}
        {thread.map((m: any) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              justifyContent: m.sender_account_id === session.accountId ? "flex-end" : "flex-start",
              marginBottom: 10,
            }}
          >
            <div
              className="small"
              style={{
                background: m.sender_account_id === session.accountId ? "var(--brand-primary)" : "#f1f5f9",
                color: m.sender_account_id === session.accountId ? "#fff" : "var(--color-text)",
                padding: "8px 12px",
                borderRadius: 12,
                maxWidth: "75%",
              }}
            >
              {m.body}
              <div className="small" style={{ opacity: 0.75, marginTop: 2 }}>{fmtTime(m.created_at)}</div>
            </div>
          </div>
        ))}
      </div>

      <form action={sendParentMessageAction} className="row">
        <input type="hidden" name="recipientId" value={center.id} />
        <input className="input" name="body" placeholder="Write a message…" required style={{ flex: 1 }} />
        <button className="btn btn-primary" type="submit">Send</button>
      </form>
    </div>
  );
}