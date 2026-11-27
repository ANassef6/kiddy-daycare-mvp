import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { listNewsfeed, listChildren, listRooms, staffRooms } from "@/lib/store";
import { createNewsfeedWithAttachmentAction, commentAction, toggleLikeAction } from "@/lib/actions";
import RecipientsPicker from "@/components/RecipientsPicker";
import MediaUploadForm from "@/components/MediaUploadForm";
import { mediaUploadLabels } from "@/lib/media-i18n";
import {
  attachmentKind,
  mediaRefName,
  MAX_NEWSFEED_ATTACHMENT_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_UPLOAD_BYTES,
} from "@/lib/media-limits";
import Avatar from "@/components/Avatar";
import NewsfeedLikers from "@/components/NewsfeedLikers";
import NewsfeedMediaViewer from "@/components/NewsfeedMediaViewer";
import { queryGet } from "@/lib/db";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";
import { recordToolUsage } from "@/lib/tool-usage";
import { signedUrlsForRefs } from "@/lib/storage";

export const dynamic = "force-dynamic";

// KID-221: the staff newsfeed composer and post cards were English-only
// inside the translated shell (heading, composer labels, like/comment rows,
// timestamps). Localized like the rest of the Home group.
export default async function PortalNewsfeedPage(props: {
  searchParams?: Promise<{ error?: string; tagError?: string; tagged?: string }>;
}) {
  const searchParams = props.searchParams;
  const session = await requireSession();
  const params = (await searchParams) ?? {};
  const { locale, dict, timeZone } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  await recordToolUsage({ instituteId: String(iid ?? "") || null, accountId: session.accountId, toolKey: "newsfeed", source: "portal", metadata: null });
  // KID-103: composer children and visible posts are scoped to assigned classrooms.
  const [posts, children, rooms] = await Promise.all([
    iid ? listNewsfeed(iid, session.accountId) : Promise.resolve([]),
    iid ? listChildren(iid, { accountId: session.accountId }) : Promise.resolve([]),
    iid ? listRooms(iid) : Promise.resolve([]),
  ]);
  const mediaSrcs = await signedUrlsForRefs(posts.map((p: any) => String(p.media_url ?? "")));
  // KID-2487: the tag picker offers the editor's own classrooms, plus any
  // child already tagged on a photo so an existing tag is never hidden.
  const tagOptionsById = new Map<string, { id: string; first_name: string; last_name: string }>();
  for (const child of children) {
    tagOptionsById.set(String(child.id), {
      id: String(child.id),
      first_name: String(child.first_name),
      last_name: String(child.last_name),
    });
  }
  for (const post of posts as any[]) {
    for (const tag of post.mediaTags ?? []) {
      if (!tagOptionsById.has(String(tag.id))) {
        tagOptionsById.set(String(tag.id), {
          id: String(tag.id),
          first_name: String(tag.first_name),
          last_name: String(tag.last_name),
        });
      }
    }
  }
  const photoTagOptions = Array.from(tagOptionsById.values());
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

      {params.error === "attachment" && (
        <div role="alert" className="card mb-4" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{t("newsfeed.errorAttachment")}</p>
        </div>
      )}

      {params.tagError === "audience" && (
        <div role="alert" className="card mb-4" style={{ borderLeft: "4px solid #b45309" }}>
          <p className="small" style={{ margin: 0 }}>{t("newsfeed.tagErrorAudience")}</p>
        </div>
      )}
      {params.tagError === "forbidden" && (
        <div role="alert" className="card mb-4" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{t("newsfeed.tagErrorForbidden")}</p>
        </div>
      )}
      {params.tagError === "no_media" && (
        <div role="alert" className="card mb-4" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{t("newsfeed.tagErrorNoMedia")}</p>
        </div>
      )}
      {params.tagged === "1" && (
        <div className="card mb-4" style={{ borderLeft: "4px solid #047857" }}>
          <p className="small" style={{ margin: 0 }}>{t("newsfeed.tagsSaved")}</p>
        </div>
      )}

      <details className="card mb-4" open>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>{t("newsfeed.composerTitle")}</summary>
        <MediaUploadForm
          className="mt-3"
          action={createNewsfeedWithAttachmentAction}
          encType="multipart/form-data"
          maxImageBytes={MAX_NEWSFEED_ATTACHMENT_BYTES}
          maxVideoBytes={MAX_VIDEO_UPLOAD_BYTES}
          maxVideoSeconds={MAX_VIDEO_DURATION_SECONDS}
          labels={mediaUploadLabels(dict)}
          directUpload={{ purpose: "newsfeed", fileField: "attachment" }}
        >
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
        </MediaUploadForm>
      </details>

      {posts.map((post: any) => {
        const mediaKind = post.media_url
          ? attachmentKind(mediaRefName(post.media_url), String(post.media_url))
          : "other";
        const mediaSrc = mediaSrcs.get(String(post.media_url)) ?? "";
        return (
          <div className="card mb-4" key={post.id}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="small muted row" style={{ gap: 8, alignItems: "center" }}>
                <Avatar src={null} name={post.author_name} size={24} />
                <span>{post.author_name} · {fmtDateTimeFor(locale, post.created_at, timeZone)}</span>
              </div>
              <form action={toggleLikeAction}>
                <input type="hidden" name="postId" value={post.id} />
                <button
                  type="submit"
                  className={post.liked ? "badge badge-green" : "badge badge-gray"}
                  style={{ cursor: "pointer", border: "none", fontSize: 14 }}
                  title={post.liked ? t("child.unlike") : t("child.like")}
                  aria-label={post.liked ? t("child.unlike") : t("child.like")}
                  aria-pressed={!!post.liked}
                >
                  {post.liked ? "♥" : "♡"}
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
            {post.media_url &&
              (mediaKind === "image" || mediaKind === "video" ? (
                <NewsfeedMediaViewer
                  postId={String(post.id)}
                  mediaSrc={mediaSrc}
                  kind={mediaKind}
                  canTag
                  childOptions={photoTagOptions}
                  taggedChildIds={(post.mediaTags ?? []).map((tag: any) => String(tag.id))}
                  dict={dict}
                />
              ) : (
                <a href={mediaSrc} target="_blank" rel="noreferrer" className="small">
                  {mediaRefName(post.media_url)}
                </a>
              ))}
            <div className="small muted mt-2" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <NewsfeedLikers likers={post.likers ?? []} count={Number(post.like_count ?? 0)} dict={dict} />
              <span>· {t("newsfeed.commentsCount", { count: Number(post.comment_count ?? 0) })}</span>
            </div>
            {post.comments?.map((c: any) => (
              <div className="small mt-1" key={c.id}><strong>{c.full_name}:</strong> {c.body}</div>
            ))}
            <form action={commentAction} className="row mt-3">
              <input type="hidden" name="postId" value={post.id} />
              <input className="input" name="body" placeholder={t("parent.newsfeedCommentPlaceholder")} required style={{ flex: 1 }} />
              <button className="btn btn-ghost" type="submit">{t("parent.newsfeedCommentAction")}</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
