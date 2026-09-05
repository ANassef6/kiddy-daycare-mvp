import Link from "next/link";
import { requireSession } from "@/lib/require";
import { parentAccounts, conversation, conversationsForAccount } from "@/lib/store";
import { getAccount } from "@/lib/auth";
import { firstInstituteId, fmtDate, fmtTime } from "@/lib/helpers";
import { sendMessageAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalMessagesPage({ searchParams }: { searchParams: { with?: string } }) {
  const session = requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;

  const [parents, conversations] = await Promise.all([
    parentAccounts(instituteId),
    conversationsForAccount(session.accountId),
  ]);
  const withId = searchParams.with || (conversations[0]?.other_account_id as string) || parents[0]?.id;
  const me = await getAccount(session.accountId);
  const thread = withId ? await conversation(me!.id, withId) : [];
  const other = parents.find((p: any) => p.id === withId);

  return (
    <div>
      <h1 className="title">Live chat</h1>
      <div className="subtitle">Talk with families in real time. Parents reply in their app.</div>

      <div className="grid" style={{ gridTemplateColumns: "260px 1fr" }}>
        <div className="card">
          <h4 className="subtitle">Conversations</h4>
          {conversations.length === 0 && <p className="muted small">No chats yet. Pick a parent below.</p>}
          {conversations.map((c: any) => (
            <div key={c.other_account_id} className="list-item">
              <Link href={`/portal/messages?with=${c.other_account_id}`} style={{ color: "var(--color-text)" }}>
                <strong className="small">{c.other_name}</strong>
                <div className="muted small" style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.last_message ?? "—"}</div>
              </Link>
            </div>
          ))}
          <div className="mt-3">
            <label className="label">Start with a parent</label>
            <div className="row" style={{ gap: 6 }}>
              {parents.slice(0, 8).map((p: any) => (
                <Link key={p.id} className="btn btn-ghost small" href={`/portal/messages?with=${p.id}`}>
                  {p.full_name}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <h4 className="subtitle">Thread {other ? `with ${other.full_name}` : withId ? "(selected parent)" : "(none selected)"}</h4>
          <div style={{ minHeight: 260, maxHeight: 420, overflowY: "auto" }}>
            {thread.length === 0 && <p className="muted small">No messages yet in this thread.</p>}
            {thread.map((m: any) => (
              <div key={m.id} style={{ display: "flex", justifyContent: m.sender_account_id === session.accountId ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div className="small" style={{
                  background: m.sender_account_id === session.accountId ? "var(--brand-primary)" : "#f1f5f9",
                  color: m.sender_account_id === session.accountId ? "#fff" : "var(--color-text)",
                  padding: "8px 12px", borderRadius: 12, maxWidth: "75%",
                }}>
                  {m.body}
                  <div className="small" style={{ opacity: 0.75, marginTop: 2 }}>{fmtTime(m.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
          {withId && (
            <form action={sendMessageAction} className="row mt-3">
              <input type="hidden" name="recipientId" value={withId} />
              <input className="input" name="body" placeholder="Write a message…" required style={{ flex: 1 }} />
              <button className="btn btn-primary" type="submit">Send</button>
            </form>
          )}
          <p className="muted small mt-2">Thread {fmtDate(new Date().toISOString())}.</p>
        </div>
      </div>
    </div>
  );
}