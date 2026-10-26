import { tr, type Dict } from "@/lib/i18n";

// KID-236: the persistent marker of an operator-view session. Rendered by the
// tenant layouts (portal + parent) whenever the session carries the
// operator-view marker — requireTenantForPage has already guaranteed the
// session's bound institute IS this host's tenant by the time this renders.
// Exit is a form POST to app/operator-exit/route.ts on the same host, which
// clears only this host's cookie and returns the operator to /platform. A
// form POST (not a <Link>) is deliberate: Next prefetches rendered links,
// and a prefetched GET of the exit route would end the view session without
// the operator ever clicking Exit.
export default function OperatorViewBanner({
  instituteName,
  dict,
}: {
  instituteName: string;
  dict: Dict;
}) {
  return (
    <div
      className="small"
      data-testid="operator-view-banner"
      style={{
        background: "#ede9fe",
        border: "1px solid #7c3aed",
        borderRadius: 8,
        padding: "8px 12px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span>
        {tr(dict, "platform.operatorViewBanner", { daycare: instituteName || "" })}
      </span>
      <form action="/operator-exit" method="post" style={{ margin: 0 }}>
        <button className="btn btn-ghost" type="submit" style={{ padding: "2px 10px" }}>
          {tr(dict, "platform.exitView")}
        </button>
      </form>
    </div>
  );
}
