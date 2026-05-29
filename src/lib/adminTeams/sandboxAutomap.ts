import { parseAdminTeamImportRows } from "@/lib/adminTeams/importSpreadsheet";
import { buildAutoMappingPreviewFromData, type AutoMappingAdminTeam } from "@/lib/teams/autoMappingPreview";

export function parseSourceNamesText(sourceNames: string) {
  return Array.from(
    new Set(
      sourceNames
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean)
    )
  );
}

export function buildSandboxAutoMappingPreviewFromRows(sourceNames: string, rows: unknown[][]) {
  const teamNames = parseSourceNamesText(sourceNames);
  const parsed = parseSandboxAdminTeamsFromRows(rows);

  return buildSandboxAutoMappingPreviewFromParsed(sourceNames, teamNames, parsed);
}

export function parseSandboxAdminTeamsFromRows(rows: unknown[][]) {
  const { layout, records, skippedCount } = parseAdminTeamImportRows(rows);
  const adminTeams: AutoMappingAdminTeam[] = records.map((record) => ({
    platformId: record.platformId,
    platformName: record.platformName,
    platformNameRu: record.platformNameRu,
    platformNameEn: record.platformNameEn,
    normalizedName: record.normalizedName,
    normalizedNameRu: record.normalizedNameRu,
    normalizedNameEn: record.normalizedNameEn,
  }));

  return { layout, records, skippedCount, adminTeams };
}

export function buildSandboxAutoMappingPreviewFromParsed(
  sourceNames: string,
  teamNames: string[],
  parsed: ReturnType<typeof parseSandboxAdminTeamsFromRows>
) {
  return {
    teamNames,
    layout: parsed.layout,
    records: parsed.records,
    skippedCount: parsed.skippedCount,
    preview: buildAutoMappingPreviewFromData({
      teamNames,
      mappings: [],
      adminTeams: parsed.adminTeams,
    }),
  };
}
