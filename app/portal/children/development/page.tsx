import { redirect } from "next/navigation";

// KID-52 #3: the Children > Development tab was removed from the nav —
// development lives under Learning. Keep the old route as a redirect so
// bookmarks and deep links don't 404.
export default function PortalChildrenDevelopmentRedirect() {
  redirect("/portal/learning");
}
