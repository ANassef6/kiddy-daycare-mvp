import { requireSession } from "@/lib/require";
import { familiesForAccount, listInstitutes, listNewsfeed } from "@/lib/store";
import { toggleLikeAction, commentAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ParentNewsfeedPage() {
  const session = requireSession();
  const families = await familiesForAccount(session.accountId);
  const childIds = families.map((f) => f.id as string);
  const childName = Object.fromEntries(families.map((f) => [f.id, f.first_name as string]));

  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const allPosts = iid ? await listNewsfeed(iid, session.accountId) : [];

  const posts = childIds.length
    ? allPosts.filter((p: any) => (p.tags || []).some((t: any) => childIds.includes(String(t.id))))
    : [];

  return (
    <div>
      <h1 className="title">Newsfeed</h1>
      {posts.length === 0 ? (
        <p className="muted">Nothing posted for your children yet.</p>
      ) : (
        posts.map((post: any) => {
          const forChild = (post.tags || []).find((t: any) => childIds.includes(String(t.id)));
          return (
            <div className="card mb-4" key={post.id}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="small muted">{post.author_name} · {new Date(post.created_at).toLocaleString()}</div>
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
              {forChild && (
                <span className="badge badge-green mt-2" style={{ marginTop: 8 }}>for {childName[forChild.id] || forChild.first_name}</span>
              )}
              <p className="mt-2">{post.body}</p>
              {post.media_url && (
                <img src={post.media_url} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8, marginTop: 10 }} />
              )}
              <div className="small muted mt-2">
                {post.like_count} likes · {post.comment_count} comments
              </div>
              {post.comments?.map((c: any) => (
                <div className="small mt-1" key={c.id}><strong>{c.full_name}:</strong> {c.body}</div>
              ))}
              <form action={commentAction} className="row mt-3">
                <input type="hidden" name="postId" value={post.id} />
                <input type="hidden" name="fromParent" value="1" />
                <input className="input" name="body" placeholder="Add a comment…" required style={{ flex: 1 }} />
                <button className="btn btn-ghost" type="submit">Comment</button>
              </form>
            </div>
          );
        })
      )}
    </div>
  );
}