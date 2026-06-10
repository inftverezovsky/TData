export const TABLE_TENNIS_DISCIPLINE_SLUG = "tabletennis";

export function isTableTennisScopeSlug(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === TABLE_TENNIS_DISCIPLINE_SLUG;
}
