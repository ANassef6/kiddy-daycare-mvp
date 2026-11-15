// KID-2413 (bug 6): localized wording for the attendance/pickup policy
// refusals. lib/working-hours.ts and lib/pickup-policy.ts stay pure and return
// a machine-readable code (plus the values the message needs); these helpers
// turn that into the account's language at the action/route boundary, keeping
// the English `error` strings as the non-request-scope fallback.

import { tr, type Dict } from "./i18n";
import { dayLabelKey, type CheckInGate } from "./working-hours";
import type { PickupTimeDecision } from "./pickup-policy";

type Refusal = { code?: string; dayIndex?: string; open?: string; close?: string };

function dayName(dict: Dict, dayIndex: string | undefined): string {
  const key = dayIndex === undefined ? undefined : dayLabelKey(dayIndex);
  return key ? tr(dict, key) : "";
}

export function checkInRefusalMessage(dict: Dict, gate: CheckInGate): string {
  if (gate.allowed) return "";
  if (gate.code === "closed_day") {
    return tr(dict, "policy.closedDayNoCheckIn", { day: dayName(dict, gate.dayIndex) });
  }
  return tr(dict, "policy.beforeOpenCheckIn", { time: gate.open ?? "" });
}

export function pickupRefusalMessage(dict: Dict, decision: PickupTimeDecision): string {
  if (decision.ok) return "";
  const refusal = decision as Refusal & { code: string };
  switch (refusal.code) {
    case "closed_day":
      return tr(dict, "policy.closedDayNoPickup", { day: dayName(dict, refusal.dayIndex) });
    case "outside_hours":
      return refusal.close
        ? tr(dict, "policy.afterClosePickup", { time: refusal.close })
        : tr(dict, "policy.beforeOpenPickup", { time: refusal.open ?? "" });
    case "cross_day":
      return tr(dict, "policy.pickupCrossDay");
    case "past":
      return tr(dict, "policy.pickupPast");
    default:
      return tr(dict, "policy.pickupInvalidTime");
  }
}
