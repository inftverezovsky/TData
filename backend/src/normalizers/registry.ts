import { normalizeCounterStrikeTournament } from "./counterstrikeTournament";
import { normalizeDota2Tournament } from "./dota2Tournament";
import { normalizeLeagueOfLegendsTournament } from "./leagueoflegendsTournament";
import { normalizeValorantTournament } from "./valorantTournament";
import type { NormalizedTournament } from "./types";

export type NormalizerFunction = (input: {
  pageId?: number;
  title: string;
  pageUrl: string;
  wikitext: string;
  parsedHtml?: string;
}) => NormalizedTournament;

const NORMALIZER_REGISTRY: Record<string, NormalizerFunction> = {
  counterstrike: normalizeCounterStrikeTournament,
  dota2: normalizeDota2Tournament,
  leagueoflegends: normalizeLeagueOfLegendsTournament,
  valorant: normalizeValorantTournament,
};

/**
 * Returns the tournament wikitext normalizer function for the specified discipline slug.
 * Throws an error if the discipline slug is unsupported.
 */
export function getNormalizer(disciplineSlug: string): NormalizerFunction {
  const slug = disciplineSlug.trim().toLowerCase();
  const normalizer = NORMALIZER_REGISTRY[slug];
  if (!normalizer) {
    throw new Error(`Unsupported discipline slug for normalizer registry: "${disciplineSlug}"`);
  }
  return normalizer;
}

/**
 * Checks if the given discipline slug is registered in the normalizer system.
 */
export function hasNormalizer(disciplineSlug: string): boolean {
  const slug = disciplineSlug.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NORMALIZER_REGISTRY, slug);
}

/**
 * Returns a list of all registered discipline slugs.
 */
export function getSupportedDisciplines(): string[] {
  return Object.keys(NORMALIZER_REGISTRY);
}
