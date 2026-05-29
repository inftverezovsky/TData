export type LiquipediaSearchResult = {
  pageId: number;
  title: string;
  pageUrl: string;
  snippet?: string | null;
  score?: number | null;
  wordCount?: number | null;
  dates?: string | null;
};

export type LiquipediaPageContent = {
  pageId?: number;
  title: string;
  fullUrl: string;
  wikitext: string;
  raw: unknown;
};

export type LiquipediaPageRevision = {
  pageId?: number;
  title: string;
  fullUrl: string;
  revisionId?: number | null;
  revisionTimestamp?: Date | null;
  raw: unknown;
};

export type SearchApiResponse = [string, string[], string[], string[]];

export type PageApiResponse = {
  query?: {
    pages?: Array<{
      pageid?: number;
      title: string;
      fullurl?: string;
      missing?: boolean;
      revisions?: Array<{
        revid?: number;
        timestamp?: string;
        slots?: {
          main?: {
            content?: string;
            "*"?: string;
          };
        };
        "*"?: string;
      }>;
    }>;
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
  };
};

export type SearchPageMetadata = {
  version?: number;
  pageId: number;
  title: string;
  pageUrl: string;
  isTournament: boolean;
  dates: string | null;
  fetchedAt: number;
};

export type ApiRequestOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  mode?: string;
};
