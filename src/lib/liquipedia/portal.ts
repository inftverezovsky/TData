import * as cheerio from "cheerio";
import { getPortalCache } from "../db/db";
import { fetchHtml } from "./client";
import { withGenericRateLimit } from "./rateLimiter";

export type PortalTournament = {
  title: string;
  url: string;
  dates: string;
  status: "ongoing" | "upcoming" | "completed";
  tier?: string;
};

export type DisciplinePortalData = {
  slug: string;
  name: string;
  tournaments: PortalTournament[];
};

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const PORTAL_LOOKBACK_DAYS = Number(process.env.LIQUIPEDIA_PORTAL_LOOKBACK_DAYS || 5);
const PORTAL_UPCOMING_WINDOW_DAYS = Number(process.env.LIQUIPEDIA_PORTAL_UPCOMING_WINDOW_DAYS || 7);
const PORTAL_TIMEOUT_MS = Number(process.env.LIQUIPEDIA_PORTAL_TIMEOUT_MS || 60000);

export async function fetchDisciplinePortal(slug: string, force = false): Promise<DisciplinePortalData> {
  const cacheKey = slug;
  const portalCache = getPortalCache();
  
  if (!force) {
    const cached = portalCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Portal Lib] Returning in-memory cache for ${slug}`);
      return cached.data;
    }
  } else {
    // If force, clear proxy cooldowns AND clear this portal's cache
    const { resetProxyCooldowns } = await import("../proxy/proxySelector");
    await resetProxyCooldowns();
    portalCache.delete(cacheKey);
    console.log(`[Portal Lib] Force refresh: cleared proxy cooldowns and portal cache for ${slug}`);
  }

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<DisciplinePortalData>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`[Portal Lib] TIMEOUT reached for ${slug}, returning cached/empty`);
      const cached = portalCache.get(cacheKey);
      resolve(cached?.data || { slug, name: slug, tournaments: [] });
    }, PORTAL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      internalFetchDisciplinePortal(slug, force),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function internalFetchDisciplinePortal(slug: string, force = false): Promise<DisciplinePortalData> {
  const cacheKey = slug;
  const urls = [`https://liquipedia.net/${slug}/Main_Page`];
  if (slug === 'leagueoflegends') {
    urls.push(`https://liquipedia.net/leagueoflegends/Portal:Tournaments`);
  }
  
  try {
    let html = "";
    let attempts = 0;
  const maxAttempts = force || slug === "leagueoflegends" ? 3 : 1;

  while (attempts < maxAttempts && !html) {
    attempts++;
    try {
      for (const url of urls) {
        try {
          console.log(`[Portal Lib] Fetching ${url} via Proxy (Attempt ${attempts}/${maxAttempts})`);
          const content = await withGenericRateLimit(() => fetchHtml(url), `portal:${slug}`);
          if (content.length > 5000) {
            html = content;
            break;
          }
        } catch (e) {
          console.error(`[Portal Lib] Failed to fetch ${url}:`, e);
        }
      }
    } catch (e) {}

    if (!html && attempts < maxAttempts) {
      console.log(`[Portal Lib] No content received, waiting 2s before retry...`);
      await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 700)));
    }
  }

  if (!html) {
    const cached = getPortalCache().get(cacheKey);
    if (cached) return cached.data;
    return { slug, name: slug, tournaments: [] };
  }
  
    const result = slug === "leagueoflegends"
      ? buildLeagueOfLegendsPortalResult(html, slug)
      : buildGenericPortalResult(html, slug);

    if (result.tournaments.length > 0) {
      getPortalCache().set(cacheKey, { data: result, timestamp: Date.now() });
    }
    return result;
  } catch (err) {
    console.error(`[Portal Lib] Error in fetchDisciplinePortal for ${slug}:`, err);
    const cached = getPortalCache().get(cacheKey);
    if (cached) return cached.data;
    return { slug, name: slug, tournaments: [] };
  }
}

export function buildLeagueOfLegendsPortalResult(html: string, slug: string): DisciplinePortalData {
  const tournaments = extractLeagueOfLegendsPortalCandidates(html);
  return finalizePortalTournaments(slug, tournaments);
}

export function buildGenericPortalResult(html: string, slug: string): DisciplinePortalData {
  const $ = cheerio.load(html);
  const tournaments: PortalTournament[] = [];

  const sections = [
    { header: "Ongoing", status: "ongoing" as const },
    { header: "Upcoming", status: "upcoming" as const },
    { header: "Current", status: "ongoing" as const },
    { header: "Future", status: "upcoming" as const }
  ];

  for (const section of sections) {
    const $header = $(`h2, h3, b, .t-h-header, .tournament-tabs > div, span`).filter((_, el) => {
      const t = $(el).text().trim().toLowerCase();
      const headerLower = section.header.toLowerCase();
      return t === headerLower || t.includes(headerLower + " tournaments") || (t.includes(headerLower) && t.length < 20);
    }).first();

    if ($header.length === 0) continue;

    let $container = $header.nextAll(".tournaments-list, .t-h-list").first();
    if ($container.length === 0) {
      $container = $header.closest("div").parent().find(".tournaments-list, .t-h-list").first();
    }
    if ($container.length === 0) {
      $container = $(".tournaments-list, .t-h-list").first();
    }

    $container.find(".t-h-row, li").each((_, el) => {
      const $el = $(el);
      const $titleEl = $el.find(".t-h-name, .tournaments-list-name").first();
      let title = "";
      let href = "";

      if ($titleEl.length > 0) {
        const $a = $titleEl.find("a").first();
        title = $a.attr("title") || $a.text().trim();
        href = $a.attr("href") || "";
      } else {
        const $a = $el.find("a").first();
        title = $a.attr("title") || $a.text().trim();
        href = $a.attr("href") || "";
      }

      const $dateEl = $el.find(".t-h-dates, .tournaments-list-date, small").first();
      let dates = "";
      if ($dateEl.length > 0) {
        dates = $dateEl.text().trim().replace(/[()]/g, "");
      }

      if (title && href && !href.includes("Special:") && !href.includes("action=edit") && title.length > 2) {
        const tierText = $el.find(".tournament-badge__text").first().text().trim();
        const tierChip = $el.find(".tournament-badge__chip").first().text().trim();
        const tier = tierChip ? `Tier ${tierChip}` : tierText;

        tournaments.push({
          title,
          url: href.startsWith("http") ? href : `https://liquipedia.net${href}`,
          dates,
          status: section.status,
          tier: tier || undefined
        });
      }
    });
  }

  return finalizePortalTournaments(slug, tournaments);
}

function extractLeagueOfLegendsPortalCandidates(html: string): PortalTournament[] {
  const $ = cheerio.load(html);
  const tournaments: PortalTournament[] = [];

  $(".tournaments-list-item").each((_, el) => {
    const $el = $(el);
    const $a = $el.find(".tournaments-list-item__name a").first().length
      ? $el.find(".tournaments-list-item__name a").first()
      : $el.find("a").first();
    const title = $a.attr("title") || $a.text().trim();
    const href = $a.attr("href") || "";
    const dates = $el.find(".tournaments-list-item__date").first().text().trim().replace(/[()]/g, "");
    const tierText = $el.find(".tournament-badge__text").first().text().trim();
    const tierChip = $el.find(".tournament-badge__chip").first().text().trim();
    const tier = tierChip ? `Tier ${tierChip}` : tierText;

    if (title && href && !href.includes("Special:") && !href.includes("action=edit")) {
      tournaments.push({
        title,
        url: href.startsWith("http") ? href : `https://liquipedia.net${href}`,
        dates,
        status: "upcoming",
        tier: tier || undefined
      });
    }
  });

  $("tr.table2__row--body, tr[class*='row--body']").each((_, row) => {
    const $row = $(row);
    const tds = $row.children("td");
    const $a = $row.find("td.column__tournament a, td[class*='tournament'] a").first();
    const title = $a.attr("title") || $a.text().trim();
    const href = $a.attr("href") || "";
    const dates = tds.eq(3).text().trim().replace(/[()]/g, "");
    const tier = tds.eq(0).text().trim().replace(/\s+/g, " ");

    if (title && href && !href.includes("Special:") && !href.includes("action=edit")) {
      tournaments.push({
        title,
        url: href.startsWith("http") ? href : `https://liquipedia.net${href}`,
        dates,
        status: "upcoming",
        tier: tier || undefined
      });
    }
  });

  $(".t-h-row, .tournaments-list li, .tournaments-list-name").each((_, el) => {
    const $el = $(el);
    const $a = $el.find("a").first();
    const title = $a.attr("title") || $a.text().trim();
    const href = $a.attr("href") || "";
    const dates = $el.find(".t-h-dates, .tournaments-list-date, small").text().trim().replace(/[()]/g, "");
    if (title && href && !href.includes("Special:") && !href.includes("action=edit")) {
      tournaments.push({
        title,
        url: href.startsWith("http") ? href : `https://liquipedia.net${href}`,
        dates,
        status: "upcoming",
      });
    }
  });

  return tournaments;
}

function finalizePortalTournaments(slug: string, tournaments: PortalTournament[]): DisciplinePortalData {
  const now = new Date();
  const merged = new Map<string, PortalTournament & { startDate: Date | null; endDate: Date | null }>();

  for (const tournament of tournaments) {
    if (!tournament.title || !tournament.url) continue;
    const parsedDates = parsePortalDateRange(tournament.dates || "", now);
    const startDate = parsedDates?.startDate ?? null;
    const endDate = parsedDates?.endDate ?? null;
    const status = inferPortalStatus(tournament.status, startDate, endDate, now);
    const next = { ...tournament, status, startDate, endDate };
    const existing = merged.get(tournament.url);

    if (!existing) {
      merged.set(tournament.url, next);
      continue;
    }

    const existingRank = portalStatusRank(existing.status);
    const nextRank = portalStatusRank(next.status);
    const hasBetterDates = Boolean(next.startDate || next.endDate) && !existing.startDate && !existing.endDate;
    if (nextRank < existingRank || hasBetterDates || (existing.dates.length === 0 && next.dates.length > 0)) {
      merged.set(tournament.url, next);
    }
  }

  const filtered = Array.from(merged.values()).filter((t) => {
    if (t.status === "ongoing") return true;

    if (!t.startDate || !t.endDate) {
      return t.status === "upcoming";
    }

    const diffDaysStart = (t.startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    const diffDaysEnd = (now.getTime() - t.endDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDaysStart >= -PORTAL_LOOKBACK_DAYS && diffDaysStart <= 0) return true;
    if (t.status === "upcoming" || diffDaysStart > 0) {
      return diffDaysStart <= PORTAL_UPCOMING_WINDOW_DAYS;
    }
    if (diffDaysEnd > 1) return false;
    return true;
  });

  const sortedTournaments = filtered.sort((a, b) => {
    if (a.status === "ongoing" && b.status !== "ongoing") return -1;
    if (a.status !== "ongoing" && b.status === "ongoing") return 1;
    if (a.startDate && b.startDate) {
      return a.startDate.getTime() - b.startDate.getTime();
    }
    return 0;
  });

  const nameMapping: Record<string, string> = {
    dota2: "Dota 2",
    counterstrike: "Counter-Strike",
    leagueoflegends: "League of Legends",
    valorant: "Valorant"
  };

  return {
    slug,
    name: nameMapping[slug] || (slug.charAt(0).toUpperCase() + slug.slice(1)),
    tournaments: sortedTournaments.slice(0, 15)
  };
}

function inferPortalStatus(
  initialStatus: PortalTournament["status"],
  startDate: Date | null,
  endDate: Date | null,
  now: Date
): PortalTournament["status"] {
  let status = initialStatus;
  const nowMs = now.getTime();

  if (startDate && endDate) {
    const startMs = startDate.getTime();
    const endMs = endDate.getTime() + 1000 * 60 * 60 * 24;
    if (nowMs >= startMs - 1000 * 60 * 60 * 12 && nowMs <= endMs) {
      status = "ongoing";
    } else if (nowMs < startMs) {
      status = "upcoming";
    } else {
      status = "completed";
    }
  } else if (startDate) {
    if (startDate.getTime() > nowMs) {
      status = "upcoming";
    } else if (startDate.getTime() < nowMs - 1000 * 60 * 60 * 24) {
      status = "completed";
    } else {
      status = "ongoing";
    }
  }

  return status;
}

function portalStatusRank(status: PortalTournament["status"]) {
  switch (status) {
    case "ongoing":
      return 0;
    case "upcoming":
      return 1;
    case "completed":
      return 2;
  }
}

function parsePortalDateRange(dates: string, now: Date) {
  const dateText = dates.toLowerCase().replace(/\s+/g, " ").trim();
  const monthPattern = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
  const dayPattern = "(\\d{1,2})(?:st|nd|rd|th)?";
  const yearPattern = "((?:19|20)\\d{2})";

  const range = dateText.match(new RegExp(`\\b${monthPattern}\\s+${dayPattern}\\s*[-–—]\\s*(?:${monthPattern}\\s+)?${dayPattern}(?:,?\\s*${yearPattern})?`, "i"));
  const monthRange = dateText.match(/\b([a-z]{3,9})\s*[-–—]\s*([a-z]{3,9})(?:,?\s*((?:19|20)\d{2}))?/i);
  const single = dateText.match(new RegExp(`\\b${monthPattern}\\s+${dayPattern}(?:,?\\s*${yearPattern})?`, "i"));

  if (range) {
    const startMonth = parsePortalMonth(range[1]);
    const startDay = Number(range[2]);
    const endMonth = parsePortalMonth(range[3] || range[1]);
    const endDay = Number(range[4]);
    const explicitYear = range[5] ? Number(range[5]) : null;
    if (startMonth === null || endMonth === null || !isValidPortalDay(startDay) || !isValidPortalDay(endDay)) {
      return null;
    }

    const year = explicitYear || inferPortalYear(startMonth, startDay, now);
    const startDate = new Date(year, startMonth, startDay);
    const endDate = new Date(year, endMonth, endDay);
    if (endDate < startDate) endDate.setFullYear(endDate.getFullYear() + 1);
    return { startDate, endDate };
  }

  if (monthRange) {
    const startMonth = parsePortalMonth(monthRange[1]);
    const endMonth = parsePortalMonth(monthRange[2]);
    if (startMonth === null || endMonth === null) return null;

    const year = monthRange[3] ? Number(monthRange[3]) : inferPortalYear(startMonth, 1, now);
    const startDate = new Date(year, startMonth, 1);
    let endYear = year;
    if (endMonth < startMonth) endYear += 1;
    const endDate = new Date(endYear, endMonth + 1, 0);
    return { startDate, endDate };
  }

  if (single) {
    const month = parsePortalMonth(single[1]);
    const day = Number(single[2]);
    if (month === null || !isValidPortalDay(day)) return null;
    const year = single[3] ? Number(single[3]) : inferPortalYear(month, day, now);
    const date = new Date(year, month, day);
    return { startDate: date, endDate: new Date(date.getTime()) };
  }

  return null;
}

function parsePortalMonth(value: string) {
  const normalized = value.trim().toLowerCase().slice(0, 3);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(normalized);
  return index >= 0 ? index : null;
}

function inferPortalYear(month: number, day: number, now: Date) {
  const candidate = new Date(now.getFullYear(), month, day);
  if (candidate.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 30 && month < now.getMonth()) {
    return now.getFullYear() + 1;
  }
  return now.getFullYear();
}

function isValidPortalDay(day: number) {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}


