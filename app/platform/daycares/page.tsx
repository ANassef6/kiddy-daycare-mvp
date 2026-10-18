// KID-199.4: the ticket's example path lives at /platform (the acceptance
// check signs the superadmin in and lands there); keep /platform/daycares as
// an alias so both URLs work.
import { redirect } from "next/navigation";

export default function PlatformDaycaresAliasPage() {
  redirect("/platform");
}
