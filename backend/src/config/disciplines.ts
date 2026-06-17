import { prisma } from "@backend/db/db";
import { getLiquipediaDota2ApiUrl, getLiquipediaCounterStrikeApiUrl, getLiquipediaLolApiUrl, getLiquipediaValorantApiUrl } from "@backend/config/env";
import { withPrismaConnectionRetry } from "@backend/db/retry";

export const KNOWN_DISCIPLINE_SLUGS = ["dota2", "counterstrike", "leagueoflegends", "valorant"] as const;
export type KnownDisciplineSlug = (typeof KNOWN_DISCIPLINE_SLUGS)[number];

export function isKnownDisciplineSlug(slug: string): slug is KnownDisciplineSlug {
  return (KNOWN_DISCIPLINE_SLUGS as readonly string[]).includes(slug);
}

export function getKnownDisciplineApiUrl(slug: KnownDisciplineSlug) {
  switch (slug) {
    case "dota2":
      return getLiquipediaDota2ApiUrl();
    case "counterstrike":
      return getLiquipediaCounterStrikeApiUrl();
    case "leagueoflegends":
      return getLiquipediaLolApiUrl();
    case "valorant":
      return getLiquipediaValorantApiUrl();
  }
}

export async function getOrCreateDiscipline(slug: string) {
  const normalizedSlug = slug.trim().toLowerCase();
  
  let name = "";
  let baseApiUrl = "";
  
  switch (normalizedSlug) {
    case "dota2":
      name = "Dota 2";
      baseApiUrl = getLiquipediaDota2ApiUrl();
      break;
    case "counterstrike":
      name = "Counter-Strike";
      baseApiUrl = getLiquipediaCounterStrikeApiUrl();
      break;
    case "leagueoflegends":
      name = "League of Legends";
      baseApiUrl = getLiquipediaLolApiUrl();
      break;
    case "valorant":
      name = "Valorant";
      baseApiUrl = getLiquipediaValorantApiUrl();
      break;
    case "beachvolleyball":
      name = "Beach Volleyball";
      baseApiUrl = "https://en.volleyballworld.com/api/v1/globalschedule";
      break;
    case "tabletennis":
      name = "Table Tennis";
      baseApiUrl = "https://www.worldtabletennis.com/eventslist";
      break;
    default:
      name = slug.charAt(0).toUpperCase() + slug.slice(1);
      baseApiUrl = `https://liquipedia.net/${normalizedSlug}/api.php`;
  }

  return withPrismaConnectionRetry(
    () => prisma.discipline.upsert({
      where: { slug: normalizedSlug },
      update: {
        name,
        baseApiUrl,
        isEnabled: true
      },
      create: {
        slug: normalizedSlug,
        name,
        baseApiUrl,
        isEnabled: true
      }
    }),
    { label: `discipline.upsert(${normalizedSlug})` },
  );
}

export async function getOrCreateDota2Discipline() {
  return getOrCreateDiscipline("dota2");
}

export async function getOrCreateCounterStrikeDiscipline() {
  return getOrCreateDiscipline("counterstrike");
}

export async function getOrCreateLeagueOfLegendsDiscipline() {
  return getOrCreateDiscipline("leagueoflegends");
}

export async function getOrCreateValorantDiscipline() {
  return getOrCreateDiscipline("valorant");
}
