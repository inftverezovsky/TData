export type TournamentSource = "liquipedia" | "hltv";

export function detectTournamentSource(pageUrl?: string | null): TournamentSource {
  if (!pageUrl) return "liquipedia";

  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    return host === "hltv.org" || host.endsWith(".hltv.org") ? "hltv" : "liquipedia";
  } catch {
    return /(^|\/\/)(www\.)?hltv\.org\//i.test(pageUrl) ? "hltv" : "liquipedia";
  }
}

export function getTournamentSourceLabel(source: TournamentSource) {
  return source === "hltv" ? "HLTV Source" : "Liquipedia Source";
}
