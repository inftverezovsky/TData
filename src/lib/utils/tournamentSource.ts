import {
  findSourceProviderByHostname,
  findSourceProviderByUrlText,
  getSourceProvider,
  sourceProviders,
  type SourceProviderDefinition,
} from "@/lib/sources/providerRegistry";

export type TournamentSource =
  | "liquipedia"
  | "hltv"
  | "vlr"
  | "dltv"
  | "fandom"
  | "volleyballworld"
  | "beachvolleyru"
  | "germanbeachtour";

export function detectTournamentSource(pageUrl?: string | null): TournamentSource {
  if (!pageUrl) return "liquipedia";

  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    return findSourceProviderByHostname(host)?.id ?? "liquipedia";
  } catch {
    return findSourceProviderByUrlText(pageUrl)?.id ?? "liquipedia";
  }
}

export function getTournamentSourceLabel(source: TournamentSource) {
  return getSourceProvider(source).label;
}

export function supportsStageAnnouncements(source?: TournamentSource | null) {
  return Boolean(source && getSourceProvider(source).supportsStageAnnouncements);
}

export function isBeachVolleyballTournamentSource(source?: TournamentSource | null) {
  return Boolean(source && getSourceProvider(source).isBeachVolleyball);
}

export { getSourceProvider, sourceProviders, type SourceProviderDefinition };
export { createImportEnvelope, type ImportEnvelope } from "@/lib/sources/importEnvelope";
