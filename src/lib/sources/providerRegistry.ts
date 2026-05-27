import type { TournamentSource } from "@/lib/utils/tournamentSource";

export interface SourceProviderDefinition {
  id: TournamentSource;
  label: string;
  supportsStageAnnouncements: boolean;
  isBeachVolleyball: boolean;
  hostnames: readonly string[];
  fallbackPatterns: readonly RegExp[];
}

export const sourceProviders = [
  {
    id: "liquipedia",
    label: "Источник: Liquipedia",
    supportsStageAnnouncements: true,
    isBeachVolleyball: false,
    hostnames: ["liquipedia.net"],
    fallbackPatterns: [/(^|\/\/)(?:www\.)?liquipedia\.net\//i],
  },
  {
    id: "hltv",
    label: "Источник: HLTV",
    supportsStageAnnouncements: true,
    isBeachVolleyball: false,
    hostnames: ["hltv.org"],
    fallbackPatterns: [/(^|\/\/)(www\.)?hltv\.org\//i],
  },
  {
    id: "vlr",
    label: "Источник: VLR",
    supportsStageAnnouncements: true,
    isBeachVolleyball: false,
    hostnames: ["vlr.gg"],
    fallbackPatterns: [/(^|\/\/)(www\.)?vlr\.gg\//i],
  },
  {
    id: "dltv",
    label: "Источник: DLTV",
    supportsStageAnnouncements: true,
    isBeachVolleyball: false,
    hostnames: ["dltv.org"],
    fallbackPatterns: [/(^|\/\/)(?:ru\.)?dltv\.org\//i],
  },
  {
    id: "fandom",
    label: "Источник: Fandom",
    supportsStageAnnouncements: true,
    isBeachVolleyball: false,
    hostnames: ["lol.fandom.com"],
    fallbackPatterns: [/(^|\/\/)lol\.fandom\.com\//i],
  },
  {
    id: "volleyballworld",
    label: "Источник: VolleyballWorld",
    supportsStageAnnouncements: true,
    isBeachVolleyball: true,
    hostnames: ["volleyballworld.com"],
    fallbackPatterns: [/(^|\/\/)(?:www\.|en\.)?volleyballworld\.com\//i],
  },
  {
    id: "beachvolleyru",
    label: "Источник: beach.volley.ru",
    supportsStageAnnouncements: true,
    isBeachVolleyball: true,
    hostnames: ["beach.volley.ru"],
    fallbackPatterns: [/(^|\/\/)beach\.volley\.ru\//i],
  },
  {
    id: "germanbeachtour",
    label: "Источник: German Beach Tour",
    supportsStageAnnouncements: true,
    isBeachVolleyball: true,
    hostnames: ["beach.volleyball-verband.de"],
    fallbackPatterns: [/(^|\/\/)beach\.volleyball-verband\.de\//i],
  },
] as const satisfies readonly SourceProviderDefinition[];

const sourceProviderById = new Map<TournamentSource, SourceProviderDefinition>(
  sourceProviders.map((provider) => [provider.id, provider]),
);

export function getSourceProvider(source: TournamentSource): SourceProviderDefinition {
  const provider = sourceProviderById.get(source);
  if (!provider) return sourceProviderById.get("liquipedia")!;
  return provider;
}

export function findSourceProviderByHostname(hostname: string): SourceProviderDefinition | null {
  const normalizedHost = hostname.toLowerCase();
  return (
    sourceProviders.find((provider) =>
      provider.hostnames.some((host) => normalizedHost === host || normalizedHost.endsWith(`.${host}`)),
    ) ?? null
  );
}

export function findSourceProviderByUrlText(urlText: string): SourceProviderDefinition | null {
  return sourceProviders.find((provider) => provider.fallbackPatterns.some((pattern) => pattern.test(urlText))) ?? null;
}
