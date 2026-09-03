import { requireSession } from "@/lib/require";
import { listInstitutes, listNewsfeed, listChildren } from "@/lib/store";
import { createNewsfeedAction, commentAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default function PortalNewsfeedPage() {
  const session = requireSession();
  const institutes = listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const posts = iid ? listNewsfeed(iid, session.accountId) : [];
  const children = iid ? listChildren(iid) : [];

  return (
    <div>
      <h1 className="title">Newsfeed</h1>

      <form className="card mb-4" action={createNewsfeedAction}>
        <div className="field"><label className="label">Post an update</label><textarea className="textarea" name="body" required /></div>
        <div className="field">
          <label className="label">Tag children (optional)</label>
          <div className="row">
            {children.map((c: any) => (
              <label key={c.id} className="row small" style={{ gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="childIds" value={String(c.id)} /> {c.first_name} {c.last_name}
              </label>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" type="submit">Post</button>
      </form>

      {posts.map((post: any) => (
        <div className="card mb-4" key={post.id}>
          <div className="small muted">{post.author_name} · {new Date(post.created_at).toLocaleString()}</div>
          <p className="mt-2">{post.body}</p>
          {post.tags?.length > 0 && (
            <div className="mt-2">
              {post.tags.map((t: any) => <span key={t.id} className="badge badge-green" style={{ marginRight: 6 }}>{t.first_name} {t.last_name}</span>)}
            </div>
          )}
          {post.media_url && <img src={post.media_url} alt="" style={{ width: "100%", borderRadius: 8, marginTop: 10 }} />}
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
