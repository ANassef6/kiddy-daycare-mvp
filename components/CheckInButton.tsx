"use client";

import { useTransition } from "react";
import { checkInOutAction } from "@/lib/actions";

export function CheckInButton({ childId, checkedIn }: { childId: string; checkedIn: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={checkedIn ? "btn btn-accent btn-block" : "btn btn-primary btn-block"}
      disabled={pending}
      onClick={() =>
        start(() => {
          const fd = new FormData();
          fd.set("childId", childId);
          fd.set("type", checkedIn ? "out" : "in");
          checkInOutAction(fd);
        })
      }
    >
      {pending ? "Saving…" : checkedIn ? "Check out" : "Check in"}
    </button>
  );
}
