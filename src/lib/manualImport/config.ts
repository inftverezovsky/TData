export const ARCCODEX_API_BASE_URL = "https://www.arccodex.com/api/codex/v1";
export const ARCCODEX_RESPONSES_URL = `${ARCCODEX_API_BASE_URL}/responses`;
export const ARCCODEX_CHAT_COMPLETIONS_URL = `${ARCCODEX_API_BASE_URL}/chat/completions`;
export const MANUAL_IMPORT_MODEL = "gpt-5.5";
export const MANUAL_IMPORT_AI_TIMEOUT_MS = Number(process.env.MANUAL_IMPORT_AI_TIMEOUT_MS || 25_000);
export const MANUAL_IMPORT_TOURNAMENT_ID = "manual-import";
export const MANUAL_IMPORT_SERVICE_CACHE_TTL_MS = 30 * 60 * 1000;

export const MANUAL_IMPORT_DISCIPLINES = {
  dota2: {
    slug: "dota2",
    label: "Dota 2",
  },
  counterstrike: {
    slug: "counterstrike",
    label: "Counter-Strike",
  },
  leagueoflegends: {
    slug: "leagueoflegends",
    label: "League of Legends",
  },
  valorant: {
    slug: "valorant",
    label: "Valorant",
  },
  "beachvolleyball-men": {
    slug: "beachvolleyball-men",
    label: "Пляжный волейбол (м)",
  },
  "beachvolleyball-women": {
    slug: "beachvolleyball-women",
    label: "Пляжный волейбол (ж)",
  },
  "tabletennis-men": {
    slug: "tabletennis-men",
    label: "TableT WTT мужчины",
  },
  "tabletennis-women": {
    slug: "tabletennis-women",
    label: "TableT WTT женщины",
  },
  "tabletennis-men-doubles": {
    slug: "tabletennis-men-doubles",
    label: "TableT WTT муж. пары",
  },
  "tabletennis-women-doubles": {
    slug: "tabletennis-women-doubles",
    label: "TableT WTT жен. пары",
  },
  "tabletennis-mixed": {
    slug: "tabletennis-mixed",
    label: "TableT WTT микст",
  },
} as const;

export type ManualImportDisciplineSlug = keyof typeof MANUAL_IMPORT_DISCIPLINES;

export function normalizeManualImportDisciplineId(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^[1-9]\d*$/.test(text) ? text : "";
}

export function resolveManualImportDisciplineSlug(input: {
  disciplineId?: unknown;
  disciplineSlug?: unknown;
}) {
  const disciplineId = normalizeManualImportDisciplineId(input.disciplineId);
  if (disciplineId) return disciplineId;

  const legacySlug = typeof input.disciplineSlug === "string" ? input.disciplineSlug.trim().toLowerCase() : "";
  return MANUAL_IMPORT_DISCIPLINES[legacySlug as ManualImportDisciplineSlug]?.slug || "";
}

export function getManualImportDiscipline(slug: string) {
  const normalized = String(slug || "").trim().toLowerCase();
  if (normalizeManualImportDisciplineId(normalized)) {
    return { slug: normalized };
  }
  return MANUAL_IMPORT_DISCIPLINES[normalized as ManualImportDisciplineSlug] ?? null;
}
