// KID-2477: the old per-daycare Invoices URL. The section is now Settings
// (app/platform/daycares/[id]/settings), so this alias forwards to the Invoices
// sub-page and keeps every query parameter (?saved=1, ?error=…).
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

export default async function LegacyDaycareInvoicesRedirect(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  redirect(`/platform/daycares/${id}/settings/invoices${querySuffix(searchParams)}`);
}
