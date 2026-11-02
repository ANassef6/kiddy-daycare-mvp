import { Suspense } from "react";
import { brandNameForTitle } from "@/lib/theme";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";

// KID-437: the activation page resolves the brand header per-origin the same
// way /login does (and the KID-435 titles): a known daycare subdomain names
// that tenant in the SSR paint (previously the header stayed a hardcoded
// generic-Kiddy span on the daycare's own address — KID-436 FAIL 1b), a
// signed-in account names its own daycare, and generic hosts stay Kiddy.
export default async function RegisterPage() {
  const brandName = (await brandNameForTitle()) || "Kiddy";
  return (
    <Suspense>
      <RegisterForm brandName={brandName} />
    </Suspense>
  );
}
