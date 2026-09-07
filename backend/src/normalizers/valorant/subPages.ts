/** Собрать ссылки на стадии выбранного турнира → отфильтровать неподходящие разделы → вернуть уникальные страницы. */
import * as cheerio from "cheerio";

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
    if (!EVENT_SUBPAGE_ALLOWLIST.includes(suffix)) return;

    subPages.push(`${parsed.origin}${path}`);
  };

  if (html) {
    const $ = cheerio.load(html);
    $(".tabs-static a, .nav-tabs a").each((_, el) => {
      pushIfRelevant($(el).attr("href"));
    });
  }
  const titlePart = rawBase.replace(/_/g, " ");
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
    pushIfRelevant(`/valorant/${title}`);
  };

  const subLinkRegex = /\[\[([^|\]]+\/[^|\]]+)(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = subLinkRegex.exec(wikitext))) {
    const subPath = match[1].replace(/_/g, " ");
    if (subPath.startsWith(titlePart) && subPath !== titlePart) {
      pushIfRelevant(`/valorant/${subPath.replace(/ /g, "_")}`);
    }
    pushTitleIfRelevant(match[1]);
  }

  const templatePageRefRegex = /\|\s*(?:tournament|page)\s*=\s*([^|}\n<]+)/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = templatePageRefRegex.exec(wikitext))) {
    pushTitleIfRelevant(refMatch[1]);
  }
  return Array.from(new Set(subPages));
}

const EVENT_SUBPAGE_ALLOWLIST = [
  "Group_Stage",
  "Swiss_Stage",
  "Playoffs",
  "Bracket",
  "Main_Event",
  "Regular_Season",
  "Finals"
];
