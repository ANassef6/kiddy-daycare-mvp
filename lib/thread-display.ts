export function formatParticipantNames(names: readonly string[], max = 2): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length <= max) return clean.join(", ");
  return `${clean.slice(0, max).join(", ")}, +${clean.length - max}`;
}
