"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Nav link that visibly highlights the tab of the currently active page.
// Active when the current path equals the href or lives under it.
export default function ActiveLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
  return (
    <Link href={href} className={`${className ?? ""}${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}