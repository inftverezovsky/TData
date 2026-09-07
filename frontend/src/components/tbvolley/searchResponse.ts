import {
  booleanValue,
  enumValue,
  list,
  nullable,
  numberValue,
  objectValue,
  optional,
  textValue,
  type Decoder,
} from "@/services/responseSchema";

const success: Decoder<true> = (value, path) => {
  if (booleanValue(value, path) !== true) throw new Error(`Некорректный ответ сервера: ${path}.`);
  return true;
};
const gender = enumValue(["men", "women"] as const);
const status = enumValue(["finished", "ongoing", "upcoming"] as const);
const category = enumValue(["all", "assoluto", "serie"] as const);
const kind = enumValue(["all", "cup", "championship"] as const);
const twelveSource = enumValue(["twelvendrcsvp", "twelvendroevv"] as const);
const calendarMode = enumValue(["csvp", "oevv"] as const);
const baseTournament = {
  id: textValue,
  title: textValue,
  pageUrl: textValue,
  gender,
  location: textValue,
  dates: textValue,
  startDate: nullable(textValue),
  endDate: nullable(textValue),
  status,
  matchCount: optional(numberValue),
};
const baseSearch = { ok: success, gender, query: textValue };
const yearSearch = { ...baseSearch, sourceUrl: textValue, year: numberValue };
const windowSearch = { ...yearSearch, fromDate: textValue, toDate: textValue, windowDays: numberValue };
const matchSummary = objectValue({ total: numberValue, matches: numberValue });

/** На границе API проверяем реквизиты карточек и сводки. Полные матчи здесь не нужны: импорт загружает их отдельным запросом. */
export const searchDecoders = {
  cbv: objectValue({
    ...yearSearch,
    source: enumValue(["cbv"] as const),
    summary: matchSummary,
    tournaments: list(
      objectValue({
        ...baseTournament,
        sourceTitle: textValue,
        etapaId: textValue,
        campeonatoId: textValue,
        temporadaId: textValue,
        championship: textValue,
        category: textValue,
        season: textValue,
        venue: textValue,
        city: textValue,
        region: textValue,
        courts: textValue,
      }),
    ),
  }),
  federvolley: objectValue({
    ...yearSearch,
    source: enumValue(["federvolley"] as const),
    category,
    summary: objectValue({ total: numberValue, matches: numberValue, assoluto: numberValue, serie: numberValue }),
    tournaments: list(
      objectValue({
        ...baseTournament,
        sourceTitle: textValue,
        nodeId: textValue,
        matchshareLid: textValue,
        category: enumValue(["assoluto", "serie"] as const),
        categoryLabel: textValue,
        code: textValue,
        region: textValue,
        city: textValue,
        venue: textValue,
        prizePool: textValue,
        bracketType: textValue,
        teams: nullable(numberValue),
      }),
    ),
  }),
  beachvolleyru: objectValue({
    ...windowSearch,
    source: enumValue(["beachvolleyru"] as const),
    kind,
    summary: objectValue({ total: numberValue, cup: numberValue, championship: numberValue }),
    tournaments: list(
      objectValue({
        ...baseTournament,
        sourceTitle: textValue,
        eventId: textValue,
        kind: enumValue(["cup", "championship"] as const),
        category: textValue,
        stageTitle: textValue,
        city: textValue,
        sourceStatus: textValue,
        prizePool: textValue,
      }),
    ),
  }),
  germanbeachtour: objectValue({
    ...windowSearch,
    source: enumValue(["germanbeachtour"] as const),
    summary: objectValue({ total: numberValue, teams: numberValue }),
    tournaments: list(
      objectValue({
        ...baseTournament,
        sourceTitle: textValue,
        tournamentId: textValue,
        category: textValue,
        type: textValue,
        city: textValue,
        venue: textValue,
        organizer: textValue,
        teams: nullable(numberValue),
        prizePool: textValue,
      }),
    ),
  }),
  twelvendr: objectValue({
    ...baseSearch,
    source: twelveSource,
    sourceUrl: textValue,
    season: numberValue,
    calendarMode,
    summary: matchSummary,
    tournaments: list(
      objectValue({
        ...baseTournament,
        sourceTitle: textValue,
        source: twelveSource,
        calendarMode,
        tcode: textValue,
        timezone: textValue,
        type: textValue,
        federation: textValue,
        country: textValue,
      }),
    ),
  }),
  volleyballworld: objectValue({
    ...baseSearch,
    gender: enumValue(["all", "men", "women"] as const),
    source: enumValue(["volleyballworld"] as const),
    fromDate: textValue,
    toDate: textValue,
    summary: matchSummary,
    upstream: objectValue({
      cacheStatus: enumValue(["miss", "fresh", "stale"] as const),
      fetchedAt: textValue,
      ageMs: numberValue,
      fallbackErrorCode: nullable(textValue),
    }),
    tournaments: list(
      objectValue({
        ...baseTournament,
        city: textValue,
        country: textValue,
        status: enumValue(["ongoing", "upcoming"] as const),
        matchCount: numberValue,
        firstMatchTimeMoscow: nullable(textValue),
        tournamentNo: textValue,
        competitionSlug: textValue,
        subCompetitionType: textValue,
      }),
    ),
  }),
};
