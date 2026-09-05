import { requireSession } from "@/lib/require";
import { listTags, listChildren, tagsForChild } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createTagAction, setChildTagsAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalTagsPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [tags, children] = await Promise.all([listTags(instituteId), listChildren(instituteId)]);
  const childrenWithTags = await Promise.all(
    children.map(async (c: any) => ({ ...c, tags: await tagsForChild(c.id) }))
  );

  return (
    <div>
      <h1 className="title">Tags &amp; lists</h1>

      <div className="grid mb-4">
        <div className="card">
          <h3 className="subtitle">Create a tag</h3>
          <form action={createTagAction}>
            <div className="field"><label className="label">Tag name</label><input className="input" name="name" required placeholder="e.g. Allergies, New family…" /></div>
            <div className="field"><label className="label">Color</label><input className="input" type="color" name="color" defaultValue="#3B82F6" style={{ width: 80, height: 40 }} /></div>
            <button className="btn btn-primary" type="submit">Create tag</button>
          </form>
          <div className="mt-4">
            {tags.map((t: any) => (
              <div className="list-item" key={t.id}>
                <span className="badge" style={{ background: t.color, color: "#fff" }}>{t.name}</span>
                <span className="muted small">{t.child_count} children</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="subtitle">Assign tags to children</h3>
          {childrenWithTags.length === 0 && <p className="muted small">No children yet.</p>}
          {childrenWithTags.map((c: any) => (
            <form action={setChildTagsAction} key={c.id} className="list-item">
              <input type="hidden" name="childId" value={c.id} />
              <div className="small" style={{ minWidth: 120 }}>
                <strong>{c.first_name} {c.last_name}</strong>
                <div className="muted">{c.tags.map((t: any) => t.name).join(", ") || "no tags"}</div>
              </div>
              <select className="select small" name="tagIds" multiple size={tags.length || 1} style={{ maxWidth: 200 }}>
                {tags.map((t: any) => (
                  <option key={t.id} value={t.id} selected={c.tags.some((ct: any) => ct.id === t.id)}>{t.name}</option>
                ))}
              </select>
              <button className="btn btn-ghost small" type="submit">Save</button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}