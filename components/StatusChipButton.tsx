"use client";

import { useFormStatus } from "react-dom";

// KID-2454: the status chips are individual server-action forms. While a
// submit is in flight (including the redirect round-trip) the same chip must
// not fire again — the server guard is still the source of truth, this only
// removes the easy double-click window.
export default function StatusChipButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {children}
    </button>
  );
}
