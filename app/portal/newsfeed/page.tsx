import { requireSession } from "@/lib/require";
import { listInstitutes, listNewsfeed, listChildren, listRooms, staffRooms } from "@/lib/store";
import { createNewsfeedWithAttachmentAction, commentAction, toggleLikeAction } from "@/lib/actions";
import RecipientsPicker from "@/components/RecipientsPicker";
import Avatar from "@/components/Avatar";
import { queryGet } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PortalNewsfeedPage() {
  const session = requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const [posts, children, rooms] = await Promise.all([
    iid ? listNewsfeed(iid, session.accountId) : Promise.resolve([]),
    iid ? listChildren(iid) : Promise.resolve([]),
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
      <h1 className="title">Newsfeed</h1>

      <details className="card mb-4" open>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>New post — composer (recipients + attachment)</summary>
        <form className="mt-3" action={createNewsfeedWithAttachmentAction} encType="multipart/form-data">
        <div className="field"><label className="label">Post an update</label><textarea className="textarea" name="body" required placeholder="Click here and write…" /></div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          {/* #1 recipients picker with pre-defined channels */}
          <div className="col field" style={{ flex: 1.5 }}>
            <label className="label">Recipients</label>
            <RecipientsPicker
              children={children.map((c: any) => ({ id: String(c.id), first_name: String(c.first_name), last_name: String(c.last_name), room_id: c.room_id ? String(c.room_id) : null, room_name: c.room_name ? String(c.room_name) : null }))}
              rooms={rooms.map((r) => ({ id: String(r.id), name: String(r.name) }))}
              role={session.role}
              assignedRoomIds={assignedRoomIds}
            />
          </div>
          {/* #3 attachments: local drive file picker (no URL field) */}
          <div className="col field">
            <label className="label">Attachment (from your device)</label>
            <input className="input" type="file" name="attachment" accept="image/*,application/pdf,video/*" />
            <span className="small muted">Max ~2.5 MB. Stored with the post.</span>
          </div>
        </div>
        <div className="mt-2"><button className="btn btn-primary" type="submit">Post</button></div>
        </form>
      </details>

      {posts.map((post: any) => (
        <div className="card mb-4" key={post.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="small muted row" style={{ gap: 8, alignItems: "center" }}>
              <Avatar src={null} name={post.author_name} size={24} />
              <span>{post.author_name} · {new Date(post.created_at).toLocaleString()}</span>
            </div>
            <form action={toggleLikeAction}>
              <input type="hidden" name="postId" value={post.id} />
              <button
                type="submit"
                className={post.liked ? "badge badge-green" : "badge badge-gray"}
                style={{ cursor: "pointer", border: "none", fontSize: 12 }}
                title={post.liked ? "Unlike" : "Like"}
              >
                {post.liked ? "♥" : "♡"} {post.like_count}
              </button>
            </form>
          </div>
          <p className="mt-2">{post.body}</p>
          {post.tags?.length > 0 && (
            <div className="mt-2">
              {post.tags.map((t: any) => (
                <span key={t.id} className="badge badge-green" style={{ marginRight: 6 }}>for {t.first_name} {t.last_name}</span>
              ))}
            </div>
          )}
          {post.media_url && <img src={post.media_url} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8, marginTop: 10 }} />}
          <div className="small muted mt-2">{post.like_count} likes · {post.comment_count} comments</div>
          {post.comments?.map((c: any) => (
            <div className="small mt-1" key={c.id}><strong>{c.full_name}:</strong> {c.body}</div>
          ))}
          <form action={commentAction} className="row mt-3">
            <input type="hidden" name="postId" value={post.id} />
            <input className="input" name="body" placeholder="Add a comment…" required style={{ flex: 1 }} />
            <button className="btn btn-ghost" type="submit">Comment</button>
          </form>
        </div>
      ))}
    </div>
  );
}