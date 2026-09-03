import { sessionFromHeaders } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export function requireSession() {
  const h = headers();
  const session = sessionFromHeaders(h);
  if (!session) redirect("/login");
  return session;
}
