import Link from "next/link";
import { requireSession } from "@/lib/require";
import {
  parentAccountsScoped,
  roomChannelsForAccount,
  conversation,
  conversationsForAccount,
  threadsForAccount,
  threadForViewer,
  threadMessages,
  threadParticipantIds,
  markRead,
  markThreadRead,
  unreadCountForAccount,
} from "@/lib/store";
import { getAccount } from "@/lib/auth";
import { firstInstituteId, fmtDate, fmtTime } from "@/lib/helpers";
import { sendMessageAction, sendComposerAction, replyThreadAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalMessagesPage({
  searchParams,
}: {
  searchParams: { with?: string; thread?: string; compose?: string; unread?: string; q?: string; error?: string };
}) {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;

  const [parents, channels, conversations, threads, totalUnread] = await Promise.all([
    parentAccountsScoped(instituteId, session.accountId),
    roomChannelsForAccount(instituteId, session.accountId),
    conversationsForAccount(session.accountId),
    threadsForAccount(session.accountId),
    unreadCountForAccount(session.accountId),
  ]);
  const me = await getAccount(session.accountId);

  const onlyUnread = searchParams.unread === "1";
  const threadId = searchParams.thread;
  const withId = !threadId ? searchParams.with || (conversations[0]?.other_account_id as string) || parents[0]?.id : null;
  const composing = searchParams.compose === "1" || (!threadId && !withId);

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
  const legacyThread = !threadId && withId ? await conversation(me!.id, withId) : [];
  if (!threadId && withId) await markRead(withId, session.accountId);

  const other = parents.find((p: any) => p.id === withId);
  const searchQuery = (searchParams.q ?? "").trim().toLowerCase();
  // KID-182: search filters both threads and live 1:1s by participant name,
  // title and last message. The quick-link "start with a parent" strip is
  // gone — the left column lists real threads and 1:1s only, reachable via
  // search and the composer.
  const matchesSearch = (text: string) => !searchQuery || text.toLowerCase().includes(searchQuery);
  const visibleConversations = (onlyUnread ? conversations.filter((c: any) => Number(c.unread_count ?? 0) > 0) : conversations).filter(
    (c: any) => matchesSearch(String(c.other_name ?? "")) || matchesSearch(String(c.last_message ?? ""))
  );
  const visibleThreads = (onlyUnread ? threads.filter((t: any) => Number(t.unread_count ?? 0) > 0) : threads).filter(
    (th: any) => matchesSearch(String(th.thread_title ?? th.title ?? "")) || matchesSearch(String(th.last_message ?? ""))
  );

  return (
    <div>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title">
          {t("messages.title")} ▾{" "}
          <Link
            className={`btn btn-ghost small${onlyUnread ? "" : " muted"}`}
            href={onlyUnread ? "/portal/messages" : "/portal/messages?unread=1"}
            style={onlyUnread ? { fontWeight: 800 } : undefined}
          >
            {t("messages.unread")}{totalUnread > 0 ? ` (${totalUnread})` : ""}
          </Link>{" "}
          <Link className="btn btn-ghost small" href="/portal/messages?compose=1" aria-label={t("messages.newMessage")} title={t("messages.newMessage")}>
            ✎
          </Link>
        </h1>
        <a className="btn btn-ghost small" href="/portal/notifications">{t("messages.notificationPrefs")} →</a>
      </div>
      <div className="subtitle">{t("messages.subtitle")}</div>

      {(searchParams.error === "norecipients" || searchParams.error === "attachment") && (
        <p className="badge badge-red" style={{ marginBottom: 12 }}>
          {searchParams.error === "attachment" ? t("messages.errorAttachment") : t("messages.errorNorecipients")}
        </p>
      )}

      <div className="grid" style={{ gridTemplateColumns: "280px 1fr" }}>
        <div className="card">
          <h4 className="subtitle">{t("messages.conversations")}{totalUnread > 0 ? ` · ${t("messages.unreadCount", { count: totalUnread })}` : ""}</h4>
          <form method="get" action="/portal/messages" style={{ margin: "0 0 10px" }}>
            <input
              className="input"
              type="search"
              name="q"
              defaultValue={searchParams.q ?? ""}
              placeholder={t("messages.searchConversations")}
              aria-label={t("messages.searchConversations")}
            />
            {onlyUnread && <input type="hidden" name="unread" value="1" />}
          </form>
          {visibleThreads.length === 0 && visibleConversations.length === 0 && (
            <p className="muted small">{searchQuery ? t("messages.noSearchResults") : onlyUnread ? t("messages.noUnread") : t("messages.noChatsYet")}</p>
          )}
          {visibleThreads.map((th: any) => {
            const unread = Number(th.unread_count ?? 0);
            const active = threadId === String(th.id);
            return (
              <div
                key={th.id}
                className="list-item"
                style={unread > 0 ? { background: "color-mix(in srgb, var(--brand-primary) 10%, transparent)", fontWeight: 700 } : active ? { background: "#f1f5f9" } : undefined}
              >
                <Link href={`/portal/messages?thread=${th.id}`} style={{ color: "var(--color-text)", flex: 1 }}>
                  <span className="small muted">{Number(th.is_group) ? t("messages.groupOfAll") : t("messages.groupOfTwo")} · </span>
                  <strong className="small">{th.thread_title ?? th.title ?? t("common.thread")}</strong>
                  {unread > 0 && <span className="badge badge-red" style={{ marginInlineStart: 6 }}>{unread}</span>}
                  <div className="muted small" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {th.last_message ?? "—"}
                  </div>
                </Link>
              </div>
            );
          })}
          {visibleConversations.map((c: any) => {
            const unread = Number(c.unread_count ?? 0);
            const active = withId === String(c.other_account_id);
            return (
              <div
                key={c.other_account_id}
                className="list-item"
                style={unread > 0 ? { background: "color-mix(in srgb, var(--brand-primary) 10%, transparent)", fontWeight: 700 } : active ? { background: "#f1f5f9" } : undefined}
              >
                <Link href={`/portal/messages?with=${c.other_account_id}`} style={{ color: "var(--color-text)", flex: 1 }}>
                  <strong className="small">{c.other_name}</strong>
                  {unread > 0 && <span className="badge badge-red" style={{ marginInlineStart: 6 }}>{unread}</span>}
                  <div className="muted small" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.last_message ?? "—"} · {c.last_at ? fmtTime(c.last_at) : ""}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>

        <div className="card">
          {composing ? (
            <form action={sendComposerAction}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h4 className="subtitle">{t("messages.title")}</h4>
                <Link className="btn btn-ghost small" href="/portal/messages" aria-label={t("messages.closeComposer")}>✕</Link>
              </div>
              <div className="field">
                <label className="label">{t("messages.to")}</label>
                <div className="card mt-1" style={{ maxHeight: 300, overflowY: "auto" }}>
                  {channels.length > 0 && (
                    <>
                      <div className="label">{t("messages.classroomChannels")}</div>
                      {channels.map((ch: any) => (
                        <div key={ch.id} className="row small" style={{ gap: 8, alignItems: "center", padding: "4px 0", flexWrap: "wrap" }}>
                          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input type="checkbox" name="channels" value={String(ch.id)} />
                            <strong>🏫 {ch.name}</strong>
                          </label>
                          <span className="muted small">
                            {t("messages.audienceCounts", { parents: Number(ch.parent_count ?? 0), staff: Number(ch.staff_count ?? 0) })}
                          </span>
                          <select className="input small" name={`audience:${ch.id}`} defaultValue="whole" aria-label={t("messages.audience")}>
                            <option value="whole">{t("messages.audWhole")}</option>
                            <option value="children">{t("messages.audChildren")}</option>
                            <option value="staff">{t("messages.audStaff")}</option>
                          </select>
                        </div>
                      ))}
                    </>
                  )}
                  <div className="label mt-2">{t("messages.parents")}</div>
                  {parents.length === 0 && <p className="muted small">{t("messages.noParentsInClassroomsShort")}</p>}
                  {parents.map((p: any) => (
                    <label key={p.id} className="row small" style={{ gap: 8, alignItems: "center", padding: "4px 0" }}>
                      <input type="checkbox" name="recipients" value={String(p.id)} />
                      <span>{p.full_name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="field mt-2">
                <label className="label">{t("messages.attachment")}</label>
                <input className="input" type="file" name="attachment" accept="*/*" />
              </div>
              <label className="row small mt-2" style={{ gap: 8, alignItems: "center" }}>
                <input type="checkbox" name="groupMode" /> <strong>{t("messages.groupMessage")}</strong>
              </label>
              <p className="muted small">{t("messages.groupHint")}</p>
              <div className="field mt-2">
                <textarea className="textarea" name="body" required placeholder={t("messages.writeMessage")} rows={4} />
              </div>
              <button className="btn btn-primary" type="submit">{t("common.send")}</button>
            </form>
          ) : thread && threadId ? (
            <>
              <h4 className="subtitle">
                {thread.thread_title ?? thread.title ?? t("common.thread")}{" "}
                <span className="badge">{Number(thread.is_group) ? t("common.group") : t("common.private")}</span>
              </h4>
              <p className="muted small">
                {(thread.participant_ids as string[] ?? []).map((pid: string) => threadNames[pid] ?? pid).join(", ")}
              </p>
              {thread.attachment_url && (
                <p className="small mt-1">
                  <a href={String(thread.attachment_url)} download={String(thread.attachment_name ?? "")}>
                    📎 {thread.attachment_name ?? t("messages.attachment")}
                  </a>
                </p>
              )}
              <div style={{ minHeight: 260, maxHeight: 420, overflowY: "auto" }}>
                {threadRows.length === 0 && <p className="muted small">{t("messages.noMessagesInThread")}</p>}
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
              <form action={replyThreadAction} className="row mt-3">
                <input type="hidden" name="threadId" value={threadId} />
                <input className="input" name="body" placeholder={t("messages.writeMessage")} required style={{ flex: 1 }} />
                <button className="btn btn-primary" type="submit">{t("common.send")}</button>
              </form>
            </>
          ) : (
            <>
              <h4 className="subtitle">
                {t("messages.threadWith", { name: other ? other.full_name : withId ? t("messages.selectedParent") : t("messages.noneSelected") })}
              </h4>
              <div style={{ minHeight: 260, maxHeight: 420, overflowY: "auto" }}>
                {legacyThread.length === 0 && <p className="muted small">{t("messages.noMessagesInThread")}</p>}
                {legacyThread.map((m: any) => (
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
                  <input className="input" name="body" placeholder={t("messages.writeMessage")} required style={{ flex: 1 }} />
                  <button className="btn btn-primary" type="submit">{t("common.send")}</button>
                </form>
              )}
              <p className="muted small mt-2">{t("common.thread")} {fmtDate(new Date().toISOString())}.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}