import { generateInternalTeamId, isPlaceholderTeam, normalizeTeamName } from "@backend/teams/teams";

export type TeamNameSource = {
  name?: string | null;
  rawText?: string | null;
  liquipediaName?: string | null;
  canonicalName?: string | null;
  alias?: string | null;
  platformId?: string | null;
  logoUrl?: string | null;
};

export type TeamMatchLike = {
  teamAId?: string | null;
  teamAName?: string | null;
  teamBId?: string | null;
  teamBName?: string | null;
};

export type TeamCanonicalizer = {
  canonicalizeName: (name: string | null | undefined) => string | null | undefined;
};

type AliasEntry = {
  key: string;
  canonicalName: string;
  score: number;
};

const TEAM_SUFFIXES = new Set([
  "esports",
  "esport",
  "gaming",
  "club",
  "clan",
  "team",
]);

const TEAM_PREFIXES = new Set(["the", "team"]);
const AMBIGUOUS_TOKENS = new Set(["the", "team", "esports", "esport", "gaming", "club", "clan"]);
const QUALIFIER_TOKENS = new Set([
  "academy",
  "junior",
  "juniors",
  "youth",
  "female",
  "fe",
  "red",
  "blue",
  "black",
  "white",
  "gold",
  "challengers",
]);

export function buildTeamNameCanonicalizer(params: {
  participants?: TeamNameSource[];
  mappings?: TeamNameSource[];
  extraNames?: Array<string | null | undefined>;
}): TeamCanonicalizer {
  const entries: AliasEntry[] = [];

  for (const participant of params.participants ?? []) {
    addNameSource(entries, {
      displayName: participant.name,
      aliases: extractAliasesFromRawText(participant.rawText),
      baseScore: 800,
    });
  }

  for (const mapping of params.mappings ?? []) {
    const displayName = firstNonEmpty(mapping.canonicalName, mapping.liquipediaName, mapping.name);
    addNameSource(entries, {
      displayName,
      aliases: [
        mapping.liquipediaName,
        mapping.name,
        ...splitAliasList(mapping.alias),
      ],
      baseScore: mapping.platformId ? 950 : 875,
    });
  }

  for (const name of params.extraNames ?? []) {
    addNameSource(entries, {
      displayName: name,
      aliases: [],
      baseScore: 700,
    });
  }

  const aliasMap = buildAliasMap(entries);

  return {
    canonicalizeName(name) {
      if (!name || isPlaceholderTeam(name)) return name;

      const keys = getLookupKeys(name);
      for (const key of keys) {
        const canonical = aliasMap.get(key);
        if (canonical) return canonical;
      }

      return name;
    },
  };
}

export function canonicalizeParticipants<T extends { name: string; platformId?: string | null; logoUrl?: string | null; rawText?: string | null }>(
  participants: readonly T[],
  canonicalizer: TeamCanonicalizer
): T[] {
  const byName = new Map<string, T>();

  for (const participant of participants) {
    const canonicalName = canonicalizer.canonicalizeName(participant.name) || participant.name;
    const normalized = { ...participant, name: canonicalName } as T;
    const key = normalizeTeamName(canonicalName);
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, normalized);
      continue;
    }

    byName.set(key, mergeParticipant(existing, normalized));
  }

  return Array.from(byName.values());
}

export function canonicalizeMatchTeams<T extends TeamMatchLike>(match: T, canonicalizer: TeamCanonicalizer): T {
  const teamAName = canonicalizer.canonicalizeName(match.teamAName) ?? match.teamAName ?? null;
  const teamBName = canonicalizer.canonicalizeName(match.teamBName) ?? match.teamBName ?? null;

  return {
    ...match,
    teamAName,
    teamAId: teamAName && !isPlaceholderTeam(teamAName) ? generateInternalTeamId(teamAName) : match.teamAId,
    teamBName,
    teamBId: teamBName && !isPlaceholderTeam(teamBName) ? generateInternalTeamId(teamBName) : match.teamBId,
  };
}

export function getTeamAliasKey(name: string | null | undefined) {
  const normalized = normalizeTeamName(String(name ?? ""));
  if (!normalized) return "";

  const tokens = normalized
    .replace(/\be\s+sports\b/g, "esports")
    .split(" ")
    .filter(Boolean);

  while (tokens[0] === "the") tokens.shift();
  while (tokens.length > 1 && TEAM_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();

  return tokens.join(" ") || normalized;
}

export function getTeamMappingLookupKeys(source: TeamNameSource) {
  const keys = new Set<string>();
  for (const value of [
    source.name,
    source.liquipediaName,
    source.canonicalName,
    ...splitAliasList(source.alias),
  ]) {
    addLookupKeys(keys, value);
  }
  return Array.from(keys);
}

function addNameSource(
  entries: AliasEntry[],
  params: { displayName?: string | null; aliases: Array<string | null | undefined>; baseScore: number }
) {
  const displayName = cleanDisplayName(params.displayName);
  if (!displayName || isPlaceholderTeam(displayName)) return;

  addEntry(entries, displayName, displayName, params.baseScore);
  addEntry(entries, getTeamAliasKey(displayName), displayName, params.baseScore + 20);

  for (const alias of params.aliases) {
    addEntry(entries, alias, displayName, params.baseScore + 250);
    addEntry(entries, getTeamAliasKey(alias), displayName, params.baseScore + 240);
  }

  for (const key of getContextualAliasKeys(displayName)) {
    addEntry(entries, key, displayName, params.baseScore + 60);
  }
}

function buildAliasMap(entries: AliasEntry[]) {
  const buckets = new Map<string, AliasEntry[]>();
  const resolved = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.key || entry.key.length < 2) continue;
    const bucket = buckets.get(entry.key) ?? [];
    bucket.push(entry);
    buckets.set(entry.key, bucket);
  }

  for (const [key, bucket] of buckets) {
    const ranked = bucket
      .map((entry) => ({
        ...entry,
        score: entry.score + displayNameScore(entry.canonicalName),
      }))
      .sort((a, b) => b.score - a.score);

    const top = ranked[0];
    const conflictingTop = ranked.find((entry) =>
      entry.canonicalName !== top.canonicalName && Math.abs(entry.score - top.score) < 0.001
    );

    if (!conflictingTop) {
      resolved.set(key, top.canonicalName);
    }
  }

  return resolved;
}

function getLookupKeys(name: string) {
  const clean = cleanDisplayName(name);
  return [
    normalizeTeamName(clean),
    getTeamAliasKey(clean),
    clean.toLowerCase(),
    clean,
  ].filter(Boolean);
}

function addLookupKeys(keys: Set<string>, value: string | null | undefined) {
  const clean = cleanDisplayName(value);
  if (!clean) return;

  keys.add(clean);
  keys.add(clean.toLowerCase());
  keys.add(normalizeTeamName(clean));
  keys.add(getTeamAliasKey(clean));
}

function addEntry(entries: AliasEntry[], rawKey: string | null | undefined, canonicalName: string, score: number) {
  const keys = new Set<string>();
  addLookupKeys(keys, rawKey);
  for (const key of keys) {
    if (key) entries.push({ key, canonicalName, score });
  }
}

function getContextualAliasKeys(displayName: string) {
  const normalized = normalizeTeamName(displayName);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.some((token) => QUALIFIER_TOKENS.has(token))) return [];

  const meaningful = tokens.filter((token) => !TEAM_PREFIXES.has(token) && !TEAM_SUFFIXES.has(token));
  const keys = new Set<string>();
  const first = meaningful[0];

  if (first && isSafeShortAlias(first)) keys.add(first);

  const withoutPrefix = tokens.filter((token, index) => index > 0 || !TEAM_PREFIXES.has(token)).join(" ");
  if (withoutPrefix && withoutPrefix !== normalized) keys.add(withoutPrefix);

  return Array.from(keys);
}

function isSafeShortAlias(value: string) {
  if (AMBIGUOUS_TOKENS.has(value)) return false;
  return value.length >= 3 || (value.length >= 2 && /\d/.test(value));
}

function extractAliasesFromRawText(rawText: string | null | undefined) {
  if (!rawText) return [];

  const aliases = new Set<string>();
  const wikiLinks = rawText.matchAll(/\[\[[^\]|]+\|([^\]]+)\]\]/g);
  for (const match of wikiLinks) aliases.add(match[1].trim());

  const templateAlias = rawText.match(/\{\{[^|}]+\|[^|}]+\|([^|}]+)\}\}/);
  if (templateAlias?.[1]) aliases.add(templateAlias[1].trim());

  const linkParam = rawText.match(/\|\s*(?:name|display|short|alias)\s*=\s*([^|}\n]+)/i);
  if (linkParam?.[1]) aliases.add(linkParam[1].trim());

  return Array.from(aliases).filter(Boolean);
}

function splitAliasList(alias: string | null | undefined) {
  return String(alias ?? "")
    .split(/[,;|]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function mergeParticipant<T extends { platformId?: string | null; logoUrl?: string | null; rawText?: string | null }>(left: T, right: T) {
  return {
    ...left,
    platformId: left.platformId || right.platformId || null,
    logoUrl: left.logoUrl || right.logoUrl || null,
    rawText: left.rawText || right.rawText || null,
  } as T;
}

function displayNameScore(name: string) {
  return Math.min(name.length, 80) / 100;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => cleanDisplayName(value));
}

function cleanDisplayName(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
