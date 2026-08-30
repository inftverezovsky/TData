import {
  TLINE_FLOORBALL_PILOT_CHAMPIONSHIPS,
  TLINE_VOLLEYBALL_PILOT_CHAMPIONSHIPS,
} from "../backend/src/tline/pilot/bootstrap";
import { parseTLinePeriodBoundary } from "../backend/src/tline/pilot/period";
import { createDefaultOfficialSourceRegistry } from "../backend/src/tline/sources/registry";

const args = parseArgs(process.argv.slice(2));

async function main() {
  const from = parseTLinePeriodBoundary(args.from, "start");
  const to = parseTLinePeriodBoundary(args.to, "end");
  if (to <= from) throw new Error("--to must be later than --from");

  const registry = createDefaultOfficialSourceRegistry();
  const reports = [];
  const championships = [
    ...TLINE_VOLLEYBALL_PILOT_CHAMPIONSHIPS,
    ...TLINE_FLOORBALL_PILOT_CHAMPIONSHIPS,
  ];
  for (const championship of championships) {
    const adapter = registry.get(championship.sourceProvider);
    const snapshot = await adapter.fetchChampionship({
      championship: {
        id: championship.sourceChampionshipId,
        externalId: championship.sourceChampionshipId,
        name: championship.name,
        sourceUrl: championship.sourceUrl,
        sourceTimezone: championship.sourceTimezone,
      },
      from,
      to,
      forceFresh: true,
      includeUndatedSourceMatches: true,
    });
    const matchIds = new Set(snapshot.matches.map((match) => match.id));
    if (matchIds.size !== snapshot.matches.length) {
      throw new Error(`${championship.name}: ${championship.sourceProvider} returned duplicate match IDs`);
    }
    const missingTeamIds = snapshot.teams.filter((team) => !team.externalId?.trim());
    if (missingTeamIds.length > 0) {
      throw new Error(`${championship.name}: official team IDs were not resolved for ${missingTeamIds.length} teams`);
    }
    reports.push({
      provider: championship.sourceProvider,
      name: championship.name,
      season: championship.season,
      sourceChampionshipId: championship.sourceChampionshipId,
      sourceUrl: championship.sourceUrl,
      fetchedAt: snapshot.fetchedAt,
      matches: snapshot.matches.length,
      teams: snapshot.teams.length,
      exactTime: snapshot.matches.filter((match) => match.timePrecision === "EXACT").length,
      dateOnly: snapshot.matches.filter((match) => match.timePrecision === "DATE_ONLY").length,
      undefinedTime: snapshot.matches.filter((match) => match.timePrecision === "UNDEFINED").length,
      firstMatch: snapshot.matches.at(0) ? summarizeMatch(snapshot.matches[0]) : null,
      lastMatch: snapshot.matches.at(-1) ? summarizeMatch(snapshot.matches.at(-1)!) : null,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    period: { from: from.toISOString(), to: to.toISOString() },
    championships: reports,
  }, null, 2));
}

function parseArgs(values: readonly string[]) {
  const result = { from: "2026-08-01", to: "2027-05-31" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const inline = value.match(/^--(from|to)=(.+)$/u);
    if (inline) {
      result[inline[1] as "from" | "to"] = inline[2];
      continue;
    }
    if (value === "--from" || value === "--to") {
      const next = values[index + 1];
      if (!next) throw new Error(`${value} requires a value`);
      result[value.slice(2) as "from" | "to"] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function summarizeMatch(match: {
  readonly id: string;
  readonly home: { readonly sourceTeamId: string; readonly name: string };
  readonly away: { readonly sourceTeamId: string; readonly name: string };
  readonly startTimeRaw: string;
  readonly startTimeUtc: string | null;
  readonly startTimeMoscow?: string | null;
  readonly timePrecision?: string;
  readonly status: string;
}) {
  return {
    id: match.id,
    home: { id: match.home.sourceTeamId, name: match.home.name },
    away: { id: match.away.sourceTeamId, name: match.away.name },
    sourceTime: match.startTimeRaw,
    utc: match.startTimeUtc,
    moscow: match.startTimeMoscow ?? null,
    precision: match.timePrecision ?? "UNDEFINED",
    status: match.status,
  };
}

main().catch((error) => {
  console.error("TLine source check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
