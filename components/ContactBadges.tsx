// KID-369 DEF-005: SQLite returns the contact flags as numeric 0/1, and the
// inline `{c.is_pickup && <span/>}` pattern rendered the falsy numeric 0 as a
// literal "0" next to the contact badges. Centralizing the flags here makes
// the coercion explicit (!!flag) so a zero is never rendered as text.
import { tr, type Dict } from "@/lib/i18n";

export default function ContactBadges({
  isPickup,
  isEmergency,
  dict,
}: {
  isPickup: unknown;
  isEmergency: unknown;
  dict: Dict;
}) {
  return (
    <>
      {!!isPickup && <span className="badge">{tr(dict, "child.pickup")}</span>}{" "}
      {!!isEmergency && <span className="badge badge-red">{tr(dict, "child.emergency")}</span>}
    </>
  );
}
