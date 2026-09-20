"use client";

import { useTransition, useState } from "react";
import { checkInOutAction } from "@/lib/actions";
import type { Dict } from "@/lib/i18n";
import { tr } from "@/lib/i18n";

export function CheckInButton({ childId, checkedIn, dict }: { childId: string; checkedIn: boolean; dict: Dict }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={checkedIn ? "btn btn-accent btn-block" : "btn btn-primary btn-block"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const fd = new FormData();
            fd.set("childId", childId);
            fd.set("type", checkedIn ? "out" : "in");
            const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? tr(dict, "common.saving") : checkedIn ? tr(dict, "attendees.checkOut") : tr(dict, "attendees.checkIn")}
      </button>
      {error && (
        <p className="small" style={{ color: "#dc2626", marginTop: 8, fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  );
}