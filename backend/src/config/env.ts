export function getLiquipediaDota2ApiUrl() {
  return process.env.LIQUIPEDIA_DOTA2_API_URL ?? "https://liquipedia.net/dota2/api.php";
}

export function getLiquipediaCounterStrikeApiUrl() {
  return process.env.LIQUIPEDIA_COUNTERSTRIKE_API_URL ?? "https://liquipedia.net/counterstrike/api.php";
}

export function getLiquipediaLolApiUrl() {
  return process.env.LIQUIPEDIA_LOL_API_URL ?? "https://liquipedia.net/leagueoflegends/api.php";
}

export function getFandomLolApiUrl() {
  return process.env.FANDOM_LOL_API_URL ?? "https://lol.fandom.com/api.php";
}

export function getLiquipediaValorantApiUrl() {
  return process.env.LIQUIPEDIA_VALORANT_API_URL ?? "https://liquipedia.net/valorant/api.php";
}

export function getLiquipediaUserAgent() {
  return process.env.LIQUIPEDIA_USER_AGENT ?? "liquipedia-local-dev/0.1 (contact: change-me@example.com)";
}

export function getFandomUserAgent() {
  return process.env.FANDOM_USER_AGENT ?? getLiquipediaUserAgent();
}

export function getGenericMinIntervalMs() {
  return numberFromEnv("LIQUIPEDIA_GENERIC_MIN_INTERVAL_MS", 2100);
}

export function getParseMinIntervalMs() {
  return numberFromEnv("LIQUIPEDIA_PARSE_MIN_INTERVAL_MS", 31000);
}

export function getLiquipediaJitterMs() {
  return numberFromEnv("LIQUIPEDIA_JITTER_MS", 650);
}

export function getLiquipediaCooldownMs() {
  return numberFromEnv("LIQUIPEDIA_COOLDOWN_MS", 10 * 60 * 1000);
}

export function getHltvQueueDelayMs() {
  return numberFromEnv("HLTV_QUEUE_DELAY_MS", 1000);
}

export function getSearchCacheTtlMs() {
  return numberFromEnv("SEARCH_CACHE_TTL_SECONDS", 86400) * 1000;
}

/** When true (default), skip the expensive action=parse API call during import. */
export function getSkipParsedHtml() {
  const raw = process.env.LIQUIPEDIA_SKIP_PARSED_HTML;
  if (raw === undefined || raw === "") return true; // default: skip
  return raw === "1" || raw.toLowerCase() === "true";
}

export function shouldFetchParsedHtmlForDiscipline(disciplineSlug: string, skipParsedHtml = getSkipParsedHtml()) {
  const slug = disciplineSlug.trim().toLowerCase();
  if (slug === "leagueoflegends" || slug === "valorant") return true;
  return !skipParsedHtml;
}

function numberFromEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
