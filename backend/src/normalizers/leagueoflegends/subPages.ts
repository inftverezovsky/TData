/** Собрать ссылки на стадии выбранного турнира → отфильтровать неподходящие разделы → вернуть уникальные страницы. */
import * as cheerio from "cheerio";

const EVENT_SUBPAGE_ALLOWLIST = [
  "Group_Stage",
  "Groups",
  "Swiss_Stage",
  "Playoffs",
  "Bracket",
  "Main_Event",
  "Regular_Season",
  "Finals",
  "Knockout_Stage",
  "Match_Schedule",
  "Play-In",
  "Play-In_Stage",
  "Play_In_Stage",
  "Bracket_Stage",
  "Cup",
  "Season_Opening",
  "Road_to_MSI",
  "Rounds_1-2",
  "Rounds_3-4",
  "Play_Offs",
  "Overview"
];

const EVENT_SUBPAGE_BLOCKLIST = [
  "Teams",
  "Participants",
  "Results",
  "Statistics",
  "North_America",
  "South_America",
  "Western_Europe",
  "Eastern_Europe",
  "Southeast_Asia",
  "China",
  "Europe",
  "Americas",
  "Asia",
  "Oceania",
  "MENA"
];

export function extractSubPages(wikitext: string, html: string, pageUrl: string): string[] {
  const subPages: string[] = [];
  const baseUrl = pageUrl.replace(/\/+$/, "");
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  const rawBase = decodeURIComponent(basePath.split("/").slice(2).join("/")).replace(/ /g, "_");

  const pushIfRelevant = (href: string | undefined | null) => {
    if (!href || href.startsWith("#") || href.includes("action=edit")) return;

    const fullUrl = href.startsWith("http") ? href : `https://liquipedia.net${href.startsWith("/") ? href : `/${href}`}`;
    let parsed: URL;
    try {
      parsed = new URL(fullUrl);
    } catch {
      return;
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path.startsWith(`${basePath}/`)) return;

    const suffix = decodeURIComponent(path.slice(basePath.length + 1)).replace(/ /g, "_");
    if (!suffix || suffix.includes("/") || suffix.includes("Qualifier")) return;
    if (EVENT_SUBPAGE_BLOCKLIST.includes(suffix)) return;
    if (!EVENT_SUBPAGE_ALLOWLIST.includes(suffix)) return;

    subPages.push(`${parsed.origin}${path}`);
  };

  const pushTabStaticRelative = (href: string | undefined | null) => {
    if (!href || href.startsWith("#") || href.includes("action=edit")) return;
    if (!href.startsWith("/")) return;
    const candidateUrl = new URL(href, "https://liquipedia.net");
    const path = candidateUrl.pathname.replace(/\/+$/, "");
    if (!path.startsWith(`${basePath}/`)) return;
    const suffix = decodeURIComponent(path.slice(basePath.length + 1)).replace(/ /g, "_");
    if (!suffix || suffix.includes("Qualifier")) return;
    if (EVENT_SUBPAGE_BLOCKLIST.includes(suffix)) return;
    if (EVENT_SUBPAGE_ALLOWLIST.includes(suffix)) {
      subPages.push(`${candidateUrl.origin}${path}`);
    }
  };

  const pushTitleIfRelevant = (rawTitle: string | undefined | null) => {
    if (!rawTitle) return;
    const title = rawTitle
      .trim()
      .replace(/\{\{\s*#var:home\s*\}\}/gi, rawBase)
      .replace(/\{\{\s*FULLPAGENAME\s*\}\}/gi, rawBase)
      .replace(/^:+/, "")
      .replace(/ /g, "_")
      .split("#")[0]
      .replace(/\/+$/, "");
    if (!title || !title.startsWith(`${rawBase}/`)) return;
    pushTabStaticRelative(`/leagueoflegends/${title}`);
  };

  // 1. HTML Tabs
  if (html) {
    const $ = cheerio.load(html);
    $(".tabs-static a, .nav-tabs a").each((_, el) => {
      pushTabStaticRelative($(el).attr("href"));
    });
  }

  // 2. Wikitext Links (Aggressive discovery for stages/weeks)
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wikiLinkRegex.exec(wikitext))) {
    pushTitleIfRelevant(match[1]);
  }

  const templatePageRefRegex = /\|\s*(?:tournament|page)\s*=\s*([^|}\n<]+)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = templatePageRefRegex.exec(wikitext))) {
    pushTitleIfRelevant(refMatch[1]);
  }

  return Array.from(new Set(subPages));
}
