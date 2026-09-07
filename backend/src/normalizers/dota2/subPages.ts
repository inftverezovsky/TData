/** Собрать ссылки на стадии выбранного турнира → отфильтровать неподходящие разделы → вернуть уникальные страницы. */
import * as cheerio from "cheerio";

const EVENT_SUBPAGE_ALLOWLIST = [
  "Group_Stage",
  "Swiss_Stage",
  "Playoffs",
  "Bracket",
  "Main_Event",
  "Regular_Season",
  "Finals"
];

const QUALIFIER_SUBPAGE_BLOCKLIST = [
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
    if (QUALIFIER_SUBPAGE_BLOCKLIST.includes(suffix)) return;
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
    pushIfRelevant(`/dota2/${title}`);
  };

  // Look for tabs, but avoid qualification region pages. Those pages are expensive
  // to parse and do not belong to the selected main event schedule.
  $(".tabs-static a, .nav-tabs a").each((_, el) => {
    pushIfRelevant($(el).attr("href"));
  });

  // Some pages mention event subpages only in wikitext links.
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiLinkRegex.exec(wikitext))) {
    pushTitleIfRelevant(wikiMatch[1]);
  }

  // Templates such as GroupTableLeague/CrossTableLeague often reference the
  // detailed schedule as |tournament=Event/Group_Stage without a normal link.
  const templatePageRefRegex = /\|\s*(?:tournament|page)\s*=\s*([^|}\n<]+)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = templatePageRefRegex.exec(wikitext))) {
    pushTitleIfRelevant(refMatch[1]);
  }

  return Array.from(new Set(subPages));
}
