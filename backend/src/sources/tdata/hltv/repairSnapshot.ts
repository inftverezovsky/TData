import { normalizeHltvEventUrl, normalizeHltvTournamentTitle } from "./importTournament";

const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_MATCHES = 256;

type ExpectedHltvRepairSnapshot = {
  eventId: string;
  eventUrl: string;
  title: string;
  now?: Date;
};

export type ValidatedHltvRepairMatch = {
  id: string;
  tournament: string;
  team1: string;
  team2: string;
  unix_time: number;
  format: string;
  stage: string;
  round: string;
  rawText: string;
  isLive: boolean;
};

export function validateHltvRepairSnapshot(
  value: unknown,
  expected: ExpectedHltvRepairSnapshot,
): ValidatedHltvRepairMatch[] {
  const snapshot = requireRecord(value, "HLTV repair snapshot must be a JSON object");
  const expectedUrl = normalizeHltvEventUrl(expected.eventUrl);
  const expectedTitle = normalizeHltvTournamentTitle(expected.title);

  if (snapshot.source !== "hltv-official") {
    throw new Error("HLTV repair snapshot must identify the official source");
  }
  if (String(snapshot.eventId || "") !== expected.eventId) {
    throw new Error("HLTV repair snapshot event ID does not match the requested event");
  }
  if (normalizeHltvEventUrl(readString(snapshot.eventUrl, "eventUrl", 500)) !== expectedUrl) {
    throw new Error("HLTV repair snapshot event URL does not match the requested event");
  }
  if (normalizeHltvTournamentTitle(readString(snapshot.title, "title", 200)) !== expectedTitle) {
    throw new Error("HLTV repair snapshot title does not match the requested event");
  }

  assertFreshTimestamp(snapshot.fetchedAt, expected.now ?? new Date());
  if (!Array.isArray(snapshot.matches) || snapshot.matches.length === 0) {
    throw new Error("HLTV repair snapshot requires a non-empty matches array");
  }
  if (snapshot.matches.length > MAX_MATCHES) {
    throw new Error(`HLTV repair snapshot exceeds the ${MAX_MATCHES}-match safety limit`);
  }

  const seenIds = new Set<string>();
  return snapshot.matches.map((value, index) => {
    const match = requireRecord(value, `HLTV repair match ${index + 1} must be an object`);
    const id = readString(match.id, `matches[${index}].id`, 20);
    if (!/^[1-9]\d{0,15}$/.test(id)) {
      throw new Error(`HLTV repair match ${index + 1} has an invalid match ID`);
    }
    if (seenIds.has(id)) {
      throw new Error(`HLTV repair snapshot contains duplicate match ID ${id}`);
    }
    seenIds.add(id);
    assertOfficialMatchUrl(match.sourceUrl, id, index);

    const tournament = normalizeHltvTournamentTitle(readString(match.tournament, `matches[${index}].tournament`, 200));
    if (tournament !== expectedTitle) {
      throw new Error(`HLTV repair match ${index + 1} belongs to another tournament`);
    }
    const unixTime = Number(match.unix_time);
    const nowSeconds = Math.floor((expected.now ?? new Date()).getTime() / 1000);
    if (!Number.isSafeInteger(unixTime) || unixTime < 946_684_800 || unixTime > nowSeconds + 366 * 24 * 60 * 60) {
      throw new Error(`HLTV repair match ${index + 1} has an invalid timestamp`);
    }
    const format = readOptionalString(match.format, `matches[${index}].format`, 20).toUpperCase();
    if (format && !/^BO[1-9]\d?$/.test(format)) {
      throw new Error(`HLTV repair match ${index + 1} has an invalid format`);
    }

    return {
      id,
      tournament,
      team1: readString(match.team1, `matches[${index}].team1`, 160),
      team2: readString(match.team2, `matches[${index}].team2`, 160),
      unix_time: unixTime,
      format,
      stage: readOptionalString(match.stage, `matches[${index}].stage`, 200),
      round: readOptionalString(match.round ?? match.stage, `matches[${index}].round`, 200),
      rawText: readOptionalString(match.rawText, `matches[${index}].rawText`, 1_500),
      isLive: match.isLive === true,
    };
  });
}

function assertFreshTimestamp(value: unknown, now: Date) {
  const fetchedAt = new Date(readString(value, "fetchedAt", 100));
  if (Number.isNaN(fetchedAt.getTime())) {
    throw new Error("HLTV repair snapshot fetchedAt must be an ISO timestamp");
  }
  const ageMs = now.getTime() - fetchedAt.getTime();
  if (ageMs < -MAX_CLOCK_SKEW_MS || ageMs > MAX_SNAPSHOT_AGE_MS) {
    throw new Error("HLTV repair snapshot must be fresh (no older than 24 hours)");
  }
}

function assertOfficialMatchUrl(value: unknown, id: string, index: number) {
  let url: URL;
  try {
    url = new URL(readString(value, `matches[${index}].sourceUrl`, 500));
  } catch {
    throw new Error(`HLTV repair match ${index + 1} has an invalid official match URL`);
  }
  if (
    url.protocol !== "https:"
    || !["hltv.org", "www.hltv.org"].includes(url.hostname.toLowerCase())
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || !url.pathname.startsWith(`/matches/${id}/`)
  ) {
    throw new Error(`HLTV repair match ${index + 1} has an invalid official match URL`);
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function readString(value: unknown, name: string, maxLength: number) {
  const normalized = String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`HLTV repair snapshot field ${name} is invalid`);
  }
  return normalized;
}

function readOptionalString(value: unknown, name: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return "";
  return readString(value, name, maxLength);
}
