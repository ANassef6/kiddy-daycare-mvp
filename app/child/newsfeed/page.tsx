import { requireSession } from "@/lib/require";
import { familiesForAccount, newsfeedForChild } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ParentNewsfeedPage() {
  const session = requireSession();
  const families = await familiesForAccount(session.accountId);
  const childIds = families.map((f) => f.id as string);

  const posts: any[] = [];
  for (const cid of childIds) {
    for (const p of await newsfeedForChild(cid)) {
      posts.push({ ...p, child: `${(families.find((f) => f.id === cid) as any)?.first_name}` });
    }
  }
  posts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return (
    <div>
      <h1 className="title">Newsfeed</h1>
      {posts.length === 0 ? (
        <p className="muted">Nothing posted for your children yet.</p>
      ) : (
        posts.map((post) => (
          <div className="card mb-4" key={post.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="small muted">{post.author_name} · {new Date(post.created_at).toLocaleString()}</div>
              <span className="badge badge-green">for {post.child || "your child"}</span>
            </div>
            <p className="mt-2">{post.body}</p>
            {post.media_url && (
              <img src={post.media_url} alt="" style={{ width: "100%", borderRadius: 8, marginTop: 10 }} />
            )}
            <div className="small muted mt-2">
              {post.like_count} likes · {post.comment_count} comments
            </div>
          </div>
        ))
      )}
    </div>
  );
}
