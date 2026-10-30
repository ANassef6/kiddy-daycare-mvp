import { requireFamilyPage } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { familiesForAccount,listNewsfeed } from "@/lib/store";
import { toggleLikeAction, commentAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ParentNewsfeedPage() {
  const session = await requireFamilyPage("/child/newsfeed");
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const families = await familiesForAccount(session.accountId);
  const childIds = families.map((f) => f.id as string);
  const childName = Object.fromEntries(families.map((f) => [f.id, f.first_name as string]));

  const iid = await resolveTenantInstituteId();
  const allPosts = iid ? await listNewsfeed(iid, session.accountId) : [];

  const posts = childIds.length
    ? allPosts.filter((p: any) => (p.tags || []).some((t: any) => childIds.includes(String(t.id))))
    : [];

  return (
    <div>
      <h1 className="title">{t("newsfeed.title")}</h1>
      {posts.length === 0 ? (
        <p className="muted">{t("newsfeed.empty")}</p>
      ) : (
        posts.map((post: any) => {
          const forChild = (post.tags || []).find((t: any) => childIds.includes(String(t.id)));
          return (
            <div className="card mb-4" key={post.id}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="small muted" dir="auto">
                  {post.author_name} · {new Date(post.created_at).toLocaleString(locale === "ar" ? "ar-EG" : undefined)}
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
              {forChild && (
                <span className="badge badge-green mt-2" style={{ marginTop: 8 }}>
                  <bdi>{t("newsfeed.forChild", { name: childName[forChild.id] || forChild.first_name })}</bdi>
                </span>
              )}
              <p className="mt-2" dir="auto">{post.body}</p>
              {post.media_url && (
                <img src={post.media_url} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8, marginTop: 10 }} />
              )}
              <div className="small muted mt-2">
                {t("newsfeed.likesAndComments", { likes: post.like_count, comments: post.comment_count })}
              </div>
              {post.comments?.map((c: any) => (
                <div className="small mt-1" key={c.id}><strong>{c.full_name}:</strong> {c.body}</div>
              ))}
              <form action={commentAction} className="row mt-3">
                <input type="hidden" name="postId" value={post.id} />
                <input type="hidden" name="fromParent" value="1" />
                <input className="input" name="body" placeholder={t("newsfeed.addCommentPlaceholder")} required style={{ flex: 1 }} />
                <button className="btn btn-ghost" type="submit">{t("newsfeed.comment")}</button>
              </form>
            </div>
          );
        })
      )}
    </div>
  );
}