import { normalizeTeamName } from "@backend/teams/teams";
import { getTeamAliasKey, getTeamMappingLookupKeys, type TeamNameSource } from "@backend/teams/canonicalize";

export type TeamMappingForLookup = TeamNameSource & {
  status?: string | null;
  isManual?: boolean | null;
  isLockedFromAutoMapping?: boolean | null;
};

export function buildTeamMappingLookup<T extends TeamMappingForLookup>(mappings: readonly T[]) {
  const lookup = new Map<string, T>();

  for (const mapping of mappings) {
    for (const key of getTeamMappingLookupKeys(mapping)) {
      setPreferredMapping(lookup, key, mapping);
    }
  }

  return lookup;
}

export function findTeamMapping<T>(lookup: Map<string, T>, name: string | null | undefined) {
  const rawName = String(name ?? "").trim();
  if (!rawName) return undefined;

  return lookup.get(rawName.toLowerCase())
    || lookup.get(normalizeTeamName(rawName).toLowerCase())
    || lookup.get(getTeamAliasKey(rawName).toLowerCase());
}

function setPreferredMapping<T extends TeamMappingForLookup>(lookup: Map<string, T>, key: string | null | undefined, mapping: T) {
  const normalizedKey = String(key ?? "").trim().toLowerCase();
  if (!normalizedKey) return;

  const existing = lookup.get(normalizedKey);
  if (!existing || mappingPriority(mapping) > mappingPriority(existing)) {
    lookup.set(normalizedKey, mapping);
  }
}

function mappingPriority(mapping: TeamMappingForLookup) {
  let score = 0;

  if (mapping.platformId) score += 1000;
  if (mapping.isLockedFromAutoMapping) score += 120;
  if (mapping.isManual) score += 100;
  if (mapping.status === "manual_mapped") score += 80;
  if (mapping.status === "auto_mapped") score += 40;
  if (mapping.status === "manual_unmapped") score -= 20;
  if (mapping.status === "unmapped") score -= 50;
  if (mapping.canonicalName) score += 10;
  if (mapping.alias) score += 5;

  return score;
}
