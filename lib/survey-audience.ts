// KID-2485: survey audience helpers. Surveys now store the resolved audience
// next to the form template so the composer rules match activities/newsfeed
// and the portal can show who a survey was sent to.
//
// Storage contract (form_template columns):
//   audience_channel    'center' | 'rooms' | 'children' (NULL on legacy rows)
//   audience_room_ids   JSON array of the picked classroom ids ('rooms' only)
//   audience_child_ids  JSON array of the RESOLVED child ids
//
// A NULL audience_channel means the survey predates this change. Those rows
// keep the old behavior — center-wide — so they stay visible to every family.

import type { Row } from "./db";
import { safeJson } from "./helpers";
import { tr, type Dict } from "./i18n";

export type SurveyAudienceChannel = "center" | "rooms" | "children";

export type SurveyAudience = {
  channel: SurveyAudienceChannel;
  roomIds: string[];
  childIds: string[];
};

const CHANNELS = new Set<SurveyAudienceChannel>(["center", "rooms", "children"]);

export function storedSurveyAudience(row: Row): SurveyAudience | null {
  const raw = String(row.audience_channel ?? "").trim();
  if (!CHANNELS.has(raw as SurveyAudienceChannel)) return null;
  return {
    channel: raw as SurveyAudienceChannel,
    roomIds: safeJson<string[]>(row.audience_room_ids, []).map(String),
    childIds: safeJson<string[]>(row.audience_child_ids, []).map(String),
  };
}

// Legacy (centre-wide) surveys stay visible to every family. Targeted surveys
// are visible only when at least one of the viewer's children is in the
// resolved audience, so a classroom or child pick really narrows the delivery.
export function surveyVisibleToChildren(row: Row, childIds: Iterable<string>): boolean {
  const audience = storedSurveyAudience(row);
  if (!audience) return true;
  const allowed = new Set(Array.from(childIds).map(String));
  if (allowed.size === 0) return false;
  return audience.childIds.some((id) => allowed.has(id));
}

// One localized line for the survey card / summary: "Everyone (whole center)",
// "Classrooms: Toddlers, Preschool", "Children: Ella, Omar (+2 more)".
export function describeSurveyAudience(
  row: Row,
  dict: Dict,
  roomNames: Map<string, string>,
  childNames: Map<string, string>
): string {
  const audience = storedSurveyAudience(row);
  if (!audience || audience.channel === "center") {
    return tr(dict, "surveysAdmin.audienceEveryone");
  }
  if (audience.channel === "rooms") {
    const names = audience.roomIds.map((id) => roomNames.get(id)).filter(Boolean) as string[];
    const list = names.length
      ? names.join(", ")
      : tr(dict, "surveysAdmin.audienceRoomsFallback", { count: audience.roomIds.length });
    return tr(dict, "surveysAdmin.audienceClassrooms", { rooms: list });
  }
  const names = audience.childIds.map((id) => childNames.get(id)).filter(Boolean) as string[];
  const shown = names.slice(0, 3).join(", ");
  if (!shown) {
    return tr(dict, "surveysAdmin.audienceChildCount", { count: audience.childIds.length });
  }
  const more = audience.childIds.length - Math.min(names.length, 3);
  return more > 0
    ? tr(dict, "surveysAdmin.audienceChildrenMore", { names: shown, count: more })
    : tr(dict, "surveysAdmin.audienceChildren", { names: shown });
}
