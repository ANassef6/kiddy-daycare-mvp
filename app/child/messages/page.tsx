import Link from "next/link";
import { requireFamilyPage } from "@/lib/require";
import {
  threadsForAccountScoped,
  threadForViewer,
  threadMessages,
  threadParticipantIds,
  markThreadRead,
  markRead,
  conversation,
} from "@/lib/store";
import { parentMessageRecipients, pickRecipient, sumVisibleUnread } from "@/lib/parent-messaging";
import { getAccount } from "@/lib/auth";
import { firstInstituteId, fmtTime } from "@/lib/helpers";
import { sendParentMessageAction } from "@/lib/actions";
import MessageComposerForm from "@/components/MessageComposerForm";
import MessagesLoadError from "@/components/MessagesLoadError";
import { i18nForAccount } from "@/lib/i18n-session";
import { getDictionary, tr, type Dict, type Locale } from "@/lib/i18n";
import { recordToolUsage } from "@/lib/tool-usage";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KID-534 (KID-482 D-2): bounded server reads.
//
// The page used to await ~10 store calls directly inside the server component.
// Any one of them rejecting transiently (observed in production as the
// "Application error … Digest: 3930614149" view on /child/messages — the
// shared Supabase pooler refuses/queues connections under concurrent traffic)
// threw out of the render and Next served an HTTP 500. Every read is now
// guarded: failures are logged loudly (never silently swallowed), only the
// part of the page that depends on the failed read degrades, and the page
// renders a recoverable "try again" state instead of an unhandled exception.
// The segment error boundary (app/child/messages/error.tsx) catches whatever
// still throws in front of the page (session/tenant gate reads), so no
// failure class on this route reaches an unhandled 500.
// ---------------------------------------------------------------------------

type ReadResult<T> = { ok: true; value: T } | { ok: false };

async function readPart<T>(
  label: string,
  read: () => Promise<T>
): Promise<ReadResult<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (err) {
    // KID-534: a degraded page must never hide WHY it degraded — the log line
    // carries the read name and the full error for the runtime logs digest.
    console.error(
      `[child/messages] read failed: ${label}`,
      err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err)
    );
    return { ok: false };
  }
}

/** Best-effort marker write inside a render; failures log, never throw. */
async function softWrite(label: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error(
      `[child/messages] write skipped: ${label}`,
      err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err)
    );
  }
}

const FALLBACK_I18N: { locale: Locale; dict: Dict } = { locale: "en", dict: getDictionary("en") };

export default async function ParentMessagesPage(
  props: {
    searchParams: Promise<{ thread?: string; to?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireFamilyPage("/child/messages");

  const failed = new Set<string>();

  const i18n = await readPart("i18nForAccount", () => i18nForAccount(session.accountId));
  const dict = i18n.ok ? i18n.value.dict : FALLBACK_I18N.dict;
  if (!i18n.ok) failed.add("i18n");
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);

  const institute = await readPart("firstInstituteId", firstInstituteId);
  const instituteId = institute.ok ? institute.value : "";
  if (!institute.ok) failed.add("institute");
  // Unchanged early return for a real "no institute" row; a FAILED read
  // (institute.ok === false) does not take this exit — the recoverable state
  // below renders instead of the misleading "no institute" message.
  if (institute.ok && !instituteId) {
    return <p className="muted">{t("learning.noInstitute")}</p>;
  }
  await softWrite("recordToolUsage", () =>
    recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "messages", source: "child", metadata: null })
  );

  // KID-169: the recipient list is the same set `sendParentMessageAction`
  // enforces (see lib/parent-messaging.ts). The page used to pick an
  // owner/admin account that the action always refused, so every send failed
  // silently. A requested `to` outside the set is dropped, never rendered.
  const recipientsPart = await readPart("parentMessageRecipients", () =>
    parentMessageRecipients(session.accountId)
  );
  const recipients = recipientsPart.ok ? recipientsPart.value : [];
  const canOfferRecipients = recipientsPart.ok;
  const center = recipientsPart.ok ? pickRecipient(recipients, searchParams.to) : undefined;
  if (!recipientsPart.ok) failed.add("recipients");

  // KID-169: render the failure instead of silently re-rendering the page.
  // `sendParentMessageAction` redirects to `?error=recipient` when it refuses a
  // send; without this the parent saw no evidence that anything happened.
  const sendError =
    searchParams.error === "recipient"
      ? t("messages.sendFailedRecipient")
      : searchParams.error
        ? t("messages.sendFailedGeneric")
        : "";

  const mePart = await readPart("getAccount", () => getAccount(session.accountId));
  const me = mePart.ok ? mePart.value : null;
  if (!mePart.ok) failed.add("account");

  // KID-171 (D3): the badge counts unread messages in the threads this page
  // lists. It used to come from the unscoped `unreadCountForAccount`, so a
  // thread the scoped list drops (a participant who is not classroom-assigned
  // staff) lit a badge that no click could open or clear.
  const threadsPart = await readPart("threadsForAccountScoped", () =>
    threadsForAccountScoped(session.accountId)
  );
  const threads = threadsPart.ok ? threadsPart.value : [];
  const totalUnread = threadsPart.ok ? sumVisibleUnread(threads) : 0;
  if (!threadsPart.ok) failed.add("threads");

  const threadId = searchParams.thread;
  let thread: any = null;
  let threadRows: any[] = [];
  let threadRowsFailed = false;
  let threadNames: Record<string, string> = {};
  if (threadId) {
    const threadPart = await readPart("threadForViewer", () =>
      threadForViewer(threadId, session.accountId)
    );
    thread = threadPart.ok ? threadPart.value ?? null : null;
    if (!threadPart.ok) failed.add("thread");
    if (thread) {
      const rowsPart = await readPart("threadMessages", () => threadMessages(threadId));
      if (rowsPart.ok) threadRows = rowsPart.value;
      else {
        threadRowsFailed = true;
        failed.add("threadMessages");
      }
      const idsPart = await readPart("threadParticipantIds", () => threadParticipantIds(threadId));
      if (idsPart.ok && idsPart.value.length > 0) {
        const { queryAll } = await import("@/lib/db");
        const accsPart = await readPart("threadParticipantNames", () =>
          queryAll(
            `SELECT id, full_name FROM account WHERE id IN (${idsPart.value
              .map(() => "?")
              .join(", ")})`,
            ...idsPart.value
          )
        );
        if (accsPart.ok)
          threadNames = Object.fromEntries(
            accsPart.value.map((a: any) => [String(a.id), String(a.full_name ?? "?")])
          );
        else {
          threadNames = {};
          failed.add("threadParticipantNames");
        }
      } else if (!idsPart.ok) {
        threadNames = {};
        failed.add("threadParticipantIds");
      }
      await softWrite("markThreadRead", () => markThreadRead(threadId, session.accountId));
    }
  }

  const directRows = !threadId && me && center ? await readPart("conversation", () => conversation(me!.id, String(center!.id))) : { ok: true, value: [] };
  const direct = directRows.ok ? directRows.value : [];
  if (!directRows.ok) failed.add("conversation");
  if (!threadId && center) {
    await softWrite("markRead", () => markRead(String(center.id), session.accountId));
  }

  const retryHref = threadId ? `/child/messages?thread=${threadId}` : "/child/messages";

  return (
    <div>
      <h1 className="title">
        {totalUnread > 0 ? t("messages.titleUnread", { count: totalUnread }) : t("messages.title")}
      </h1>
      <div className="subtitle">{t("messages.liveMessages")}</div>

      {failed.size > 0 && (
        <MessagesLoadError
          title={t("messages.loadFailedTitle")}
          hint={t("messages.loadFailedHint")}
          action={t("messages.tryAgain")}
          retryHref={retryHref}
        />
      )}

      {sendError && (
        <p className="form-error mb-4" role="alert" data-testid="messages-error">
          {sendError}
        </p>
      )}

      {threadsPart.ok && threads.length > 0 && (
        <div className="card mb-4">
          <h4 className="subtitle">{t("messages.yourThreads")}</h4>
          {threads.map((th: any) => {
            const unread = Number(th.unread_count ?? 0);
            return (
              <div
                key={th.id}
                className="list-item"
                style={
                  unread > 0
                    ? {
                        background: "color-mix(in srgb, var(--brand-primary) 10%, transparent)",
                        fontWeight: 700,
                      }
                    : undefined
                }
              >
                <Link
                  href={`/child/messages?thread=${th.id}`}
                  style={{ color: "var(--color-text)", flex: 1 }}
                >
                  <strong className="small">{th.thread_title ?? th.title ?? t("common.thread")}</strong>{" "}
                  <span className="badge">{Number(th.is_group) ? t("common.group") : t("common.private")}</span>
                  {unread > 0 && (
                    <span className="badge badge-red" style={{ marginLeft: 6 }}>
                      {unread}
                    </span>
                  )}
                  <div
                    className="muted small"
                    style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {th.last_message ?? "—"}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {thread && threadId ? (
        <div className="card mb-4">
          <h4 className="subtitle">{thread.thread_title ?? thread.title ?? t("common.thread")}</h4>
          <p className="muted small">
            {(thread.participant_ids as string[] ?? []).map((pid) => threadNames[pid] ?? pid).join(", ")}
          </p>
          {thread.attachment_url && (
            <p className="small">
              <a href={String(thread.attachment_url)} download={String(thread.attachment_name ?? "")}>
                📎 {thread.attachment_name ?? t("messages.attachment")}
              </a>
            </p>
          )}
          <div style={{ minHeight: 200, maxHeight: 360, overflowY: "auto" }}>
            {threadRowsFailed ? (
              <p className="form-error small" data-testid="messages-thread-load-error">
                {t("messages.loadFailedHint")}
              </p>
            ) : (
              <>
                {threadRows.length === 0 && <p className="muted small">{t("messages.noMessagesInThread")}</p>}
                {threadRows.map((m: any) => (
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
                      {m.sender_account_id !== session.accountId && (
                        <div style={{ fontWeight: 700, fontSize: 11 }}>{m.from_name}</div>
                      )}
                      {m.body}
                      <div className="small" style={{ opacity: 0.75, marginTop: 2 }}>
                        {fmtTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          {/* KID-169: no recipient means nobody is assigned to the classroom, so
              there is no reply target — say so instead of rendering a form that
              can only fail. KID-534: recipients failed to load → no composer is
              rendered and the recoverable state above explains why. */}
          {canOfferRecipients && center ? (
            <MessageComposerForm
              action={sendParentMessageAction}
              sendLabel={t("common.send")}
              sendingLabel={t("messages.sending")}
              placeholder={t("messages.writeMessage")}
              hiddenRecipientId={String(center.id)}
              threadId={threadId}
            />
          ) : canOfferRecipients ? (
            <p className="muted small mt-3" data-testid="messages-no-staff">
              {t("messages.noClassroomStaff")}
            </p>
          ) : null}
          <p className="mt-2">
            <Link className="small muted" href="/child/messages">
              ← {t("messages.backToDaycareChat")}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <h1 className="title" style={{ fontSize: 18 }}>
            {center ? t("messages.chatWithDaycare", { name: center.full_name }) : t("messages.chatWithDaycareTitle")}
          </h1>
          <div className="card mb-4" style={{ minHeight: 200, maxHeight: 360, overflowY: "auto" }}>
            {directRows.ok ? (
              <>
                {direct.length === 0 && <p className="muted small">{t("messages.noMessagesSayHello")}</p>}
                {direct.map((m: any) => (
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
                      <div className="small" style={{ opacity: 0.75, marginTop: 2 }}>
                        {fmtTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p className="form-error small" data-testid="messages-direct-load-error">
                {t("messages.loadFailedHint")}
              </p>
            )}
          </div>
          {canOfferRecipients && center ? (
            <MessageComposerForm
              action={sendParentMessageAction}
              sendLabel={t("common.send")}
              sendingLabel={t("messages.sending")}
              placeholder={t("messages.writeMessage")}
              recipientOptions={recipients.map((r: any) => ({
                id: String(r.id),
                label: String(r.full_name ?? "?"),
              }))}
              defaultRecipientId={String(center.id)}
            />
          ) : canOfferRecipients ? (
            <p className="muted" data-testid="messages-no-staff">
              {t("messages.noClassroomStaff")}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
