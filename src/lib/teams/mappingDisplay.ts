export type TeamMappingNameSource = "admin" | "manual" | "missing";

export type AdminTeamDisplayRecord = {
  platformId: string;
  platformName: string;
};

export type TeamMappingDisplayInput = {
  teamName?: string | null;
  liquipediaName?: string | null;
  canonicalName?: string | null;
  platformId?: string | null;
  status?: string | null;
};

export type TeamMappingDisplay = {
  platformId: string | null;
  displayAdminName: string;
  adminTeamName: string | null;
  nameSource: TeamMappingNameSource;
  status: string | null;
};

export function buildAdminTeamDisplayLookup(adminTeams: readonly AdminTeamDisplayRecord[]) {
  const lookup = new Map<string, AdminTeamDisplayRecord>();

  for (const team of adminTeams) {
    const platformId = cleanText(team.platformId);
    if (platformId) lookup.set(platformId, team);
  }

  return lookup;
}

export function resolveTeamMappingDisplay(
  mapping: TeamMappingDisplayInput,
  adminTeamsByPlatformId: Map<string, AdminTeamDisplayRecord>
): TeamMappingDisplay {
  const platformId = cleanText(mapping.platformId);
  const manualName = cleanText(mapping.canonicalName) || cleanText(mapping.teamName) || cleanText(mapping.liquipediaName);

  if (!platformId) {
    return {
      platformId: null,
      displayAdminName: manualName,
      adminTeamName: null,
      nameSource: "missing",
      status: mapping.status || null,
    };
  }

  const adminName = cleanText(adminTeamsByPlatformId.get(platformId)?.platformName);
  if (adminName) {
    return {
      platformId,
      displayAdminName: adminName,
      adminTeamName: adminName,
      nameSource: "admin",
      status: mapping.status || null,
    };
  }

  return {
    platformId,
    displayAdminName: manualName,
    adminTeamName: null,
    nameSource: manualName ? "manual" : "missing",
    status: mapping.status || null,
  };
}

function cleanText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
