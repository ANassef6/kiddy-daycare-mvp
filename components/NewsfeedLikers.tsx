import Avatar from "@/components/Avatar";
import { tr, type Dict } from "@/lib/i18n";

export type NewsfeedLiker = { id: string; full_name: string; role: string };

const ROLE_KEYS = new Set(["owner", "admin", "staff", "carer", "teacher", "caregiver", "parent"]);

// KID-2487: the like count is a tappable disclosure. Clicking it (no JS
// required) opens the list of accounts that liked the post, with their avatar
// and role. The caller has already authorized the viewer, so every liker shown
// belongs to the post's audience.
export default function NewsfeedLikers({
  likers,
  count,
  dict,
}: {
  likers: NewsfeedLiker[];
  count: number;
  dict: Dict;
}) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <details className="newsfeed-likers" style={{ display: "inline-block" }}>
      <summary style={{ cursor: "pointer" }}>{t("newsfeed.likesCount", { count })}</summary>
      {likers.length === 0 ? (
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          {t("newsfeed.noLikes")}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
          {likers.map((liker) => {
            const name = String(liker.full_name || "");
            const role = String(liker.role || "");
            const roleLabel = ROLE_KEYS.has(role) ? t(`roles.${role}`) : role;
            return (
              <li
                key={String(liker.id)}
                className="small"
                style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}
              >
                <Avatar src={null} name={name} size={20} />
                <span style={{ fontWeight: 600 }}>{name}</span>
                {roleLabel ? <span className="muted">{`· ${roleLabel}`}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
