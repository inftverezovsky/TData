import { applyDisciplineScheduleLead, formatMoscowDate, formatMoscowDateTime } from "@backend/matches/scheduleOffset";

type ExportTournament = {
  name: string;
  sourceTitle: string;
  sourceUrl: string;
  startDate: Date | string | null;
  endDate: Date | string | null;
  location: string | null;
  region: string | null;
  organizer: string | null;
  prizePool: string | null;
  formatText: string | null;
  status: string | null;
  participants: Array<{
    name: string;
    region: string | null;
    status: string | null;
    seed: string | null;
  }>;
  matches: Array<{
    matchId: string | null;
    matchDate: Date | string | null;
    matchDateTime: string | null;
    stage: string | null;
    round: string | null;
    teamAId: string | null;
    teamAName: string | null;
    teamBId: string | null;
    teamBName: string | null;
    scoreA: number | null;
    scoreB: number | null;
    format: string | null;
    status: string | null;
    court: string | null;
    sourceUrl: string | null;
  }>;
};

export function tournamentToMarkdown(tournament: ExportTournament, disciplineSlug?: string) {
  const lines: string[] = [];
  lines.push(`# ${tournament.name}`);
  lines.push("");
  lines.push(`Source: ${tournament.sourceUrl}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(`- Page: ${tournament.sourceTitle}`);
  lines.push(`- Dates: ${formatDate(tournament.startDate) ?? "—"} — ${formatDate(tournament.endDate) ?? "—"}`);
  lines.push(`- Location: ${tournament.location ?? "—"}`);
  lines.push(`- Region: ${tournament.region ?? "—"}`);
  lines.push(`- Organizer: ${tournament.organizer ?? "—"}`);
  lines.push(`- Prize pool: ${tournament.prizePool ?? "—"}`);
  lines.push(`- Status: ${tournament.status ?? "—"}`);
  lines.push("");

  lines.push("## Participants");
  lines.push("");
  if (tournament.participants.length > 0) {
    lines.push("| Team | Region | Status |");
    lines.push("|---|---|---|");
    for (const participant of tournament.participants) {
      lines.push(`| ${escapeMarkdown(participant.name)} | ${escapeMarkdown(participant.region ?? "—")} | ${escapeMarkdown(participant.status ?? "—")} |`);
    }
  } else {
    lines.push("No participants extracted.");
  }
  lines.push("");

  lines.push("## Matches");
  lines.push("");
  if (tournament.matches.length > 0) {
    lines.push("| Match ID | Date | Team A | Team B | Court | Stage | Score | Status |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const match of tournament.matches) {
      const score = `${match.scoreA ?? "—"}:${match.scoreB ?? "—"}`;
      const id = match.matchId ? match.matchId.slice(0, 12) : "—";
      lines.push(`| ${escapeMarkdown(id)} | ${formatDateTime(match.matchDate, disciplineSlug) ?? match.matchDateTime ?? "—"} | ${escapeMarkdown(match.teamAName ?? "TBD")} | ${escapeMarkdown(match.teamBName ?? "TBD")} | ${escapeMarkdown(match.court ?? "—")} | ${escapeMarkdown(match.stage ?? match.round ?? "—")} | ${score} | ${escapeMarkdown(match.status ?? "—")} |`);
    }
  } else {
    lines.push("No matches extracted.");
  }

  return lines.join("\n");
}

export function participantsToCsv(tournament: ExportTournament) {
  return toCsv(
    ["team", "region", "status", "seed", "source_url"],
    tournament.participants.map((participant) => [
      participant.name,
      participant.region ?? "",
      participant.status ?? "",
      participant.seed ?? "",
      tournament.sourceUrl
    ])
  );
}

export function matchesToCsv(tournament: ExportTournament, disciplineSlug?: string) {
  return toCsv(
    ["match_id", "match_date_time", "date", "stage", "round", "team_a_id", "team_a_name", "team_b_id", "team_b_name", "court", "score_a", "score_b", "format", "status", "source_url"],
    tournament.matches.map((match) => [
      match.matchId ?? "",
      formatDateTime(match.matchDate, disciplineSlug) ?? match.matchDateTime ?? "",
      formatDate(match.matchDate, disciplineSlug) ?? "",
      match.stage ?? "",
      match.round ?? "",
      match.teamAId ?? "",
      match.teamAName ?? "",
      match.teamBId ?? "",
      match.teamBName ?? "",
      match.court ?? "",
      match.scoreA?.toString() ?? "",
      match.scoreB?.toString() ?? "",
      match.format ?? "",
      match.status ?? "",
      match.sourceUrl ?? tournament.sourceUrl
    ])
  );
}

function toCsv(headers: string[], rows: string[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDate(value?: Date | string | null, disciplineSlug?: string) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatMoscowDate(applyDisciplineScheduleLead(date, disciplineSlug));
}

function formatDateTime(value?: Date | string | null, disciplineSlug?: string) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatMoscowDateTime(applyDisciplineScheduleLead(date, disciplineSlug));
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, "\\|");
}
