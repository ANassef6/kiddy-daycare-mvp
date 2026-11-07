"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { busStatusAction } from "@/lib/actions";

// KID-494: staff bus on/off control for the attendance roster. An "On bus"
// transition auto-checks the child out (and notifies the parent); "Off bus"
// auto-checks them in. Set status is idempotent per day — a same-type click
// inserts nothing.
export function BusStatusButtons({
  childId,
  busEvent,
}: {
  childId: string;
  busEvent: { type: string; auto: boolean } | undefined;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const on = busEvent?.type === "on";
  function submit(fd: FormData) {
    start(async () => {
      setError(null);
      try {
        await busStatusAction(fd);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error && !err.message.startsWith("NEXT_REDIRECT") ? err.message : null);
      }
    });
  }
  return (
    <div className="row" style={{ gap: 6 }}>
      <form action={submit}>
        <input type="hidden" name="childId" value={childId} />
        <input type="hidden" name="type" value="on" />
        <button
          className={on ? "btn btn-primary small" : "btn btn-ghost small"}
          type="submit"
          disabled={pending}
        >
          {on && busEvent?.auto ? "On bus (auto)" : "On bus"}
        </button>
      </form>
      <form action={submit}>
        <input type="hidden" name="childId" value={childId} />
        <input type="hidden" name="type" value="off" />
        <button
          className={!on && busEvent ? "btn btn-primary small" : "btn btn-ghost small"}
          type="submit"
          disabled={pending}
        >
          Off bus
        </button>
      </form>
      {error && (
        <span className="small" style={{ color: "#dc2626", fontWeight: 600 }}>
          {error}
        </span>
      )}
    </div>
  );
}
