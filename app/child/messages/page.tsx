import Link from "next/link";
import { requireSession } from "@/lib/require";
import {
  centerContactAccount,
  conversation,
  threadsForAccount,
  threadForViewer,
  threadMessages,
  threadParticipantIds,
  markThreadRead,
  markRead,
  unreadCountForAccount,
} from "@/lib/store";
import { getAccount } from "@/lib/auth";
import { firstInstituteId, fmtTime } from "@/lib/helpers";
import { sendParentMessageAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ParentMessagesPage({ searchParams }: { searchParams: { thread?: string } }) {
  const session = requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No daycare configured yet.</p>;
  const center = await centerContactAccount(instituteId);
  if (!center) return <p className="muted">No daycare contact account configured yet.</p>;

  const me = await getAccount(session.accountId);
  const [threads, totalUnread] = await Promise.all([
    threadsForAccount(session.accountId),
    unreadCountForAccount(session.accountId),
  ]);

  const threadId = searchParams.thread;
  let thread: any = null;
  let threadRows: any[] = [];
  let threadNames: Record<string, string> = {};
  if (threadId) {
    thread = await threadForViewer(threadId, session.accountId);
    if (thread) {
      threadRows = await threadMessages(threadId);
      const ids = await threadParticipantIds(threadId);
      const { queryAll } = await import("@/lib/db");
      const accs = ids.length > 0 ? await queryAll(`SELECT id, full_name FROM account WHERE id IN (${ids.map(() => "?").join(", ")})`, ...ids) : [];
      threadNames = Object.fromEntries(accs.map((a: any) => [String(a.id), String(a.full_name ?? "?")]));
      await markThreadRead(threadId, session.accountId);
    }
  }
  const direct = !threadId ? await conversation(me!.id, center.id) : [];
  if (!threadId) await markRead(center.id, session.accountId);

  return (
    <div>
      <h1 className="title">
        Messages{totalUnread > 0 ? ` (${totalUnread} unread)` : ""}
      </h1>
      <div className="subtitle">Live messages between you and the daycare. Group replies are shared with everyone in the thread.</div>

      {threads.length > 0 && (
        <div className="card mb-4">
          <h4 className="subtitle">Your threads</h4>
          {threads.map((t: any) => {
            const unread = Number(t.unread_count ?? 0);
            return (
              <div
                key={t.id}
                className="list-item"
                style={unread > 0 ? { background: "color-mix(in srgb, var(--brand-primary) 10%, transparent)", fontWeight: 700 } : undefined}
              >
                <Link href={`/child/messages?thread=${t.id}`} style={{ color: "var(--color-text)", flex: 1 }}>
                  <strong className="small">{t.thread_title ?? t.title ?? "Thread"}</strong>{" "}
                  <span className="badge">{Number(t.is_group) ? "Group" : "Private"}</span>
                  {unread > 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>{unread}</span>}
                  <div className="muted small" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.last_message ?? "—"}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {thread && threadId ? (
        <div className="card mb-4">
          <h4 className="subtitle">{thread.thread_title ?? thread.title ?? "Thread"}</h4>
          <p className="muted small">
            {(thread.participant_ids as string[] ?? []).map((pid: string) => threadNames[pid] ?? pid).join(", ")}
          </p>
          <div style={{ minHeight: 200, maxHeight: 360, overflowY: "auto" }}>
            {threadRows.map((m: any) => (
              <div key={m.id} style={{ display: "flex", justifyContent: m.sender_account_id === session.accountId ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div className="small" style={{
                  background: m.sender_account_id === session.accountId ? "var(--brand-primary)" : "#f1f5f9",
                  color: m.sender_account_id === session.accountId ? "#fff" : "var(--color-text)",
                  padding: "8px 12px", borderRadius: 12, maxWidth: "75%",
                }}>
                  {m.sender_account_id !== session.accountId && <div style={{ fontWeight: 700, fontSize: 11 }}>{m.from_name}</div>}
                  {m.body}
                  <div className="small" style={{ opacity: 0.75, marginTop: 2 }}>{fmtTime(m.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
          <form action={sendParentMessageAction} className="row mt-3">
            <input type="hidden" name="threadId" value={threadId} />
            <input type="hidden" name="recipientId" value={center.id} />
            <input className="input" name="body" placeholder="Write a message…" required style={{ flex: 1 }} />
            <button className="btn btn-primary" type="submit">Send</button>
          </form>
          <p className="mt-2"><Link className="small muted" href="/child/messages">← Back to daycare chat</Link></p>
        </div>
      ) : (
        <>
          <h1 className="title" style={{ fontSize: 18 }}>Chat with {center.full_name}</h1>
          <div className="card mb-4" style={{ minHeight: 200, maxHeight: 360, overflowY: "auto" }}>
            {direct.length === 0 && <p className="muted small">No messages yet — say hello to your daycare.</p>}
            {direct.map((m: any) => (
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
          <form action={sendParentMessageAction} className="row">
            <input type="hidden" name="recipientId" value={center.id} />
            <input className="input" name="body" placeholder="Write a message…" required style={{ flex: 1 }} />
            <button className="btn btn-primary" type="submit">Send</button>
          </form>
        </>
      )}
    </div>
  );
}
