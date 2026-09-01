import type { TournamentImportSource } from "./dispatcher";

type SourceUrlPolicy = {
  disciplines: readonly string[];
  hostnames: readonly string[];
  path: RegExp;
};

const SOURCE_URL_POLICIES: Record<TournamentImportSource, SourceUrlPolicy> = {
  liquipedia: {
    disciplines: ["dota2", "counterstrike", "leagueoflegends", "valorant"],
    hostnames: ["liquipedia.net", "www.liquipedia.net"],
    path: /^\/[a-z0-9_-]+(?:\/.*)?$/iu,
  },
  hltv: {
    disciplines: ["counterstrike"],
    hostnames: ["hltv.org", "www.hltv.org"],
    path: /^\/events\/[1-9]\d{0,15}(?:\/[^/?#]+)?(?:\/matches)?\/?$/iu,
  },
  vlr: {
    disciplines: ["valorant"],
    hostnames: ["vlr.gg", "www.vlr.gg"],
    path: /^\/event\/[1-9]\d{0,15}(?:\/[^/?#]+(?:\/[^/?#]+)*)?\/?$/iu,
  },
  dltv: {
    disciplines: ["dota2"],
    hostnames: ["dltv.org", "www.dltv.org", "ru.dltv.org"],
    path: /^\/events(?:\/[^/?#]+)+\/?$/iu,
  },
  fandom: {
    disciplines: ["leagueoflegends"],
    hostnames: ["lol.fandom.com"],
    path: /^\/wiki\/[^/?#]+(?:\/[^/?#]+)*\/?$/iu,
  },
  volleyballworld: {
    disciplines: ["beachvolleyball"],
    hostnames: ["volleyballworld.com", "www.volleyballworld.com", "en.volleyballworld.com"],
    path: /^\/(?:global-schedule|beachvolleyball(?:\/.*)?)\/?$/iu,
  },
  beachvolleyru: {
    disciplines: ["beachvolleyball"],
    hostnames: ["beach.volley.ru"],
    path: /^\/calendar\/[^/?#]+(?:\/allgames)?\/?$/iu,
  },
  germanbeachtour: {
    disciplines: ["beachvolleyball"],
    hostnames: ["beach.volleyball-verband.de"],
    path: /^\/public\/(?:tur-show|tur-sp)\.php$/iu,
  },
  twelvendrcsvp: {
    disciplines: ["beachvolleyball"],
    hostnames: ["fivb.12ndr.at"],
    path: /^\/tournament\/?$/iu,
  },
  twelvendroevv: {
    disciplines: ["beachvolleyball"],
    hostnames: ["fivb.12ndr.at"],
    path: /^\/tournament\/?$/iu,
  },
  cbv: {
    disciplines: ["beachvolleyball"],
    hostnames: ["evolleyball.cbv.com.br"],
    path: /^\/?$/u,
  },
  federvolley: {
    disciplines: ["beachvolleyball"],
    hostnames: ["www.federvolley.it", "federvolley.it", "beachvolley.federvolley.it", "srv.matchshare.it"],
    path: /^(?:\/campionati\/beach-volley\/20\d{2}\/BVL[MF][1-9]\d{0,15}|\/index\.php\/node\/[1-9]\d{0,31}|\/bvl_test\/bracket\.php)\/?$/iu,
  },
  wtt: {
    disciplines: ["tabletennis"],
    hostnames: ["worldtabletennis.com", "www.worldtabletennis.com"],
    path: /^\/eventInfo\/?$/u,
  },
};

export function isTournamentImportSource(value: unknown): value is TournamentImportSource {
  return typeof value === "string" && Object.hasOwn(SOURCE_URL_POLICIES, value);
}

export function validateTournamentImportSourceUrl(
  source: TournamentImportSource,
  value: string,
  disciplineSlug: string,
) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const policy = SOURCE_URL_POLICIES[source];
  if (!policy || !policy.disciplines.includes(disciplineSlug)) {
    throw new Error("Import source is not allowed for this discipline.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid tournament source URL.");
  }

  if (
    url.protocol !== "https:"
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || !policy.hostnames.includes(url.hostname.toLowerCase())
    || !policy.path.test(url.pathname)
  ) {
    throw new Error("Tournament URL is not allowed for the selected source.");
  }

  if (source === "liquipedia") {
    const disciplinePath = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (disciplinePath !== disciplineSlug) {
      throw new Error("Liquipedia URL does not match the selected discipline.");
    }
  }

  return raw;
}
