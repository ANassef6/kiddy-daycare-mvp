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
import { firstInstituteId } from "@/lib/helpers";
import { fmtDateFor, fmtTimeFor } from "@/lib/i18n";
import { sendMessageAction, sendComposerAction, replyThreadAction, setThreadArchivedAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { storageSrcFor } from "@/lib/storage";
import { tr } from "@/lib/i18n";
import { recordToolUsage } from "@/lib/tool-usage";
import MediaUploadForm from "@/components/MediaUploadForm";
import MessageComposerForm from "@/components/MessageComposerForm";
import MessageAttachment from "@/components/MessageAttachment";
import { mediaUploadLabels } from "@/lib/media-i18n";
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_MESSAGE_VIDEO_DURATION_SECONDS,
} from "@/lib/media-limits";
import { formatParticipantNames } from "@/lib/thread-display";
import SearchableChecklist from "@/components/SearchableChecklist";

export const dynamic = "force-dynamic";

export default async function PortalMessagesPage(
  props: {
    searchParams: Promise<{ with?: string; thread?: string; compose?: string; unread?: string; q?: string; error?: string; archived?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("learning.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "messages", source: "portal", metadata: null });

  const showArchived = searchParams.archived === "1";
  const [parents, channels, conversations, threads, totalUnread] = await Promise.all([
    parentAccountsScoped(instituteId, session.accountId),
    roomChannelsForAccount(instituteId, session.accountId),
    conversationsForAccount(session.accountId),
    threadsForAccount(session.accountId, { archived: showArchived }),
    unreadCountForAccount(session.accountId),
  ]);
  const me = await getAccount(session.accountId);

  const onlyUnread = searchParams.unread === "1";
  const threadId = searchParams.thread;
  // KID-2459: on a phone the list is the entry point. Only an explicit
  // selection (a thread, a 1:1 chat, or the composer) replaces it. The
  // auto-selected first conversation below must not count, or the list would
  // never be reachable at phone width.
  const mobileHasSelection =
    !!threadId || !!searchParams.with || searchParams.compose === "1";
  // Legacy 1:1 conversations have no participant row to archive, so the
  // Archived view lists threads only.
  const withId = !threadId && !showArchived ? searchParams.with || (conversations[0]?.other_account_id as string) || parents[0]?.id : null;
  const composing = !showArchived && (searchParams.compose === "1" || (!threadId && !withId));
  const listQuery = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: searchParams.q, unread: onlyUnread ? "1" : undefined, archived: showArchived ? "1" : undefined, ...overrides })) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return `/portal/messages${query ? `?${query}` : ""}`;
  };
  const returnTo = threadId ? listQuery({ thread: threadId }) : listQuery({});

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
  const visibleConversations = (showArchived ? [] : onlyUnread ? conversations.filter((c: any) => Number(c.unread_count ?? 0) > 0) : conversations).filter(
    (c: any) => matchesSearch(String(c.other_name ?? "")) || matchesSearch(String(c.last_message ?? ""))
  );
  const visibleThreads = (onlyUnread ? threads.filter((t: any) => Number(t.unread_count ?? 0) > 0) : threads).filter(
    (th: any) =>
      matchesSearch(String(th.thread_title ?? th.title ?? "")) ||
      matchesSearch(String(th.last_message ?? "")) ||
      ((th.participant_names as string[] | undefined) ?? []).some((name) => matchesSearch(name))
  );

  // KID-2453: message attachments are private objects now — resolve the REF in
  // this authorized context; data: URIs and legacy URLs pass through.
  const threadAttachmentSrc = thread?.attachment_url
    ? await storageSrcFor(String(thread.attachment_url))
    : null;
  const attachmentSrcRows = async (rows: any[]) => {
    const map: Record<string, string> = {};
    for (const row of rows) {
      if (!row.attachment_url) continue;
      const src = await storageSrcFor(String(row.attachment_url));
      if (src) map[String(row.id)] = src;
    }
    return map;
  };
  const threadAttachmentSrcById = await attachmentSrcRows(threadRows);
  const legacyAttachmentSrcById = await attachmentSrcRows(legacyThread);
  // KID-2455: new sends carry the attachment on each message row. The thread
  // header copy still renders for older threads that only have a thread-level
  // attachment, never twice.
  const threadHasMessageAttachments = threadRows.some((m: any) => !!m.attachment_url);
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

      <div
        className={`grid messages-layout${mobileHasSelection ? " messages-has-selection" : ""}`}
        style={{ gridTemplateColumns: "280px 1fr" }}
      >
        <div className="card messages-list">
          <h4 className="subtitle">{t("messages.conversations")}{totalUnread > 0 ? ` · ${t("messages.unreadCount", { count: totalUnread })}` : ""}</h4>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            <Link
              className={`btn btn-ghost small${showArchived ? " muted" : ""}`}
              href={listQuery({ archived: undefined })}
              style={showArchived ? undefined : { fontWeight: 800 }}
            >
              {t("messages.active")}
            </Link>
            <Link
              className={`btn btn-ghost small${showArchived ? "" : " muted"}`}
              href={listQuery({ archived: "1" })}
              style={showArchived ? { fontWeight: 800 } : undefined}
            >
              {t("messages.archived")}
            </Link>
          </div>
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
            {showArchived && <input type="hidden" name="archived" value="1" />}
          </form>
          {visibleThreads.length === 0 && visibleConversations.length === 0 && (
            <p className="muted small">
              {searchQuery
                ? t("messages.noSearchResults")
                : showArchived
                  ? t("messages.noArchived")
                  : onlyUnread
                    ? t("messages.noUnread")
                    : t("messages.noChatsYet")}
            </p>
          )}
          {visibleThreads.map((th: any) => {
            const unread = Number(th.unread_count ?? 0);
            const active = threadId === String(th.id);
            const isGroup = Number(th.is_group) === 1;
            const participantNames = (th.participant_names as string[] | undefined) ?? [];
            const otherName = !isGroup ? participantNames[0] : undefined;
            const groupNames = isGroup ? formatParticipantNames(participantNames) : "";
            const threadLink = showArchived
              ? listQuery({ thread: String(th.id) })
              : `/portal/messages?thread=${th.id}`;
            return (
              <div
                key={th.id}
                className="list-item"
                style={unread > 0 ? { background: "color-mix(in srgb, var(--brand-primary) 10%, transparent)", fontWeight: 700 } : active ? { background: "#f1f5f9" } : undefined}
              >
                <Link href={threadLink} style={{ color: "var(--color-text)", flex: 1, minWidth: 0, overflow: "hidden" }}>
                  {otherName ? (
                    <strong className="small">{otherName}</strong>
                  ) : (
                    <>
                      <span className="small muted">{isGroup ? t("messages.groupOfAll") : t("messages.groupOfTwo")} · </span>
                      <strong className="small">{th.thread_title ?? th.title ?? t("common.thread")}</strong>
                    </>
                  )}
                  {unread > 0 && <span className="badge badge-red" style={{ marginInlineStart: 6 }}>{unread}</span>}
                  {groupNames && (
                    <div className="muted small" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {groupNames}
                    </div>
                  )}
                  <div className="muted small" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {th.last_message ?? "—"}
                  </div>
                </Link>
                <form action={setThreadArchivedAction} style={{ margin: 0, flex: "0 0 auto" }}>
                  <input type="hidden" name="threadId" value={String(th.id)} />
                  <input type="hidden" name="archived" value={showArchived ? "0" : "1"} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    className="btn btn-ghost small"
                    type="submit"
                    title={showArchived ? t("messages.unarchive") : t("messages.archive")}
                    aria-label={showArchived ? t("messages.unarchive") : t("messages.archive")}
                  >
                    {showArchived ? t("messages.unarchive") : t("messages.archive")}
                  </button>
                </form>
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
                    {c.last_message ?? "—"} · {c.last_at ? fmtTimeFor(locale, c.last_at) : ""}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>

        <div className="card messages-thread">
          <Link className="btn btn-ghost small messages-back" href="/portal/messages">
            ← {t("messages.backToConversations")}
          </Link>
          {composing ? (
            <MediaUploadForm
              action={sendComposerAction}
              maxImageBytes={MAX_MESSAGE_ATTACHMENT_BYTES}
              maxVideoBytes={MAX_MESSAGE_ATTACHMENT_BYTES}
              maxVideoSeconds={MAX_MESSAGE_VIDEO_DURATION_SECONDS}
              maxFileBytes={MAX_MESSAGE_ATTACHMENT_BYTES}
              labels={mediaUploadLabels(dict)}
              directUpload={{ purpose: "message", fileField: "attachment" }}
            >
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
                  {/* KID-2482: every recipient list gets child/parent search. */}
                  <SearchableChecklist
                    name="recipients"
                    items={parents.map((p: any) => ({ id: String(p.id), label: String(p.full_name ?? "") }))}
                    placeholder={t("messages.searchRecipientsPlaceholder")}
                    emptyMessage={t("messages.noParentsInClassroomsShort")}
                    noResultsMessage={t("messages.noRecipientsFound")}
                  />
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
            </MediaUploadForm>
          ) : thread && threadId ? (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <h4 className="subtitle" style={{ margin: 0 }}>
                  {thread.thread_title ?? thread.title ?? t("common.thread")}{" "}
                  <span className="badge">{Number(thread.is_group) ? t("common.group") : t("common.private")}</span>
                </h4>
                <form action={setThreadArchivedAction} style={{ margin: 0, flex: "0 0 auto" }}>
                  <input type="hidden" name="threadId" value={String(threadId)} />
                  <input type="hidden" name="archived" value={thread.archived_at ? "0" : "1"} />
                  <input type="hidden" name="returnTo" value={listQuery({ thread: String(threadId) })} />
                  <button className="btn btn-ghost small" type="submit">
                    {thread.archived_at ? t("messages.unarchive") : t("messages.archive")}
                  </button>
                </form>
              </div>
              <p className="muted small">
                {(thread.participant_ids as string[] ?? []).map((pid: string) => threadNames[pid] ?? pid).join(", ")}
              </p>
              {threadAttachmentSrc && !threadHasMessageAttachments && (
                <p className="small mt-1">
                  <a href={threadAttachmentSrc} download={String(thread.attachment_name ?? "")}>
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
                      {threadAttachmentSrcById[String(m.id)] && (
                        <MessageAttachment
                          src={threadAttachmentSrcById[String(m.id)]}
                          name={String(m.attachment_name ?? t("messages.attachment"))}
                          url={m.attachment_url}
                          downloadLabel={t("messages.downloadAttachment")}
                        />
                      )}
                      <div className="small" style={{ opacity: 0.75, marginTop: 2 }}>{fmtTimeFor(locale, m.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <MessageComposerForm
                action={replyThreadAction}
                sendLabel={t("common.send")}
                sendingLabel={t("messages.sending")}
                placeholder={t("messages.writeMessage")}
                threadId={threadId}
                attachments={{
                  maxImageBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
                  maxVideoBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
                  maxVideoSeconds: MAX_MESSAGE_VIDEO_DURATION_SECONDS,
                  maxFileBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
                  labels: mediaUploadLabels(dict),
                  attachLabel: t("messages.attachFile"),
                  directUpload: { purpose: "message", fileField: "attachment" },
                }}
              />
            </>
          ) : showArchived && !threadId ? (
            <p className="muted small">{t("messages.selectArchived")}</p>
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
                      {legacyAttachmentSrcById[String(m.id)] && (
                        <MessageAttachment
                          src={legacyAttachmentSrcById[String(m.id)]}
                          name={String(m.attachment_name ?? t("messages.attachment"))}
                          url={m.attachment_url}
                          downloadLabel={t("messages.downloadAttachment")}
                        />
                      )}
                      <div className="small" style={{ opacity: 0.75, marginTop: 2 }}>{fmtTimeFor(locale, m.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
              {withId && (
                <MessageComposerForm
                  action={sendMessageAction}
                  sendLabel={t("common.send")}
                  sendingLabel={t("messages.sending")}
                  placeholder={t("messages.writeMessage")}
                  hiddenRecipientId={String(withId)}
                  attachments={{
                    maxImageBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
                    maxVideoBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
                    maxVideoSeconds: MAX_MESSAGE_VIDEO_DURATION_SECONDS,
                    maxFileBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
                    labels: mediaUploadLabels(dict),
                    attachLabel: t("messages.attachFile"),
                    directUpload: { purpose: "message", fileField: "attachment" },
                  }}
                />
              )}
              <p className="muted small mt-2">{t("common.thread")} {fmtDateFor(locale, new Date().toISOString())}.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}