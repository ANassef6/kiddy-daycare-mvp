// KID-2477: the Settings section root has no screen of its own — Billing is
// the launch tab, matching the old Billing URL it replaces.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DaycareSettingsIndex(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  redirect(`/platform/daycares/${id}/settings/billing`);
}
