import { DateTime } from "luxon";
import { formatMoscowDate, formatMoscowDateTime } from "@backend/matches/scheduleOffset";
import { normalizeBeachVolleyballGender, type BeachVolleyballGender } from "@backend/sources/tbvolley/config";

export type CBVGender = BeachVolleyballGender;
export type CBVMatchStatus = "upcoming" | "finished";

export type CBVTeam = {
  id: string;
  name: string;
  players: string[];
  region: string;
  rawName: string;
};

export type CBVMatch = {
  id: string;
  etapaId: string;
  campeonatoId: string;
  temporadaId: string;
  gender: CBVGender;
  phaseId: string;
  phase: string;
  round: string;
  court: string;
  startTimeUtc: string | null;
  startTimeMoscow: string;
  dateKey: string;
  status: CBVMatchStatus;
  teamA: CBVTeam;
  teamB: CBVTeam;
  score: {
    teamA: number | null;
    teamB: number | null;
    sets: Array<{ no: number; teamA: number; teamB: number }>;
  };
  sourceUrl: string;
  rawText: string;
};

export type CBVTournament = {
  id: string;
  etapaId: string;
  campeonatoId: string;
  temporadaId: string;
  title: string;
  sourceTitle: string;
  pageUrl: string;
  gender: CBVGender;
  championship: string;
  category: string;
  season: string;
  venue: string;
  city: string;
  region: string;
  location: string;
  dates: string;
  startDate: string | null;
  endDate: string | null;
  status: "finished" | "ongoing" | "upcoming";
  courts: string;
  matches?: CBVMatch[];
  matchCount?: number;
};

export type CBVTournamentSearch = {
  ok: true;
  source: "cbv";
  sourceUrl: string;
  year: number;
  gender: CBVGender;
  query: string;
  tournaments: CBVTournament[];
  summary: {
    total: number;
    matches: number;
  };
};

type CBVChampionship = {
  id?: number | string | null;
  nome?: string | null;
  genero?: string | null;
  status?: string | null;
  ordem?: number | string | null;
};

type CBVSeason = {
  id?: number | string | null;
  nome?: string | null;
  status?: string | null;
};

type CBVPhase = {
  id?: number | string | null;
  nome?: string | null;
  apelido?: string | null;
  indicadorFase?: string | null;
  ordem?: number | string | null;
};

type CBVEtapa = {
  id?: number | string | null;
  nome?: string | null;
  status?: string | null;
  dataInicioEtapa?: string | null;
  dataFimEtapa?: string | null;
  local?: {
    nome?: string | null;
    cidade?: {
      nome?: string | null;
      cidadeEstado?: string | null;
      estado?: {
        sigla?: string | null;
        nome?: string | null;
        pais?: { sigla?: string | null; nome?: string | null } | null;
      } | null;
    } | null;
  } | null;
  campeonato?: CBVChampionship | null;
  categoria?: { nome?: string | null } | null;
  temporada?: CBVSeason | null;
  numeroQuadras?: string | number | null;
};

type CBVGame = {
  id?: number | string | null;
  equipeA?: CBVSourceTeam | null;
  equipeB?: CBVSourceTeam | null;
  futuraEquipeA?: string | null;
  futuraEquipeB?: string | null;
  etapaFase?: { fase?: CBVPhase | null; etapa?: CBVEtapa | null } | null;
  quadra?: string | number | null;
  grupo?: string | null;
  status?: string | null;
  setsEquipeA?: string | number | null;
  setsEquipeB?: string | number | null;
  data?: string | null;
  horario?: string | null;
  numero?: string | number | null;
  sets?: Array<{
    numero?: string | number | null;
    pontuacaoEquipeA?: string | number | null;
    pontuacaoEquipeB?: string | number | null;
  }> | null;
};

type CBVSourceTeam = {
  id?: string | number | null;
  nome?: string | null;
  equipeJogadores?: Array<{
    jogador?: {
      codinome?: string | null;
      nome?: string | null;
      federacao?: { sigla?: string | null; nome?: string | null } | null;
      nacionalidade?: { sigla?: string | null; nome?: string | null } | null;
    } | null;
  }> | null;
};

const CBV_ORIGIN = "https://evolleyball.cbv.com.br";
const CBV_API_BASE = `${CBV_ORIGIN}/eVolleyball/api`;
const CBV_PAGE_URL = `${CBV_ORIGIN}/#!/tabelas`;
const CBV_USER_AGENT = "TData TBvolley/1.0 (+https://evolleyball.cbv.com.br/#!/tabelas)";

export function normalizeCBVGender(value: unknown): CBVGender {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "f") return "women";
  if (text === "m") return "men";
  return normalizeBeachVolleyballGender(value) || "men";
}

export function getDefaultCBVYear() {
  const value = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
  }).format(new Date());
  const year = Number(value);
  return Number.isFinite(year) ? year : new Date().getUTCFullYear();
}

export async function searchCBVTournaments(input: {
  year?: string | number | null;
  gender?: string | null;
  query?: string | null;
} = {}): Promise<CBVTournamentSearch> {
  const year = normalizeYear(input.year);
  const gender = normalizeCBVGender(input.gender);
  const query = normalizeSearch(input.query || "");
  const championship = await findAdultChampionship(gender);
  const seasons = await fetchCBVSeasons(clean(championship.id));
  const season = seasons.find((item) => clean(item.nome) === String(year)) || seasons[0];
  if (!season?.id) throw new Error(`CBV season ${year} не найден`);

  const etapas = await fetchCBVEtapas(clean(championship.id), clean(season.id));
  const tournaments = filterCBVUpcomingTournaments(
    parseCBVEtapas(etapas, {
      gender,
      query,
      fallbackCampeonatoId: clean(championship.id),
      fallbackTemporadaId: clean(season.id),
    }),
  );

  return {
    ok: true,
    source: "cbv",
    sourceUrl: CBV_PAGE_URL,
    year,
    gender,
    query,
    tournaments,
    summary: {
      total: tournaments.length,
      matches: tournaments.reduce((sum, tournament) => sum + (tournament.matchCount || 0), 0),
    },
  };
}

export async function fetchCBVTournament(input: {
  campeonatoId?: string | number | null;
  temporadaId?: string | number | null;
  etapaId?: string | number | null;
  title?: string | null;
  pageUrl?: string | null;
  gender?: string | null;
}): Promise<CBVTournament> {
  const gender = normalizeCBVGender(input.gender || input.title || input.pageUrl);
  const campeonatoId = clean(input.campeonatoId) || extractCBVCampeonatoId(input.title) || extractCBVCampeonatoId(input.pageUrl);
  const temporadaId = clean(input.temporadaId) || extractCBVTemporadaId(input.title) || extractCBVTemporadaId(input.pageUrl);
  const etapaId = clean(input.etapaId) || extractCBVEtapaId(input.title) || extractCBVEtapaId(input.pageUrl);
  if (!campeonatoId || !temporadaId || !etapaId) {
    throw new Error("Не удалось определить CBV campeonato/temporada/etapa");
  }

  const etapas = await fetchCBVEtapas(campeonatoId, temporadaId);
  const etapa = etapas.find((item) => clean(item.id) === etapaId);
  if (!etapa) throw new Error(`CBV etapa ${etapaId} не найдена`);

  const phases = await fetchCBVPhases(etapaId);
  const gamesByPhase = await Promise.all(phases.map(async (phase) => ({
    phase,
    games: await fetchCBVGames(etapaId, clean(phase.id)),
  })));
  const matches = gamesByPhase.flatMap(({ phase, games }) =>
    games.map((game) => normalizeCBVMatch(game, {
      gender,
      campeonatoId,
      temporadaId,
      etapaId,
      phase,
    })),
  ).sort(compareCBVMatches);

  return {
    ...parseCBVEtapa(etapa, {
      gender,
      fallbackCampeonatoId: campeonatoId,
      fallbackTemporadaId: temporadaId,
    }),
    matches,
    matchCount: matches.length,
  };
}

export function parseCBVEtapas(
  etapas: CBVEtapa[],
  options: {
    gender: CBVGender;
    query?: string;
    fallbackCampeonatoId?: string;
    fallbackTemporadaId?: string;
  },
): CBVTournament[] {
  return etapas
    .map((etapa) => parseCBVEtapa(etapa, options))
    .filter((tournament) => {
      if (!options.query) return true;
      return normalizeSearch([
        tournament.title,
        tournament.championship,
        tournament.category,
        tournament.venue,
        tournament.city,
        tournament.region,
        tournament.dates,
        tournament.etapaId,
      ].join(" ")).includes(options.query);
    })
    .sort((a, b) => compareDates(a.startDate, b.startDate) || a.title.localeCompare(b.title));
}

export function parseCBVEtapa(
  etapa: CBVEtapa,
  options: { gender: CBVGender; fallbackCampeonatoId?: string; fallbackTemporadaId?: string },
): CBVTournament {
  const campeonatoId = clean(etapa.campeonato?.id) || clean(options.fallbackCampeonatoId);
  const temporadaId = clean(etapa.temporada?.id) || clean(options.fallbackTemporadaId);
  const etapaId = clean(etapa.id);
  const championship = clean(etapa.campeonato?.nome) || "CBV";
  const category = clean(etapa.categoria?.nome) || "ADULTO";
  const season = clean(etapa.temporada?.nome);
  const venue = clean(etapa.local?.nome);
  const city = clean(etapa.local?.cidade?.nome || etapa.local?.cidade?.cidadeEstado?.split("/")?.[0]);
  const region = clean(etapa.local?.cidade?.estado?.sigla);
  const location = [city, region].filter(Boolean).join("/");
  const startDate = parseCBVApiDate(etapa.dataInicioEtapa);
  const endDate = parseCBVApiDate(etapa.dataFimEtapa);
  const title = buildCBVTitle(championship, clean(etapa.nome), location);

  return {
    id: etapaId,
    etapaId,
    campeonatoId,
    temporadaId,
    title,
    sourceTitle: buildCBVSourceTitle(title, options.gender, campeonatoId, temporadaId, etapaId),
    pageUrl: buildCBVPageUrl(campeonatoId, temporadaId, etapaId),
    gender: options.gender,
    championship,
    category,
    season,
    venue,
    city,
    region,
    location,
    dates: formatDateRangeLabel(startDate, endDate),
    startDate,
    endDate,
    status: resolveTournamentStatus(clean(etapa.status), startDate, endDate),
    courts: clean(etapa.numeroQuadras),
  };
}

export function normalizeCBVMatch(
  game: CBVGame,
  context: {
    gender: CBVGender;
    campeonatoId: string;
    temporadaId: string;
    etapaId: string;
    phase: CBVPhase;
  },
): CBVMatch {
  const startDate = parseCBVGameDateTime(game.data, game.horario);
  const teamA = parseCBVTeam(game.equipeA, game.futuraEquipeA);
  const teamB = parseCBVTeam(game.equipeB, game.futuraEquipeB);
  const score = {
    teamA: toNullableNumber(game.setsEquipeA),
    teamB: toNullableNumber(game.setsEquipeB),
    sets: (game.sets || [])
      .map((set, index) => ({
        no: toNullableNumber(set.numero) || index + 1,
        teamA: toNullableNumber(set.pontuacaoEquipeA) || 0,
        teamB: toNullableNumber(set.pontuacaoEquipeB) || 0,
      }))
      .filter((set) => set.teamA > 0 || set.teamB > 0),
  };
  const phase = clean(context.phase.nome || game.etapaFase?.fase?.nome);
  const round = clean(context.phase.apelido || game.grupo || game.numero);
  const court = clean(game.quadra);

  return {
    id: clean(game.id),
    etapaId: context.etapaId,
    campeonatoId: context.campeonatoId,
    temporadaId: context.temporadaId,
    gender: context.gender,
    phaseId: clean(context.phase.id),
    phase,
    round,
    court: court ? `Quadra ${court}` : "",
    startTimeUtc: startDate ? startDate.toISOString() : null,
    startTimeMoscow: startDate ? formatMoscowDateTime(startDate) : "",
    dateKey: startDate ? formatMoscowDate(startDate) : "",
    status: clean(game.status).toUpperCase() === "F" ? "finished" : "upcoming",
    teamA,
    teamB,
    score,
    sourceUrl: buildCBVPageUrl(context.campeonatoId, context.temporadaId, context.etapaId),
    rawText: [
      phase,
      round,
      game.numero ? `Jogo ${clean(game.numero)}` : null,
      court ? `Quadra ${court}` : null,
      startDate ? formatMoscowDateTime(startDate) : null,
      `${teamA.name} vs ${teamB.name}`,
      score.sets.length > 0 ? score.sets.map((set) => `${set.teamA}:${set.teamB}`).join(", ") : null,
      `cbvGameId=${clean(game.id)}`,
    ].filter(Boolean).join(" | "),
  };
}

export function buildCBVSourceTitle(title: string, gender: CBVGender, campeonatoId: string, temporadaId: string, etapaId: string) {
  return `${stripSourceTitleMetadata(title)} — ${gender === "women" ? "Women" : "Men"} [CBV:${campeonatoId}:${temporadaId}:${etapaId}]`;
}

export function buildCBVPageUrl(campeonatoId: string, temporadaId: string, etapaId: string) {
  const url = new URL(CBV_PAGE_URL);
  url.searchParams.set("campeonatoId", campeonatoId);
  url.searchParams.set("temporadaId", temporadaId);
  url.searchParams.set("etapaId", etapaId);
  return url.toString();
}

export function extractCBVCampeonatoId(value: unknown) {
  return clean(String(value ?? "").match(/\[CBV:([^:\]]+):[^:\]]+:[^\]]+]/i)?.[1])
    || clean(String(value ?? "").match(/[?&]campeonatoId=([^&#\s]+)/i)?.[1]);
}

export function extractCBVTemporadaId(value: unknown) {
  return clean(String(value ?? "").match(/\[CBV:[^:\]]+:([^:\]]+):[^\]]+]/i)?.[1])
    || clean(String(value ?? "").match(/[?&]temporadaId=([^&#\s]+)/i)?.[1]);
}

export function extractCBVEtapaId(value: unknown) {
  return clean(String(value ?? "").match(/\[CBV:[^:\]]+:[^:\]]+:([^\]]+)]/i)?.[1])
    || clean(String(value ?? "").match(/[?&]etapaId=([^&#\s]+)/i)?.[1]);
}

export function filterCBVUpcomingTournaments(tournaments: CBVTournament[], now = new Date()) {
  return tournaments.filter((tournament) => isCBVUpcomingTournament(tournament, now));
}

export function isCBVUpcomingTournament(
  tournament: Pick<CBVTournament, "status" | "startDate" | "endDate">,
  now = new Date(),
) {
  if (tournament.status === "finished") return false;
  const today = formatMoscowDate(now);
  const endDate = tournament.endDate || tournament.startDate;
  if (!endDate) return false;
  return endDate >= today;
}

export function isActiveCBVMatch(match: Pick<CBVMatch, "status" | "startTimeUtc">, now = new Date()) {
  if (match.status === "finished") return false;
  if (!match.startTimeUtc) return true;
  const start = new Date(match.startTimeUtc);
  if (Number.isNaN(start.getTime())) return true;
  return formatMoscowDate(start) >= formatMoscowDate(now);
}

async function findAdultChampionship(gender: CBVGender) {
  const championships = await fetchCBVChampionships();
  const cbvGender = gender === "women" ? "F" : "M";
  const championship = championships.find((item) =>
    clean(item.nome).toUpperCase() === "CBVP ADULTO" && clean(item.genero).toUpperCase() === cbvGender,
  );
  if (!championship?.id) throw new Error(`CBV adult championship ${cbvGender} не найден`);
  return championship;
}

async function fetchCBVChampionships() {
  return fetchCBVJson<CBVChampionship[]>("/campeonatos/public/listarCampeonatosAtivos");
}

async function fetchCBVSeasons(campeonatoId: string) {
  return fetchCBVJson<CBVSeason[]>("/temporadas/public/temporadaByCampeonatoComJogos", { idCampeonato: campeonatoId });
}

async function fetchCBVEtapas(campeonatoId: string, temporadaId: string) {
  return fetchCBVJson<CBVEtapa[]>("/etapas/public/listarEtapasByCampeonatoTemporada", {
    idCampeonato: campeonatoId,
    idTemporada: temporadaId,
  });
}

async function fetchCBVPhases(etapaId: string) {
  return fetchCBVJson<CBVPhase[]>("/fases/public/fasesByEtapa", { idEtapa: etapaId });
}

async function fetchCBVGames(etapaId: string, phaseId: string) {
  if (!phaseId) return [];
  return fetchCBVJson<CBVGame[]>("/jogos/public/listarJogosByEtapaFasePublicada", {
    idEtapa: etapaId,
    idFase: phaseId,
  });
}

async function fetchCBVJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${CBV_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": CBV_USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`CBV HTTP ${response.status}: ${text.slice(0, 220)}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("CBV returned invalid JSON.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function parseCBVTeam(team: CBVSourceTeam | null | undefined, fallback: string | null | undefined): CBVTeam {
  const players = (team?.equipeJogadores || [])
    .map((entry) => clean(entry.jogador?.codinome || entry.jogador?.nome))
    .filter(Boolean);
  const rawName = clean(team?.nome || fallback);
  const region = clean(team?.equipeJogadores?.[0]?.jogador?.federacao?.sigla);
  const name = normalizeTeamName(rawName || players.join(" / "));

  return {
    id: clean(team?.id),
    name: name || "TBD",
    players,
    region,
    rawName,
  };
}

function parseCBVApiDate(value: string | null | undefined) {
  const text = clean(value);
  if (!text) return null;
  return text.slice(0, 10);
}

function parseCBVGameDateTime(dateValue: string | null | undefined, timeValue: string | null | undefined) {
  const date = parseCBVApiDate(dateValue);
  const time = clean(timeValue);
  if (!date || !time) return null;
  const parsed = DateTime.fromFormat(`${date} ${time.slice(0, 5)}`, "yyyy-MM-dd HH:mm", { zone: "America/Sao_Paulo" });
  if (!parsed.isValid) return null;
  return parsed.toUTC().toJSDate();
}

function resolveTournamentStatus(status: string, startDate: string | null, endDate: string | null): CBVTournament["status"] {
  if (status.toUpperCase() === "E") return "finished";
  const today = formatMoscowDate(new Date());
  if (endDate && endDate < today) return "finished";
  if (startDate && startDate <= today && (!endDate || endDate >= today)) return "ongoing";
  return "upcoming";
}

function buildCBVTitle(championship: string, etapa: string, location: string) {
  return [championship, etapa, location].map(clean).filter(Boolean).join(" - ");
}

function stripSourceTitleMetadata(value: string) {
  return clean(value
    .replace(/\s+—\s+(?:Women|Men|Женщины|Мужчины)\s*(?:\[CBV:[^\]]+])?$/i, "")
    .replace(/\s*\[CBV:[^\]]+]$/i, ""));
}

function normalizeTeamName(value: string) {
  return clean(value).replace(/\s*\/\s*/g, " / ");
}

function formatDateRangeLabel(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "";
  const start = startDate ? formatDateLabel(startDate) : "";
  const end = endDate ? formatDateLabel(endDate) : "";
  if (!start || start === end) return start || end;
  return `${start} - ${end}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function compareCBVMatches(a: CBVMatch, b: CBVMatch) {
  return compareDates(a.startTimeUtc, b.startTimeUtc) || Number(a.id) - Number(b.id);
}

function compareDates(left: string | null, right: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right ? new Date(right).getTime() : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function normalizeYear(value: string | number | null | undefined) {
  const parsed = Number(value || getDefaultCBVYear());
  if (!Number.isFinite(parsed)) return getDefaultCBVYear();
  return Math.min(Math.max(Math.trunc(parsed), 2017), 2035);
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNullableNumber(value: unknown) {
  const text = clean(value).replace(/[^\d.-]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
