import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// KID-86 #10: Inquiries moved under the Smart Forms tab. The standalone route
// is removed so there is exactly one entry point — this redirect keeps any old
// links working.
export default async function PortalInquiriesPage() {
  redirect("/portal/forms?view=inquiries");
}
