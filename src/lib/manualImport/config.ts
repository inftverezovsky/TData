export const ARCCODEX_API_BASE_URL = "https://www.arccodex.com/api/codex/v1";
export const ARCCODEX_RESPONSES_URL = `${ARCCODEX_API_BASE_URL}/responses`;
export const ARCCODEX_CHAT_COMPLETIONS_URL = `${ARCCODEX_API_BASE_URL}/chat/completions`;
export const MANUAL_IMPORT_MODEL = "gpt-5.5";
export const MANUAL_IMPORT_AI_TIMEOUT_MS = Number(process.env.MANUAL_IMPORT_AI_TIMEOUT_MS || 45_000);
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
} as const;

export type ManualImportDisciplineSlug = keyof typeof MANUAL_IMPORT_DISCIPLINES;

export function getManualImportDiscipline(slug: string) {
  return MANUAL_IMPORT_DISCIPLINES[slug as ManualImportDisciplineSlug] ?? null;
}
