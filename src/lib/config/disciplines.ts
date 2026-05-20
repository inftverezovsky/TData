import { prisma } from "@/lib/db/db";
import { getLiquipediaDota2ApiUrl, getLiquipediaCounterStrikeApiUrl, getLiquipediaLolApiUrl, getLiquipediaValorantApiUrl } from "@/lib/config/env";

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
    default:
      name = slug.charAt(0).toUpperCase() + slug.slice(1);
      baseApiUrl = `https://liquipedia.net/${normalizedSlug}/api.php`;
  }

  return prisma.discipline.upsert({
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
  });
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
