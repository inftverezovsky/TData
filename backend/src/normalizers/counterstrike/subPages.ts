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
  "Play-In",
  "Play-In_Stage"
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
  const $ = cheerio.load(html);
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
    pushIfRelevant(`/counterstrike/${title}`);
  };

  // Look for Tabs (standard Liquipedia structure for multi-page tournaments)
  $(".tabs-static a, .nav-tabs a").each((_, el) => {
    pushIfRelevant($(el).attr("href"));
  });

  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiLinkRegex.exec(wikitext))) {
    pushTitleIfRelevant(wikiMatch[1]);
  }

  const templatePageRefRegex = /\|\s*(?:tournament|page)\s*=\s*([^|}\n<]+)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = templatePageRefRegex.exec(wikitext))) {
    pushTitleIfRelevant(refMatch[1]);
  }

  return Array.from(new Set(subPages));
}
