type HltvEventLike = {
  id?: string | number | null;
  title?: string | null;
  url?: string | null;
};

export function filterHltvEventsByQuery<T extends HltvEventLike>(events: T[], query: string, limit = 10): T[] {
  const tokens = normalizeHltvSearchText(query).split(" ").filter((token) => token.length >= 2);
  if (tokens.length === 0) return events.slice(0, limit);

  const seen = new Set<string>();
  const matched: T[] = [];
  for (const event of events) {
    const title = String(event.title || "");
    const url = String(event.url || "");
    const id = String(event.id || "");
    const haystack = normalizeHltvSearchText(`${title} ${url} ${id}`);
    if (!tokens.every((token) => haystack.includes(token))) continue;

    const key = id || url || title;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    matched.push(event);
    if (matched.length >= limit) break;
  }
  return matched;
}

function normalizeHltvSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
