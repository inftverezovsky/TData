import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import minimist from 'minimist';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

chromium.use(StealthPlugin());

const args = minimist(process.argv.slice(2));
const PROXY_URL = args.proxy; 
const MODE = args.mode || 'scrape'; // 'scrape', 'search', or 'event'
const QUERY = args.q || '';
const EVENT_ID = args.id || '';
const REQUEST_ID = String(args['request-id'] || args.requestId || crypto.randomBytes(4).toString('hex'));
const NO_CACHE = Boolean(args.no_cache || args.noCache || args['no-cache'] || args.cache === false);

const CACHE_DIR = './cache/hltv';
const CACHE_VERSION = 'hltv-upcoming-only-v2';
const POSITIVE_CACHE_TTL_BY_MODE = {
  scrape: 10 * 60 * 1000,
  events: 10 * 60 * 1000,
  event: 10 * 60 * 1000,
  search: 60 * 60 * 1000,
  health: 5 * 60 * 1000,
};
const NEGATIVE_CACHE_TTL = 10 * 60 * 1000;
const STALE_CACHE_TTL = 24 * 60 * 60 * 1000;
const SEARCH_RESULT_WAIT_MS = Number(process.env.HLTV_SEARCH_RESULT_WAIT_MS || 12000);

function getCache(options = {}) {
  if (NO_CACHE) return null;
  const key = crypto.createHash('md5').update(`${CACHE_VERSION}-${MODE}-${QUERY}-${EVENT_ID}`).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const age = Date.now() - data.timestamp;
      const ttl = data.cacheKind === 'negative'
        ? NEGATIVE_CACHE_TTL
        : POSITIVE_CACHE_TTL_BY_MODE[MODE] || 10 * 60 * 1000;
      if (age < ttl || (options.allowStale && age < STALE_CACHE_TTL)) {
        return {
          ...data.result,
          cacheHit: true,
          cacheLayer: options.allowStale && age >= ttl ? 'file-stale' : 'file',
          stale: options.allowStale && age >= ttl,
        };
      }
    } catch (e) {}
  }
  return null;
}

function setCache(result) {
  try {
    if (!result || !result.ok) return;
    const isEmpty = (Array.isArray(result.events) && result.events.length === 0) ||
      (Array.isArray(result.matches) && result.matches.length === 0);

    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const key = crypto.createHash('md5').update(`${CACHE_VERSION}-${MODE}-${QUERY}-${EVENT_ID}`).digest('hex');
    const cachePath = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(cachePath, JSON.stringify({
      timestamp: Date.now(),
      cacheKind: isEmpty ? 'negative' : 'positive',
      result
    }));
  } catch (e) {}
}

async function scrapeHltv() {
  const cached = getCache();
  if (cached) {
    console.error('[HLTV Playwright] Returning cached result');
    console.log(JSON.stringify(cached));
    return;
  }

  let browser = null;

  // Global timeout for the entire script (3 minutes for slow proxies)
  const scriptTimeout = setTimeout(async () => {
    console.error('[HLTV Playwright] SCRIPT TIMEOUT REACHED, FORCE CLOSING');
    if (browser) await browser.close();
    process.exit(1);
  }, 180000);

  // Cleanup on signals
  const cleanup = async () => {
    console.error('[HLTV Playwright] Received signal, cleaning up...');
    if (browser) await browser.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    let launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
    ];

    const proxy = createPlaywrightProxy(PROXY_URL);
    if (proxy) {
      console.error(`[HLTV Playwright] Using Browser Proxy: ${proxy.server}`);
    }

    browser = await chromium.launch({ 
      headless: true, 
      args: launchArgs,
      ...(proxy ? { proxy } : {})
    });
    
    // Randomize viewport like real users
    const viewportWidth = 1366 + Math.floor(Math.random() * 400);
    const viewportHeight = 768 + Math.floor(Math.random() * 200);
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }
    });

    const page = await context.newPage();
    
    // Human-like random delay before starting. Keep health checks and search within API timeouts.
    const startupDelayMs = MODE === 'health'
      ? 250 + Math.random() * 750
      : MODE === 'search'
        ? 1000 + Math.random() * 2000
        : 3000 + Math.random() * 4000;
    await new Promise(r => setTimeout(r, startupDelayMs));
    
    // AGGRESSIVE OPTIMIZATION: Block images and media, but ALLOW stylesheets and scripts for Cloudflare
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();
      
      if (['image', 'font', 'media', 'other', 'manifest', 'texttrack'].includes(resourceType)) {
        return route.abort();
      }
      
      // Block common analytics and ads but keep cloudflare/hltv scripts
      if (url.includes('google-analytics') || url.includes('doubleclick') || url.includes('facebook') || url.includes('twitter') || url.includes('adsystem')) {
        return route.abort();
      }
      
      route.continue();
    });

    await page.addInitScript(() => {
      // Hide automation signals
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });
    
    if (MODE === 'search') {
      console.error(`[HLTV Playwright] Searching for: ${QUERY}`);
      
      // Cloudflare/proxy pages may never reach networkidle/load. Commit lets us
      // inspect the page quickly and classify a real block instead of timing out.
      await gotoHltvPage(page, `https://www.hltv.org/search?query=${encodeURIComponent(QUERY)}`, 'search');
      
      // Human-like reading pause
      await new Promise(r => setTimeout(r, 750 + Math.random() * 1250));
      await safeMouseWheel(page, 0, 100 + Math.random() * 200, 'initial-search-scroll');
      
      try {
        // Wait specifically for event search results or no-results message
        console.error(`[HLTV Playwright] Waiting for search results (${SEARCH_RESULT_WAIT_MS}ms timeout)...`);
        await page.waitForFunction(() => {
          const eventLinks = document.querySelectorAll('a[href*="/events/"]').length;
          const bodyText = document.body?.innerText?.toLowerCase() || '';
          const hasNoResults = /no results|nothing found|did not match|no matches/.test(bodyText);
          return eventLinks > 0 || hasNoResults;
        }, null, { timeout: SEARCH_RESULT_WAIT_MS });
      } catch (e) {
        console.error(`[HLTV Playwright] Timeout waiting for selectors. Capturing debug screenshot...`);
        await saveDebugScreenshot(page, 'selector-timeout');
        await safeMouseWheel(page, 0, 500, 'selector-timeout-scroll');
        await new Promise(r => setTimeout(r, 1000));
        if (await isCloudflareChallenge(page)) {
          throw new Error('Cloudflare block/challenge detected on HLTV search page');
        }
      }

      const results = await page.evaluate((query) => {
        const normalizeSearchText = (value) => value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const queryTokens = normalizeSearchText(query)
          .split(' ')
          .filter((token) => token.length >= 2);

        const isRelevantToQuery = (title, href) => {
          if (queryTokens.length === 0) return true;
          const haystack = normalizeSearchText(`${title} ${href}`);
          return queryTokens.every((token) => haystack.includes(token));
        };

        const rawEvents = [];
        document.querySelectorAll('a[href*="/events/"]').forEach(a => {
          const href = a.getAttribute('href');
          const title = a.textContent.trim();
          const id = href.split('/')[2];
          if (!id || isNaN(parseInt(id)) || title.length < 2) return;
          if (!isRelevantToQuery(title, href)) return;

          let dates = "";
          const row = a.closest('tr') || a.closest('.search-result') || a.parentElement;
          if (row) {
             const dateEl = row.querySelector('.search-event-date, .date, [class*="date"], .search-result-info');
             if (dateEl) {
               dates = dateEl.textContent.trim();
             } else {
               const text = row.innerText || "";
               const dateMatch = text.match(/([A-Z][a-z]+ \d+(?:st|nd|rd|th)?(?: - [A-Z][a-z]+ \d+(?:st|nd|rd|th)?)?, \d{4})|(\d+ days)/);
               if (dateMatch) dates = dateMatch[0];
             }
          }
          rawEvents.push({ id, title, href, dates });
        });
        return rawEvents;
      }, QUERY);

      if (results.length === 0 && await isBrowserErrorPage(page)) {
        await saveDebugScreenshot(page, 'browser-error-page');
        throw new Error('Proxy tunnel/browser navigation failed on HLTV search page');
      }

      if (results.length === 0 && await isCloudflareChallenge(page)) {
        await saveDebugScreenshot(page, 'cloudflare-block');
        throw new Error('Cloudflare block/challenge detected on HLTV search page');
      }

      const events = [];
      const today = new Date();
      const enrichSearchResults = process.env.HLTV_SEARCH_ENRICH === '1';
      const maxEventPages = Number(process.env.HLTV_SEARCH_TOP_RESULTS || 8);
      const maxValidEvents = Number(process.env.HLTV_SEARCH_MAX_EVENTS || 10);
      const topResults = results.slice(0, maxEventPages);
      
      for (const item of topResults) {
        if (events.length >= maxValidEvents) break;
        const { id, title, href, dates: rawDates } = item;
        
        let cleanTitle = title
          .replace(/^Live\s+/i, '')
          .replace(/\s+\d+\s+days?$/i, '')
          .replace(/\s+ongoing$/i, '')
          .trim();

        let finalDates = rawDates;
        let pageStatus = "unknown";
        
        if (enrichSearchResults) {
          try {
            console.error(`[HLTV Playwright] Checking event status/date: ${cleanTitle} (${id})`);
            await new Promise(r => setTimeout(r, 500 + Math.random() * 700));
            await page.goto('https://www.hltv.org' + href, { waitUntil: 'domcontentloaded', timeout: 8000 });
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
            
            const pageDetails = await page.evaluate(() => {
              const indicator = document.querySelector('.event-hub-indicator');
              const indicatorText = indicator?.textContent?.trim().toLowerCase() || "";
              const indicatorClass = String(indicator?.className || "").toLowerCase();
              const dateCandidates = Array.from(document.querySelectorAll('.event-header-component .eventdate, .eventdate, .event-date, [class*="event-date"], .standard-box .date'))
                .map((el) => el.textContent?.trim().replace(/\s+/g, ' ') || "")
                .filter((text) => text && !/^date$/i.test(text));

              let status = "unknown";
              if (indicatorClass.includes('event-ended') || indicatorText.includes('finished') || indicatorText.includes('ended')) {
                status = "finished";
              } else if (indicatorClass.includes('event-live') || indicatorText.includes('live') || indicatorText.includes('ongoing')) {
                status = "ongoing";
              } else if (indicatorClass.includes('event-upcoming') || indicatorText.includes('upcoming')) {
                status = "upcoming";
              }

              return {
                status,
                dates: dateCandidates[0] || "",
              };
            });
            
            pageStatus = pageDetails.status;
            if (pageDetails.dates) {
              finalDates = pageDetails.dates;
            }
          } catch (e) {
            console.error(`[HLTV Playwright] Failed to fetch status/date for ${id}: ${e.message}`);
          }
        }

        if (!shouldKeepEvent({ title: cleanTitle, href, dates: finalDates || rawDates, status: pageStatus }, QUERY, today)) continue;

        const formattedDates = finalDates && finalDates !== "Date TBD" ? formatHltvDate(finalDates, today) : formatHltvDate(rawDates, today);

        if (!events.some(e => e.id === id)) {
          events.push({ 
            title: cleanTitle, 
            url: 'https://www.hltv.org' + href, 
            id, 
            dates: formattedDates || "Date TBD",
            status: pageStatus,
          });
        }
      }

      const finalResult = { ok: true, events: events.slice(0, maxValidEvents) };
      setCache(finalResult);
      console.log(JSON.stringify(finalResult));
    } else if (MODE === 'health') {
      console.error('[HLTV Playwright] Health Check...');
      await page.goto('https://www.hltv.org', { waitUntil: 'load', timeout: 20000 });
      const title = await page.title();
      console.log(JSON.stringify({ ok: true, title }));
    } else if (MODE === 'events') {
      console.error('[HLTV Playwright] Scraping Ongoing and Upcoming Events...');
      await gotoHltvPage(page, 'https://www.hltv.org/events', 'events');

      await page.waitForFunction(() => {
        const eventItems = document.querySelectorAll('.ongoing-event, .small-event, .big-event');
        if (eventItems.length > 0) return true;

        return Array.from(document.querySelectorAll('.ongoing-events-holder, .events-holder'))
          .some((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length > 20);
      }, { timeout: 15000 });

      const events = await page.evaluate(() => {
        const results = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Day-aligned bounds

        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 14); // 14 days horizon, matching Liquipedia logic
        nextWeek.setHours(23, 59, 59, 999);

        const parseDate = (dStr) => {
          try {
            const match = dStr.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?/i);
            if (!match) return null;
            const parts = match[0].trim().replace(/(st|nd|rd|th)/gi, '');
            const yearMatch = dStr.match(/\b(19\d{2}|20\d{2})\b/);
            const year = yearMatch ? yearMatch[1] : new Date().getFullYear();
            const date = new Date(`${parts} ${year}`);
            return isNaN(date.getTime()) ? null : date;
          } catch(e) { return null; }
        };

        const seenIds = new Set();

        // Ongoing
        document.querySelectorAll('.ongoing-event').forEach(el => {
          const a = el.tagName === 'A' ? el : el.querySelector('a');
          if (a) {
            const href = a.getAttribute('href');
            if (!href) return;
            const parts = href.split('/');
            const id = parts[2];
            if (!id || seenIds.has(id)) return;
            seenIds.add(id);

            const titleEl = el.querySelector('.text-ellipsis, .event-name-container, .event-name-small, .big-event-name');
            const title = titleEl?.textContent?.trim() || el.getAttribute('alt') || a.textContent.trim();
            const datesEl = el.querySelector('.eventDetails, .event-date-container, .col-date, [class*="date"]');
            const dates = datesEl?.textContent?.trim() || "";
            const stars = el.querySelectorAll('.stars i.fa-star, .stars .fa-star, .star, [class*="star"]').length;
            results.push({
              title: title.replace(/\s+/g, ' ').trim(),
              id,
              url: 'https://www.hltv.org' + href,
              status: 'ongoing',
              dates: dates.replace(/\s+/g, ' ').trim(),
              stars: stars || 0
            });
          }
        });

        // Upcoming
        document.querySelectorAll('.small-event, .big-event').forEach(el => {
          const a = el.tagName === 'A' ? el : el.querySelector('a');
          if (a) {
             const href = a.getAttribute('href');
             if (!href) return;
             const parts = href.split('/');
             const id = parts[2];
             if (!id || seenIds.has(id)) return;

             const titleEl = el.querySelector('.text-ellipsis, .event-name-container, .event-name-small, .big-event-name');
             const title = titleEl?.textContent?.trim() || el.getAttribute('alt') || a.textContent.trim();
             const datesEl = el.querySelector('.eventDetails, .event-date-container, .col-date, [class*="date"]');
             const dates = datesEl?.textContent?.trim() || "";
             const stars = el.querySelectorAll('.stars i.fa-star, .stars .fa-star, .star, [class*="star"]').length;
             
             const startDate = parseDate(dates);
             // Filter: only if starts within 14 days
             if (startDate && startDate <= nextWeek && startDate >= today) {
               seenIds.add(id);
               results.push({
                 title: title.replace(/\s+/g, ' ').trim(),
                 id,
                 url: 'https://www.hltv.org' + href,
                 status: 'upcoming',
                 dates: dates.replace(/\s+/g, ' ').trim(),
                 stars: stars || 0
               });
             }
          }
        });
        return results;
      });
      const finalResult = { ok: true, events };
      setCache(finalResult);
      console.log(JSON.stringify(finalResult));
    } else {
      let targetUrl = 'https://www.hltv.org/matches';
      if (MODE === 'event' && EVENT_ID) {
        targetUrl = `https://www.hltv.org/events/${EVENT_ID}/matches`;
        console.error(`[HLTV Playwright] Scraping Event Matches: ${targetUrl}`);
      } else {
        console.error('[HLTV Playwright] Navigating to HLTV Global Matches...');
      }

      await page.goto(targetUrl, { waitUntil: 'load', timeout: 40000 });
      
      try {
        await page.waitForSelector('.match-wrapper, .upcomingMatch, .upcoming-match, .liveMatch, .live-match', { timeout: 15000 });
      } catch (e) {}
      
      const matches = await page.evaluate(() => {
        const results = [];
        const els = document.querySelectorAll('.match-wrapper, .upcomingMatch, .upcoming-match, .liveMatch, .live-match, [class*="match-fixture"]');
        const cleanTeamName = (value) => String(value || '')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s+\d{1,2}$/, '')
          .trim();
        const cleanBestOfFormat = (value) => {
          const text = String(value || '').replace(/\u00a0/g, ' ').trim();
          if (!text) return '';
          const explicit = text.match(/\bbo\s*[-:]?\s*([1-9]\d?)\b/i)
            || text.match(/\bbest\s*[-\s]?of\s*[-:]?\s*([1-9]\d?)\b/i)
            || text.match(/\bbestof\s*([1-9]\d?)\b/i);
          return explicit?.[1] ? `BO${Number(explicit[1])}` : '';
        };
        const normalizeUnixTime = (value, isLive) => {
          const parsed = parseInt(value || "0", 10);
          if (!parsed) return isLive ? Math.floor(Date.now() / 1000) : 0;
          return parsed > 9999999999 ? Math.floor(parsed / 1000) : parsed;
        };
        const now = Math.floor(Date.now() / 1000);
        
        els.forEach(el => {
          let team1 = "", team2 = "", tournament = "Upcoming", unixTime = "0", id = "", isLive = false, format = "";
          const rawText = String(el.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1500);

          isLive = el.classList.contains('liveMatch') ||
            el.classList.contains('live-match') ||
            el.classList.contains('live-match-container') ||
            el.getAttribute('live') === 'true' ||
            !!el.querySelector('.live-flag, .match-meta-live');

          const isFinished = el.classList.contains('finished') ||
            el.classList.contains('result') ||
            el.getAttribute('finished') === 'true' ||
            !!el.querySelector('.match-finished, .match-meta-result, .result-score');

          const teamNames = el.querySelectorAll('.match-teamname, .matchTeamName, .team-name, .team-1 .team-name, .team-2 .team-name');
          if (teamNames.length >= 2) {
            team1 = cleanTeamName(teamNames[0].textContent) || "TBD";
            team2 = cleanTeamName(teamNames[1].textContent) || "TBD";
          } else {
            team1 = teamNames[0] ? (cleanTeamName(teamNames[0].textContent) || "TBD") : "TBD";
            team2 = teamNames[1] ? (cleanTeamName(teamNames[1].textContent) || "TBD") : "TBD";
          }
          
          const eventEl = el.querySelector('.match-event, .matchEventName, .event-headline, .event, [class*="event-name"]');
          tournament = eventEl?.getAttribute('data-event-headline') ||
            eventEl?.textContent?.trim() ||
            "Upcoming";

          const stageText = el.querySelector('.match-stage, .matchStage, .stage, [class*="stage-name"], [class*="round-name"]')?.textContent?.trim() || "";

          const formatCandidates = [
            el.querySelector('.matchMeta, .match-meta, .match-meta-type, [class*="matchMeta"], [class*="match-meta"]')?.textContent,
            ...Array.from(el.querySelectorAll('[class*="meta"], [class*="format"], [class*="best"]')).map(node => node.textContent),
            el.textContent
          ];
          for (const candidate of formatCandidates) {
            format = cleanBestOfFormat(candidate);
            if (format) break;
          }
          
          const timeEl = el.querySelector('[data-unix], .matchTime, .time');
          unixTime = timeEl?.getAttribute('data-unix') || timeEl?.getAttribute('data-time') || "0";
          const normalizedUnixTime = normalizeUnixTime(unixTime, isLive);

          if (isFinished || (!isLive && normalizedUnixTime > 0 && normalizedUnixTime < now - 300)) {
            return;
          }

          const link = el.querySelector('a[href*="/matches/"]');
          if (link) {
            const parts = link.getAttribute('href').split('/');
            id = parts[parts.length - 2] || parts[2];
          }

          if (team1 && team2) {
            results.push({
              id: id || Math.random().toString(36).substr(2, 9),
              tournament,
              team1,
              team2,
              unix_time: normalizedUnixTime,
              format,
              stage: stageText,
              round: stageText,
              rawText,
              isLive
            });
          }
        });
        return results;
      });

      const finalResult = { ok: true, matches };
      setCache(finalResult);
      console.log(JSON.stringify(finalResult));
    }
  } catch (err) {
    console.error(`[HLTV Playwright] Error: ${err.message}`);
    const stale = getCache({ allowStale: true });
    if (stale) {
      console.error('[HLTV Playwright] Returning stale cache after upstream error');
      console.log(JSON.stringify({
        ...stale,
        warning: `HLTV upstream error, returned stale cache: ${err.message}`
      }));
    } else if (MODE === 'search') {
      const related = getRelatedSearchCache(QUERY);
      if (related) {
        console.error('[HLTV Playwright] Returning related search cache after upstream error');
        console.log(JSON.stringify({
          ok: true,
          events: related.events,
          cacheHit: true,
          cacheLayer: 'file-related',
          stale: true,
          warning: `HLTV upstream error, returned related cache: ${err.message}`,
        }));
      } else {
        console.log(JSON.stringify({ ok: false, error: normalizeClosedBrowserError(err.message) }));
      }
    } else {
      console.log(JSON.stringify({ ok: false, error: normalizeClosedBrowserError(err.message) }));
    }
  } finally {
    clearTimeout(scriptTimeout);
    if (browser) await browser.close();
  }
}

async function safeMouseWheel(page, deltaX, deltaY, reason) {
  try {
    if (page.isClosed()) {
      throw new Error(`HLTV page closed during ${reason}`);
    }
    await page.mouse.wheel(deltaX, deltaY);
  } catch (e) {
    const message = String(e?.message || e || '');
    if (/Target page, context or browser has been closed|page closed|browser has been closed/i.test(message)) {
      throw new Error(`HLTV browser closed before search finished (${reason})`);
    }
    throw e;
  }
}

function getRelatedSearchCache(query) {
  if (!query || !fs.existsSync(CACHE_DIR)) return null;

  const scored = [];
  for (const entry of fs.readdirSync(CACHE_DIR)) {
    if (!entry.endsWith('.json')) continue;

    try {
      const cachePath = path.join(CACHE_DIR, entry);
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const events = Array.isArray(data?.result?.events) ? data.result.events : [];
      if (events.length === 0) continue;

      const matchingEvents = events
        .map((event) => ({ event, score: getSearchMatchScore(query, `${event.title || ''} ${event.url || ''}`) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.event);

      if (matchingEvents.length > 0) {
        scored.push({
          events: matchingEvents,
          score: getSearchMatchScore(query, matchingEvents.map((event) => `${event.title || ''} ${event.url || ''}`).join(' ')),
          timestamp: Number(data.timestamp || 0),
        });
      }
    } catch {}
  }

  scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
  const best = scored[0];
  return best ? { events: best.events.slice(0, Number(process.env.HLTV_SEARCH_MAX_EVENTS || 10)) } : null;
}

function getSearchMatchScore(query, value) {
  const queryTokens = normalizeSearchTokens(query);
  if (queryTokens.length === 0) return 0;

  const haystack = normalizeSearchText(value);
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 3 : 1;
    } else {
      return 0;
    }
  }
  return score;
}

function normalizeSearchTokens(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length >= 2);
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeClosedBrowserError(message) {
  if (/Target page, context or browser has been closed|browser closed before search finished|page closed|browser has been closed/i.test(String(message || ''))) {
    return 'HLTV browser closed before the request finished';
  }
  return message;
}

function parseHltvDate(dateStr, today) {
  if (!dateStr) return null;
  const d = dateStr.replace(/\s+/g, ' ').trim();
  if (/^(date|date tbd|tbd)$/i.test(d)) return null;
  if (/^(live|ongoing)$/i.test(d)) return { start: today, end: today };

  const years = Array.from(d.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((match) => Number(match[1]));
  const fallbackYear = years[years.length - 1] || today.getFullYear();

  const parsePart = (part, fallbackMonth = "") => {
    const clean = part.replace(/,/g, '').replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1').trim();
    const match = clean.match(/^(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+)?(\d{1,2})(?:\s+(19\d{2}|20\d{2}))?$/i);
    if (!match) return null;

    const month = match[1] || fallbackMonth;
    const day = Number(match[2]);
    const year = Number(match[3] || fallbackYear);
    if (!month || !day || !year) return null;

    const date = new Date(`${month} ${day}, ${year}`);
    return isNaN(date.getTime()) ? null : date;
  };

  if (d.includes(' - ')) {
    const [startPart, endPart] = d.split(' - ').map((part) => part.trim());
    const end = parsePart(endPart);
    const startMonth = endPart.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i)?.[1] || "";
    const start = parsePart(startPart, startMonth);
    if (start && end) {
      return { start, end };
    }
  }

  const singleMatch = d.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+(?:19\d{2}|20\d{2}))?)/i);
  if (singleMatch) {
    const date = parsePart(singleMatch[1]);
    if (date) return { start: date, end: date };
  }

  const fallbackDate = new Date(d);
  if (!isNaN(fallbackDate.getTime())) {
    return { start: fallbackDate, end: fallbackDate };
  }

  return null;
}

function extractYear(value) {
  const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function isRelevantToQuery(title, href, query) {
  const normalize = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalize(query).split(' ').filter((token) => token.length >= 2);
  if (tokens.length === 0) return true;
  const haystack = normalize(`${title} ${href}`);
  return tokens.every((token) => haystack.includes(token));
}

function isPastEventDate(dates, today) {
  const parsed = parseHltvDate(dates, today);
  if (!parsed?.end) return false;

  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  return parsed.end < todayStart;
}

function isFinishedStatus(status) {
  return String(status || "").toLowerCase() === "finished";
}

function isKnownCurrentStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "ongoing" || normalized === "upcoming";
}

function shouldKeepEvent({ title, href, dates, status }, query, today) {
  if (!isRelevantToQuery(title, href, query)) return false;
  if (isFinishedStatus(status)) return false;
  if (isPastEventDate(dates, today)) return false;

  const year = extractYear(`${title} ${href}`);
  if (year && year < today.getFullYear()) return false;
  if (!parseHltvDate(dates, today) && !isKnownCurrentStatus(status) && !year) return false;

  return true;
}

function formatHltvDate(dates, today) {
  const parsed = parseHltvDate(dates, today);
  if (!parsed) return dates;

  const formatDate = (date) => {
    if (!date || isNaN(date.getTime())) return '????-??-??';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  if (parsed.start.getTime() === parsed.end.getTime()) {
    return formatDate(parsed.start);
  }
  return `${formatDate(parsed.start)} — ${formatDate(parsed.end)}`;
}

scrapeHltv();

async function saveDebugScreenshot(page, reason) {
  try {
    const debugDir = path.join(CACHE_DIR, 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    const safeReason = String(reason || 'error').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
    const fileName = `${MODE}-${REQUEST_ID}-${Date.now()}-${safeReason}.png`;
    await page.screenshot({ path: path.join(debugDir, fileName), fullPage: true });
  } catch (e) {
    console.error(`[HLTV Playwright] Failed to save debug screenshot: ${e.message}`);
  }
}

async function gotoHltvPage(page, url, reason) {
  try {
    const response = await page.goto(url, { waitUntil: 'commit', timeout: 35000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500 + Math.random() * 1500);

    const status = response?.status?.();
    if (status === 403 || status === 424) {
      await saveDebugScreenshot(page, `${reason}-cloudflare-http-${status}`);
      throw new Error(`Cloudflare block/challenge detected on HLTV ${reason} page (${status})`);
    }
    if (status && status >= 500) {
      await saveDebugScreenshot(page, `${reason}-source-${status}`);
      throw new Error(`HLTV source returned ${status} on ${reason} page`);
    }
    if (await isBrowserErrorPage(page)) {
      await saveDebugScreenshot(page, `${reason}-browser-error`);
      throw new Error(`Proxy tunnel/browser navigation failed on HLTV ${reason} page`);
    }

    if (await isCloudflareChallenge(page)) {
      await page.waitForTimeout(8000 + Math.random() * 3000);
      if (await isCloudflareChallenge(page)) {
        await saveDebugScreenshot(page, `${reason}-cloudflare`);
        throw new Error(`Cloudflare block/challenge detected on HLTV ${reason} page`);
      }
    }
    return response;
  } catch (e) {
    await saveDebugScreenshot(page, `${reason}-navigation-error`);
    throw await normalizeNavigationError(page, e, reason);
  }
}

async function normalizeNavigationError(page, error, reason) {
  const message = String(error?.message || error || '');
  if (
    /chrome-error:\/\/chromewebdata|ERR_TUNNEL|ERR_PROXY|ERR_SOCKS|ERR_CONNECTION|ERR_ABORTED|ERR_NAME_NOT_RESOLVED|ERR_HTTP2_PROTOCOL_ERROR/i.test(message) ||
    await isBrowserErrorPage(page)
  ) {
    return new Error(`Proxy tunnel/browser navigation failed on HLTV ${reason} page`);
  }

  if (/ERR_TIMED_OUT|ETIMEDOUT|ESOCKETTIMEDOUT|timed out|timeout|deadline exceeded/i.test(message)) {
    return new Error(`HLTV ${reason} page navigation timed out`);
  }

  return error instanceof Error ? error : new Error(message || `HLTV ${reason} page navigation failed`);
}

async function isCloudflareChallenge(page) {
  try {
    return await page.evaluate(() => {
      const title = document.title || '';
      const body = document.body?.innerText || '';
      const text = `${title}\n${body}`.toLowerCase();
      return /just a moment|attention required|verify you are human|checking if the site connection is secure|checking your browser|cf-ray|cloudflare ray id/.test(text);
    });
  } catch {
    return false;
  }
}

async function isBrowserErrorPage(page) {
  try {
    if (page.url().startsWith('chrome-error://')) return true;
    return await page.evaluate(() => {
      const title = document.title || '';
      const body = document.body?.innerText || '';
      const text = `${title}\n${body}`.toLowerCase();
      return /this site can.?t be reached|err_proxy|err_tunnel|err_connection|proxy server/i.test(text);
    });
  } catch {
    return false;
  }
}

function createPlaywrightProxy(proxyUrl) {
  if (!proxyUrl) return null;

  try {
    const parsed = new URL(proxyUrl);
    const proxy = {
      server: `${parsed.protocol}//${parsed.host}`,
    };
    if (parsed.username) {
      proxy.username = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
      proxy.password = decodeURIComponent(parsed.password);
    }
    return proxy;
  } catch (e) {
    console.error(`[HLTV Playwright] Invalid proxy URL: ${e.message}`);
    return null;
  }
}
