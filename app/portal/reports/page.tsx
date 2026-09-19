import { redirect } from "next/navigation";

// KID-52 #7: the Tools > Reports tab was removed from the nav — Reports and
// Report center served the same purpose. Keep the old route as a redirect so
// bookmarks and deep links don't 404.
export default function PortalReportsRedirect() {
  redirect("/portal/report-center");
}
