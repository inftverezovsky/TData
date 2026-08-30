const MATCH_PAGE_SIZE = 100;
const MAX_MATCH_WINDOW = 10_000;

type MatchPage<T> = {
  matches: T[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
};

export function shouldApplyKhlMatchWindow(
  requestedDepth: number,
  currentDepth: number
) {
  return requestedDepth >= currentDepth;
}

export async function loadKhlMatchWindow<T extends { id: string }>(
  requestedCount: number,
  loadPage: (offset: number, limit: number) => Promise<MatchPage<T>>
) {
  const targetCount = Math.max(
    MATCH_PAGE_SIZE,
    Math.min(MAX_MATCH_WINDOW, Math.trunc(requestedCount) || MATCH_PAGE_SIZE)
  );
  const matches: T[] = [];
  const knownIds = new Set<string>();
  let offset = 0;
  let total = 0;
  let hasMore = false;

  while (offset < targetCount) {
    const page = await loadPage(offset, MATCH_PAGE_SIZE);
    total = page.pagination.total;
    hasMore = page.pagination.hasMore;
    for (const match of page.matches) {
      if (knownIds.has(match.id)) continue;
      knownIds.add(match.id);
      matches.push(match);
    }

    const nextOffset = page.pagination.offset + page.matches.length;
    if (!page.pagination.hasMore || page.matches.length === 0 || nextOffset <= offset) {
      offset = nextOffset;
      break;
    }
    offset = nextOffset;
  }

  return {
    matches,
    total,
    hasMore: hasMore || matches.length < total,
    loadedDepth: hasMore ? targetCount : matches.length,
  };
}
