import * as cheerio from "cheerio";
import { getLiquipediaUserAgent } from "../config/env";
import { getPortalCache } from "../db/db";
import { fetchHtml } from "./client";

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

  // Absolute timeout of 45 seconds for the entire operation
  return Promise.race([
    internalFetchDisciplinePortal(slug, force),
    new Promise<DisciplinePortalData>((resolve) => 
      setTimeout(() => {
        console.warn(`[Portal Lib] TIMEOUT reached for ${slug}, returning cached/empty`);
        const cached = portalCache.get(cacheKey);
        resolve(cached?.data || { slug, name: slug, tournaments: [] });
      }, 45000)
    )
  ]);
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
  const maxAttempts = force ? 3 : 1;

  while (attempts < maxAttempts && !html) {
    attempts++;
    try {
      for (const url of urls) {
        try {
          console.log(`[Portal Lib] Fetching ${url} via Proxy (Attempt ${attempts}/${maxAttempts})`);
          const content = await fetchHtml(url);
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
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!html) {
    const cached = getPortalCache().get(cacheKey);
    if (cached) return cached.data;
    return { slug, name: slug, tournaments: [] };
  }
    
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

    // Aggressive Fallback
    if (tournaments.length === 0 || (slug === 'leagueoflegends' && tournaments.length < 3)) {
      $(".t-h-row, .tournaments-list li, .tournaments-list-name").each((_, el) => {
        const $el = $(el);
        const $a = $el.find("a").first();
        const title = $a.attr("title") || $a.text().trim();
        const href = $a.attr("href") || "";
        const dates = $el.find(".t-h-dates, .tournaments-list-date, small").text().trim().replace(/[()]/g, "");
        
        if (title && href && !href.includes("Special:") && title.length > 2) {
          if (slug === 'leagueoflegends' && !href.includes('/leagueoflegends/')) return;
          
          const tierText = $el.find(".tournament-badge__text").first().text().trim();
          const tierChip = $el.find(".tournament-badge__chip").first().text().trim();
          const tier = tierChip ? `Tier ${tierChip}` : tierText;

          tournaments.push({
            title,
            url: href.startsWith("http") ? href : `https://liquipedia.net${href}`,
            dates,
            status: "upcoming", 
            tier: tier || undefined
          });
        }
      });

      // Aggressive: look for any panel-box (common for featured tournaments in Dota 2)
      $(".panel-box").each((_, box) => {
        const $box = $(box);
        $box.find("a").each((_, a) => {
          const $a = $(a);
          const title = $a.attr("title") || $a.text().trim();
          const href = $a.attr("href") || "";
          
          // Skip small icons, special pages, and clearly non-tournament links
          if (title && href && !href.includes("Special:") && !href.includes("action=edit") && title.length > 5) {
            // Check if it's likely a tournament link
            const isTournamentUrl = href.includes("/dota2/") && !href.includes("/Main_Page") && !href.includes("/Portal:");
            if (isTournamentUrl) {
              // Try to find dates in the same box
              const dates = $box.text().match(/[A-Z][a-z]+ \d+(?: \d+)?/g)?.join(" - ") || "";
              tournaments.push({
                title,
                url: href.startsWith("http") ? href : `https://liquipedia.net${href}`,
                dates,
                status: "ongoing", // Assume featured/panel-box tournaments are ongoing
              });
            }
          }
        });
      });
    }

    const uniqueTournaments = Array.from(new Map(tournaments.map(t => [t.url, t])).values());

    const now = new Date();
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    const enriched = uniqueTournaments.map(t => {
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      try {
        const dateLower = t.dates.toLowerCase();
        const foundMonths: { month: number, index: number }[] = [];
        for (const [m, i] of Object.entries(months)) {
          let idx = dateLower.indexOf(m);
          while (idx !== -1) {
            foundMonths.push({ month: i, index: idx });
            idx = dateLower.indexOf(m, idx + 1);
          }
        }
        foundMonths.sort((a, b) => a.index - b.index);

        const days = dateLower.match(/\d+/g);
        if (foundMonths.length > 0 && days && days.length > 0) {
          const startMonth = foundMonths[0].month;
          const startDay = parseInt(days[0]);
          startDate = new Date(now.getFullYear(), startMonth, startDay);
          
          if (startDate.getTime() < now.getTime() - 1000 * 60 * 60 * 24 * 30) {
             if (startMonth < now.getMonth()) {
               startDate.setFullYear(now.getFullYear() + 1);
             }
          }

          if (days.length > 1) {
            const endMonth = foundMonths.length > 1 ? foundMonths[foundMonths.length - 1].month : startMonth;
            const endDay = parseInt(days[days.length - 1]);
            endDate = new Date(startDate.getFullYear(), endMonth, endDay);
            
            if (endDate.getTime() < startDate.getTime()) {
               endDate.setFullYear(endDate.getFullYear() + 1);
            }
          } else {
            endDate = new Date(startDate.getTime());
          }
        }
      } catch (e) {}

      // Re-calculate status based on parsed dates for better accuracy
      let status = t.status;
      if (startDate && endDate) {
        const startMs = startDate.getTime();
        const endMs = endDate.getTime() + 1000 * 60 * 60 * 24; // End of the day
        const nowMs = now.getTime();

        // If starts today or yesterday, or is currently running
        if (nowMs >= startMs - 1000 * 60 * 60 * 12 && nowMs <= endMs) {
          status = "ongoing";
        } else if (nowMs < startMs) {
          status = "upcoming";
        } else if (nowMs > endMs) {
          status = "completed";
        }
      }

      return { ...t, status, startDate, endDate };
    });

    const filtered = enriched.filter(t => {
      if (t.status === 'ongoing') return true;
      
      if (!t.startDate || !t.endDate) {
        // If we can't parse dates, only show if it was explicitly "upcoming" or "ongoing"
        return t.status === 'upcoming';
      }

      const diffDaysStart = (t.startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      const diffDaysEnd = (now.getTime() - t.endDate.getTime()) / (1000 * 60 * 60 * 24);

      // 1. Show if it started within the last 5 days (even if marked completed)
      if (diffDaysStart >= -5 && diffDaysStart <= 0) return true;

      // 2. Show if it's upcoming in the next 14 days
      if (t.status === 'upcoming' || diffDaysStart > 0) {
        return diffDaysStart <= 14;
      }

      // 3. Hide if it ended more than 1 day ago
      if (diffDaysEnd > 1) return false;

      return true;
    });

    const sortedTournaments = filtered.sort((a, b) => {
      if (a.status === 'ongoing' && b.status !== 'ongoing') return -1;
      if (a.status !== 'ongoing' && b.status === 'ongoing') return 1;
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

    const result = {
      slug,
      name: nameMapping[slug] || (slug.charAt(0).toUpperCase() + slug.slice(1)),
      tournaments: sortedTournaments.slice(0, 15)
    };

    getPortalCache().set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.error(`[Portal Lib] Error in fetchDisciplinePortal for ${slug}:`, err);
    const cached = getPortalCache().get(cacheKey);
    if (cached) return cached.data;
    return { slug, name: slug, tournaments: [] };
  }
}


