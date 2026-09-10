import { requireSession } from "@/lib/require";
import { listInstitutes, listNewsfeed, listChildren } from "@/lib/store";
import { createNewsfeedWithAttachmentAction, commentAction, toggleLikeAction } from "@/lib/actions";
import SearchableChildDropdown from "@/components/SearchableChildDropdown";
import Avatar from "@/components/Avatar";

export const dynamic = "force-dynamic";

export default async function PortalNewsfeedPage() {
  const session = requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const [posts, children] = await Promise.all([
    iid ? listNewsfeed(iid, session.accountId) : Promise.resolve([]),
    iid ? listChildren(iid) : Promise.resolve([]),
  ]);

  return (
    <div>
      <h1 className="title">Newsfeed</h1>

      <form className="card mb-4" action={createNewsfeedWithAttachmentAction}>
        <div className="field"><label className="label">Post an update</label><textarea className="textarea" name="body" required /></div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          {/* #8 searchable child tag dropdown (replaces flat checkbox list) */}
          <div className="col field" style={{ flex: 1.5 }}>
            <label className="label">Tag children (searchable)</label>
            <SearchableChildDropdown
              children={children.map((c: any) => ({ id: String(c.id), first_name: String(c.first_name), last_name: String(c.last_name) }))}
              name="childIds"
              placeholder="Search and tag children…"
            />
          </div>
          {/* #8 attachments: paste a photo URL (photo picker comes with real storage) */}
          <div className="col field">
            <label className="label">Attachment (image URL)</label>
            <input className="input" name="mediaUrl" placeholder="https://… / photo.jpg" />
          </div>
        </div>
        <button className="btn btn-primary" type="submit">Post</button>
      </form>

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