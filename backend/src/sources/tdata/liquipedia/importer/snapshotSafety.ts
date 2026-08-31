type LiquipediaPageHealthInput = {
  normalized?: {
    status?: unknown;
    warning?: unknown;
    // Normalizer diagnostics may be informational even when the semantic
    // status is SUCCESS; only the singular source warning is fail-closed.
    warnings?: unknown;
  } | null;
  stale?: unknown;
  warning?: unknown;
};

export type LiquipediaSnapshotHealth = {
  sourceValidated: boolean;
  aggregateStatus: "SUCCESS" | "PARTIAL";
  errorClass: "parse_failed" | null;
  reasons: string[];
};

export function assessLiquipediaSnapshotHealth(input: {
  pages: readonly LiquipediaPageHealthInput[];
  rejectedSubpages?: number;
}): LiquipediaSnapshotHealth {
  const reasons: string[] = [];

  input.pages.forEach((page, index) => {
    const pageLabel = index === 0 ? "main page" : `subpage ${index}`;
    const status = String(page.normalized?.status || "PARTIAL").toUpperCase();
    if (status !== "SUCCESS") reasons.push(`${pageLabel} status=${status}`);
    if (page.stale === true) reasons.push(`${pageLabel} used a stale snapshot`);
    const warningValues = [
      page.warning,
      page.normalized?.warning,
    ];
    const warnings = Array.from(new Set(warningValues
      .filter((warning): warning is string => typeof warning === "string" && Boolean(warning.trim()))
      .map((warning) => warning.trim())));
    for (const warning of warnings) {
      reasons.push(`${pageLabel} warning: ${warning}`);
    }
  });

  const rejectedSubpages = Math.max(0, Math.trunc(input.rejectedSubpages || 0));
  if (rejectedSubpages > 0) reasons.push(`${rejectedSubpages} subpage request(s) rejected`);

  if (reasons.length === 0) {
    return {
      sourceValidated: true,
      aggregateStatus: "SUCCESS",
      errorClass: null,
      reasons: [],
    };
  }

  return {
    sourceValidated: false,
    aggregateStatus: "PARTIAL",
    errorClass: "parse_failed",
    reasons,
  };
}

export function buildLiquipediaStableTournamentKey(input: {
  disciplineSlug: string;
  sourcePageId?: number | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}) {
  const disciplineSlug = String(input.disciplineSlug || "unknown").trim().toLowerCase();
  if (Number.isInteger(input.sourcePageId) && Number(input.sourcePageId) > 0) {
    return `page:${disciplineSlug}:${Number(input.sourcePageId)}`;
  }

  const canonicalUrl = canonicalizeLiquipediaSourceUrl(input.sourceUrl);
  if (canonicalUrl) return `url:${disciplineSlug}:${canonicalUrl}`;

  return `title:${disciplineSlug}:${String(input.sourceTitle || "unknown").trim().toLowerCase()}`;
}

export function canonicalizeLiquipediaSourceUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

export function preserveLiquipediaMatchState<T extends Record<string, unknown>>(
  incoming: T,
  existing?: {
    platformId?: unknown;
    syncedAt?: unknown;
    lpNumericalId?: unknown;
  } | null,
): T {
  if (!existing) return { ...incoming };

  return {
    ...incoming,
    platformId: existing.platformId ?? incoming.platformId ?? null,
    syncedAt: existing.syncedAt ?? incoming.syncedAt ?? null,
    lpNumericalId: existing.lpNumericalId ?? incoming.lpNumericalId ?? null,
  } as T;
}
