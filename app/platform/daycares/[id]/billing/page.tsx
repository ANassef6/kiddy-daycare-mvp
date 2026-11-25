// KID-2477: the old per-daycare Billing URL. The section is now Settings
// (app/platform/daycares/[id]/settings), so this alias forwards to the Billing
// sub-page and keeps every query parameter (?tab=insights, ?saved=1, ?error=…)
// so bookmarked tabs and server-action returns keep working.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function querySuffix(searchParams: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export default async function LegacyDaycareBillingRedirect(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  redirect(`/platform/daycares/${id}/settings/billing${querySuffix(searchParams)}`);
}
