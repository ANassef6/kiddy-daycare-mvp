import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { listNewsfeed, listChildren, listRooms, staffRooms } from "@/lib/store";
import { createNewsfeedWithAttachmentAction, commentAction, toggleLikeAction } from "@/lib/actions";
import RecipientsPicker from "@/components/RecipientsPicker";
import Avatar from "@/components/Avatar";
import { queryGet } from "@/lib/db";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the staff newsfeed composer and post cards were English-only
// inside the translated shell (heading, composer labels, like/comment rows,
// timestamps). Localized like the rest of the Home group.
export default async function PortalNewsfeedPage() {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  // KID-103: composer children and visible posts are scoped to assigned classrooms.
  const [posts, children, rooms] = await Promise.all([
    iid ? listNewsfeed(iid, session.accountId) : Promise.resolve([]),
    iid ? listChildren(iid, { accountId: session.accountId }) : Promise.resolve([]),
    iid ? listRooms(iid) : Promise.resolve([]),
  ]);
  // KID-53 #1: staff recipients are limited to their assigned classrooms.
  let assignedRoomIds: string[] = [];
  if (session.role === "staff" || session.role === "carer") {
    const me = await queryGet("SELECT staff_id FROM account WHERE id = ?", session.accountId);
    if (me?.staff_id) {
      const roomsForStaff = await staffRooms(String(me.staff_id));
      assignedRoomIds = roomsForStaff.map((r) => String(r.id));
    }
  }

  return (
    <div>
      <h1 className="title">{t("parent.newsfeedTitle")}</h1>

      <details className="card mb-4" open>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>{t("newsfeed.composerTitle")}</summary>
        <form className="mt-3" action={createNewsfeedWithAttachmentAction} encType="multipart/form-data">
        <div className="field"><label className="label">{t("newsfeed.postUpdate")}</label><textarea className="textarea" name="body" required placeholder={t("newsfeed.writeHere")} /></div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          {/* #1 recipients picker with pre-defined channels */}
          <div className="col field" style={{ flex: 1.5 }}>
            <label className="label">{t("activities.recipients")}</label>
            <RecipientsPicker
              dict={dict}
              childOptions={children.map((c: any) => ({ id: String(c.id), first_name: String(c.first_name), last_name: String(c.last_name), room_id: c.room_id ? String(c.room_id) : null, room_name: c.room_name ? String(c.room_name) : null }))}
              rooms={rooms.map((r) => ({ id: String(r.id), name: String(r.name) }))}
              role={session.role}
              assignedRoomIds={assignedRoomIds}
            />
          </div>
          {/* #3 attachments: local drive file picker (no URL field) */}
          <div className="col field">
            <label className="label">{t("newsfeed.attachmentDevice")}</label>
            <input className="input" type="file" name="attachment" accept="image/*,application/pdf,video/*" />
            <span className="small muted">{t("newsfeed.attachmentLimit")}</span>
          </div>
        </div>
        <div className="mt-2"><button className="btn btn-primary" type="submit">{t("learning.post")}</button></div>
        </form>
      </details>

      {posts.map((post: any) => (
        <div className="card mb-4" key={post.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="small muted row" style={{ gap: 8, alignItems: "center" }}>
              <Avatar src={null} name={post.author_name} size={24} />
              <span>{post.author_name} · {fmtDateTimeFor(locale, post.created_at)}</span>
            </div>
            <form action={toggleLikeAction}>
              <input type="hidden" name="postId" value={post.id} />
              <button
                type="submit"
                className={post.liked ? "badge badge-green" : "badge badge-gray"}
                style={{ cursor: "pointer", border: "none", fontSize: 12 }}
                title={post.liked ? t("child.unlike") : t("child.like")}
              >
                {post.liked ? "♥" : "♡"} {post.like_count}
              </button>
            </form>
          </div>
          <p className="mt-2">{post.body}</p>
          {post.tags?.length > 0 && (
            <div className="mt-2">
              {post.tags.map((tag: any) => (
                <span key={tag.id} className="badge badge-green" style={{ marginRight: 6 }}>
                  {t("parent.newsfeedFor", { name: `${tag.first_name} ${tag.last_name}` })}
                </span>
              ))}
            </div>
          )}
          {post.media_url && <img src={post.media_url} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8, marginTop: 10 }} />}
          <div className="small muted mt-2">{t("parent.newsfeedMeta", { likes: post.like_count, comments: post.comment_count })}</div>
          {post.comments?.map((c: any) => (
            <div className="small mt-1" key={c.id}><strong>{c.full_name}:</strong> {c.body}</div>
          ))}
          <form action={commentAction} className="row mt-3">
            <input type="hidden" name="postId" value={post.id} />
            <input className="input" name="body" placeholder={t("parent.newsfeedCommentPlaceholder")} required style={{ flex: 1 }} />
            <button className="btn btn-ghost" type="submit">{t("parent.newsfeedCommentAction")}</button>
          </form>
        </div>
      ))}
    </div>
  );
}
