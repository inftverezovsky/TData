import * as cheerio from 'cheerio';

const MATCH_SELECTOR = '.match-wrapper, .upcomingMatch, .upcoming-match, .liveMatch, .live-match';
const EVENT_SELECTOR = '.ongoing-event, .small-event, .big-event';
const EMPTY_SELECTOR = '.no-matches, .no-results, .empty-state, .event-empty';
const HLTV_NAVIGATION_HOSTS = new Set(['hltv.org', 'www.hltv.org']);

export function validateHltvNavigationUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw hltvNavigationPolicyError();
  }

  if (
    url.protocol !== 'https:'
    || !HLTV_NAVIGATION_HOSTS.has(url.hostname.toLowerCase())
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
  ) {
    throw hltvNavigationPolicyError();
  }

  url.hash = '';
  return url.toString();
}

function hltvNavigationPolicyError() {
  const error = new Error('HLTV navigation URL must be a same-origin HTTPS hltv.org URL');
  error.errorClass = 'parse_failed';
  return error;
}

export function classifyHltvPageHtml(mode, html) {
  const $ = cheerio.load(String(html || ''));
  const documentText = cleanText(`${$('title').text()} ${$('body').text()}`).toLowerCase();

  if (/just a moment|attention required|verify you are human|checking if the site connection is secure|checking your browser|cf-ray|cloudflare ray id/.test(documentText)) {
    return { ok: false, errorClass: 'cloudflare_block', validEmpty: false, emptyState: null };
  }
  if (/this site can.?t be reached|err_proxy|err_tunnel|err_connection|proxy server/.test(documentText)) {
    return { ok: false, errorClass: 'proxy_tunnel', validEmpty: false, emptyState: null };
  }

  const emptyState = classifyExplicitHltvEmptyState($, mode);
  if (emptyState) return { ok: true, errorClass: null, validEmpty: true, emptyState };

  let hasExpectedStructure = false;
  if (mode === 'event' || mode === 'scrape') {
    hasExpectedStructure = $(MATCH_SELECTOR).length > 0;
  } else if (mode === 'events') {
    hasExpectedStructure = $(EVENT_SELECTOR).length > 0 || $('.ongoing-events-holder, .events-holder').length > 0;
  } else if (mode === 'search') {
    hasExpectedStructure = $('a[href*="/events/"]').length > 0 || $('.search-results, .search-result').length > 0;
  } else if (mode === 'health') {
    hasExpectedStructure = /\bhltv(?:\.org)?\b/i.test(documentText) && $('body').length > 0;
  }

  return hasExpectedStructure
    ? { ok: true, errorClass: null, validEmpty: false, emptyState: null }
    : { ok: false, errorClass: 'selector_changed', validEmpty: false, emptyState: null };
}

export function extractHltvEventTitle(html) {
  const $ = cheerio.load(String(html || ''));
  const event = $(EVENT_SELECTOR).first();
  if (event.length === 0) return '';

  const preciseTitle = event
    .find('.event-name-small > .text-ellipsis, .event-name-container > .text-ellipsis, .big-event-name, .text-ellipsis')
    .first()
    .text();
  const imageAlt = event.find('img[alt]').first().attr('alt');
  return cleanText(preciseTitle || imageAlt || '');
}

export function buildHltvEventMatchesUrl(eventUrl) {
  const absoluteUrl = new URL(String(eventUrl || ''), 'https://www.hltv.org').toString();
  const parsed = new URL(validateHltvNavigationUrl(absoluteUrl));
  if (!/^\/events\/\d+(?:\/[^/?#]+)?(?:\/matches)?\/?$/i.test(parsed.pathname)) {
    throw new Error('Invalid HLTV event URL');
  }
  parsed.protocol = 'https:';
  parsed.hostname = 'www.hltv.org';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '').replace(/\/matches$/i, '')}/matches`;
  return parsed.toString().replace(/\/$/, '');
}

export function buildHltvNumericEventMatchesUrl(eventId) {
  const normalized = String(eventId || '').trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) {
    throw new Error('Invalid HLTV event ID');
  }
  return `https://www.hltv.org/events/${normalized}/matches`;
}

export function shouldWarmUpHltvSession(mode) {
  return String(mode || '').trim().toLowerCase() !== 'event';
}

export function parseHltvMatchesHtml(html, nowSeconds = Math.floor(Date.now() / 1000)) {
  const $ = cheerio.load(String(html || ''));
  const results = [];

  $(MATCH_SELECTOR).each((_, element) => {
    const item = $(element);
    const className = String(item.attr('class') || '');
    const isLive = /(?:^|\s)(?:liveMatch|live-match|live-match-container)(?:\s|$)/.test(className)
      || item.attr('live') === 'true'
      || item.find('.live-flag, .match-meta-live').length > 0;
    const isFinished = /(?:^|\s)(?:finished|result)(?:\s|$)/.test(className)
      || item.attr('finished') === 'true'
      || item.find('.match-finished, .match-meta-result, .result-score').length > 0;
    if (isFinished) return;

    const teamNames = item
      .find('.match-teamname, .matchTeamName, .team-name, .team-1 .team-name, .team-2 .team-name')
      .toArray()
      .map((node) => cleanTeamName($(node).text()))
      .filter(Boolean);
    if (teamNames.length < 2) return;

    const timeElement = item.find('[data-unix], .matchTime, .time').first();
    const unixTime = normalizeUnixTime(timeElement.attr('data-unix') || timeElement.attr('data-time'), isLive, nowSeconds);
    if (!isLive && unixTime > 0 && unixTime < nowSeconds - 300) return;

    const eventElement = item.find('.match-event, .matchEventName, .event-headline, .event, [class*="event-name"]').first();
    const tournament = cleanText(eventElement.attr('data-event-headline') || eventElement.text()) || 'Upcoming';
    const stage = cleanText(item.find('.match-stage, .matchStage, .stage, [class*="stage-name"], [class*="round-name"]').first().text());
    const rawText = cleanText(item.text()).slice(0, 1500);
    const formatCandidates = [
      item.find('.matchMeta, .match-meta, .match-meta-type, [class*="matchMeta"], [class*="match-meta"]').first().text(),
      ...item.find('[class*="meta"], [class*="format"], [class*="best"]').toArray().map((node) => $(node).text()),
      item.text(),
    ];
    const format = formatCandidates.map(cleanBestOfFormat).find(Boolean) || '';
    const href = item.is('a[href*="/matches/"]')
      ? item.attr('href')
      : item.find('a[href*="/matches/"]').first().attr('href');
    const id = String(href || '').match(/\/matches\/(\d+)(?:\/|$)/)?.[1] || '';

    results.push({
      id: id || stableFallbackId(`${teamNames[0]}|${teamNames[1]}|${unixTime}|${tournament}`),
      tournament,
      team1: teamNames[0] || 'TBD',
      team2: teamNames[1] || 'TBD',
      unix_time: unixTime,
      format,
      stage,
      round: stage,
      rawText,
      isLive,
    });
  });

  return results;
}

function classifyExplicitHltvEmptyState($, mode) {
  if (mode === 'event' || mode === 'scrape') {
    const statusCandidates = $('.event-status, .event-status-box, .event-cancelled, .event-deleted, [data-event-status]')
      .toArray()
      .map((node) => cleanText($(node).text()).toLowerCase())
      .filter(Boolean);
    if (statusCandidates.some((text) => /\b(?:this\s+)?(?:event|tournament)\s+(?:(?:has|have)\s+been\s+|(?:was|is)\s+)?cancel(?:l)?ed\b/.test(text))) {
      return 'event_cancelled';
    }
    if (statusCandidates.some((text) => (
      /\b(?:this\s+)?(?:event|tournament)\s+(?:(?:has|have)\s+been\s+|(?:was|is)\s+)?(?:deleted|removed)\b/.test(text)
      || /\bevent\s+not\s+found\b|\bthis\s+event\s+(?:does\s+not|doesn't|no\s+longer)\s+exist\b/.test(text)
    ))) {
      return 'event_deleted';
    }
  }

  const candidates = $(EMPTY_SELECTOR)
    .toArray()
    .map((node) => cleanText($(node).text()).toLowerCase())
    .filter(Boolean);
  const pattern = mode === 'search'
    ? /\b(?:no results|nothing found|did not match)\b/
    : /\b(?:there are no|no)(?: upcoming| live)? matches(?: found)?\b/;
  if (!candidates.some((text) => pattern.test(text))) return null;
  return mode === 'search' ? 'no_results' : 'no_upcoming_matches';
}

function cleanTeamName(value) {
  return cleanText(value).replace(/\s+\d{1,2}$/, '').trim();
}

function cleanBestOfFormat(value) {
  const text = cleanText(value);
  const explicit = text.match(/\bbo\s*[-:]?\s*([1-9]\d?)\b/i)
    || text.match(/\bbest\s*[-\s]?of\s*[-:]?\s*([1-9]\d?)\b/i)
    || text.match(/\bbestof\s*([1-9]\d?)\b/i);
  return explicit?.[1] ? `BO${Number(explicit[1])}` : '';
}

function normalizeUnixTime(value, isLive, nowSeconds) {
  const parsed = Number.parseInt(String(value || '0'), 10);
  if (!parsed) return isLive ? nowSeconds : 0;
  return parsed > 9_999_999_999 ? Math.floor(parsed / 1000) : parsed;
}

function stableFallbackId(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(36)}`;
}

function cleanText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
