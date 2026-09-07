import { readBoundedBodyText } from "@backend/http/boundedResponse";

export const FEDERVOLLEY_OFFICIAL_JSON_ORIGIN =
  "https://pub-8394085fb0ca451eaa42bc05b01c416f.r2.dev";
export const FEDERVOLLEY_OFFICIAL_JSON_BASE =
  `${FEDERVOLLEY_OFFICIAL_JSON_ORIGIN}/public/json`;

const FEDERVOLLEY_OFFICIAL_USER_AGENT =
  "TData TBvolley/1.0 (+https://www.federvolley.it/campionati/beach-volley)";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_DISCIPLINE_PAGES = 50;
const PAGE_CONCURRENCY = 3;

export type FedervolleyOfficialTournamentRow = Record<string, unknown> & {
  path?: unknown;
  codice?: unknown;
  girone_index?: unknown;
  codice_torneo?: unknown;
  tipologia?: unknown;
  luogo?: unknown;
  dal?: unknown;
  al?: unknown;
  genere?: unknown;
  montepremi?: unknown;
  ranking_type?: unknown;
  menu_eventi?: unknown;
  menu_eventi_label?: unknown;
  regione?: unknown;
  comune?: unknown;
  data_inizio_iso?: unknown;
  data_fine_iso?: unknown;
};

export async function fetchFedervolleyOfficialTournamentRows(
  year: number,
  signal?: AbortSignal,
): Promise<FedervolleyOfficialTournamentRow[]> {
  const season = validateSeason(year);
  const root = await fetchOfficialJson(`${season}/discipline.json`, signal);
  const direct = extractFedervolleyOfficialTournamentRows(root);
  if (direct.length > 0 || hasBeachVolleySeries(root)) return direct;

  const record = asRecord(root);
  const pages = Array.isArray(record?.pages) ? record.pages : null;
  if (!pages || pages.length === 0 || pages.length > MAX_DISCIPLINE_PAGES) {
    throw new Error("Federvolley official discipline index has an unexpected page list.");
  }

  const pagePaths = pages.map((page, index) => {
    const path = clean(asRecord(page)?.path_discipline);
    if (!isApprovedDisciplinePagePath(path, season)) {
      throw new Error(`Federvolley official discipline page ${index + 1} has an invalid path.`);
    }
    return path;
  });
  const payloads = await mapWithConcurrency(
    pagePaths,
    PAGE_CONCURRENCY,
    (path) => fetchOfficialJson(path, signal),
  );
  signal?.throwIfAborted();

  const rows = payloads.flatMap(extractFedervolleyOfficialTournamentRows);
  return Array.from(new Map(rows.map((row) => [clean(row.path), row])).values());
}

export async function fetchFedervolleyOfficialCalendar(input: {
  year: number;
  gender: "men" | "women";
  nodeId: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  const season = validateSeason(input.year);
  const nodeId = validateNodeId(input.nodeId);
  const genderCode = input.gender === "women" ? "F" : "M";
  return fetchOfficialJson(
    `${season}/BVL/${genderCode}/${nodeId}/calendario.json`,
    input.signal,
  );
}

export function extractFedervolleyOfficialTournamentRows(
  payload: unknown,
): FedervolleyOfficialTournamentRow[] {
  const series = asRecord(asRecord(asRecord(payload)?.beach_volley)?.serie);
  if (!series) return [];

  const rows: FedervolleyOfficialTournamentRow[] = [];
  for (const groups of Object.values(series)) {
    const groupRecord = asRecord(groups);
    if (!groupRecord) continue;
    for (const group of Object.values(groupRecord)) {
      const codici = asRecord(group)?.codici;
      if (!Array.isArray(codici)) continue;
      for (const value of codici) {
        const row = asRecord(value);
        if (row && clean(row.path)) rows.push(row as FedervolleyOfficialTournamentRow);
      }
    }
  }
  return rows;
}

async function fetchOfficialJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const url = buildOfficialJsonUrl(path);
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Referer: "https://www.federvolley.it/campionati/beach-volley/eventi",
        "User-Agent": FEDERVOLLEY_OFFICIAL_USER_AGENT,
      },
    });
    const text = await readBoundedBodyText(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      signal: controller.signal,
      label: "Federvolley official JSON response",
    });
    if (!response.ok) {
      throw new Error(`Federvolley official JSON HTTP ${response.status}: ${text.slice(0, 220)}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new Error("Federvolley official feed returned a non-JSON response.");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Federvolley official feed returned invalid JSON.");
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function buildOfficialJsonUrl(path: string) {
  const normalized = clean(path).replace(/^\/+/, "");
  const url = new URL(`/public/json/${normalized}`, FEDERVOLLEY_OFFICIAL_JSON_ORIGIN);
  if (
    url.protocol !== "https:"
    || url.hostname !== new URL(FEDERVOLLEY_OFFICIAL_JSON_ORIGIN).hostname
    || !url.pathname.startsWith("/public/json/")
  ) {
    throw new Error("Federvolley official JSON path is not approved.");
  }
  return url.toString();
}

function hasBeachVolleySeries(payload: unknown) {
  return Boolean(asRecord(asRecord(payload)?.beach_volley)?.serie);
}

function isApprovedDisciplinePagePath(path: string, season: string) {
  return new RegExp(`^${season}/[1-9]\\d{0,2}/discipline\\.json$`, "u").test(path);
}

function validateSeason(value: number) {
  const season = String(value);
  if (!/^20\d{2}$/.test(season)) throw new Error("Federvolley season is invalid.");
  return season;
}

function validateNodeId(value: string) {
  const nodeId = clean(value);
  if (!/^[1-9]\d{0,15}$/.test(nodeId)) throw new Error("Federvolley tournament id is invalid.");
  return nodeId;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
