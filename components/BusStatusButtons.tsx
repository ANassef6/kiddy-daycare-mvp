"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { busStatusAction } from "@/lib/actions";

// KID-494, extended by KID-2448: staff bus cycle control for the attendance
// roster. A daycare day has one morning pair (on -> off) and one afternoon
// pair (on -> off). Only the next expected action is enabled:
//   morning off-bus auto-checks the child IN, afternoon off-bus auto-checks
//   the child OUT. The server re-validates every transition, so a stale tab
//   or a crafted form still cannot break the sequence.
export function BusStatusButtons({
  childId,
  busEvent,
  labels,
}: {
  childId: string;
  busEvent:
    | { type: string; auto: boolean; phase: string | null; dayCount: number }
    | undefined;
  labels: {
    onMorning: string;
    offMorning: string;
    onAfternoon: string;
    offAfternoon: string;
    complete: string;
    errors: Record<string, string>;
  };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const count = busEvent?.dayCount ?? 0;
  const next = count >= 4 ? null : count % 2 === 0 ? "on" : "off";
  const onLabel = count >= 2 ? labels.onAfternoon : labels.onMorning;
  const offLabel = count >= 2 ? labels.offAfternoon : labels.offMorning;
  function submit(fd: FormData) {
    start(async () => {
      setError(null);
      try {
        const res = await busStatusAction(fd);
        if (res && res.ok === false) {
          setError(labels.errors[res.code] ?? labels.errors.unknown ?? "");
          return;
        }
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
          className={next === "on" ? "btn btn-primary small" : "btn btn-ghost small"}
          type="submit"
          disabled={pending || next !== "on"}
        >
          {onLabel}
        </button>
      </form>
      <form action={submit}>
        <input type="hidden" name="childId" value={childId} />
        <input type="hidden" name="type" value="off" />
        <button
          className={next === "off" ? "btn btn-primary small" : "btn btn-ghost small"}
          type="submit"
          disabled={pending || next !== "off"}
        >
          {offLabel}
        </button>
      </form>
      {count >= 4 && (
        <span className="small muted" style={{ fontWeight: 600 }}>
          {labels.complete}
        </span>
      )}
      {error && (
        <span className="small" style={{ color: "#dc2626", fontWeight: 600 }}>
          {error}
        </span>
      )}
    </div>
  );
}
