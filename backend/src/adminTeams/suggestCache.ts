import { prisma } from "@backend/db/db";

const ADMIN_TEAM_SUGGEST_CACHE_TTL_MS = 30 * 60 * 1000;

type AdminTeamSuggestSource = Awaited<ReturnType<typeof loadAdminTeamsFromDatabase>>;

const adminTeamCache = new Map<string, {
  expiresAt: number;
  items: AdminTeamSuggestSource;
  pending?: Promise<AdminTeamSuggestSource>;
}>();

export async function getCachedAdminTeamsForSuggest(disciplineSlug: string) {
  const now = Date.now();
  const cached = adminTeamCache.get(disciplineSlug);
  if (cached && cached.expiresAt > now) {
    if (cached.pending) return cached.pending;
    return cached.items;
  }

  const pending = loadAdminTeamsFromDatabase(disciplineSlug);
  adminTeamCache.set(disciplineSlug, {
    expiresAt: now + ADMIN_TEAM_SUGGEST_CACHE_TTL_MS,
    items: cached?.items || [],
    pending,
  });

  try {
    const items = await pending;
    adminTeamCache.set(disciplineSlug, {
      expiresAt: Date.now() + ADMIN_TEAM_SUGGEST_CACHE_TTL_MS,
      items,
    });
    return items;
  } catch (error) {
    if (cached?.items.length) {
      adminTeamCache.set(disciplineSlug, {
        expiresAt: Date.now() + 15_000,
        items: cached.items,
      });
    } else {
      adminTeamCache.delete(disciplineSlug);
    }
    throw error;
  }
}

export function invalidateAdminTeamSuggestCache(disciplineSlug?: string | null) {
  const slug = String(disciplineSlug || "").trim().toLowerCase();
  if (slug) {
    adminTeamCache.delete(slug);
    return;
  }
  adminTeamCache.clear();
}

function loadAdminTeamsFromDatabase(disciplineSlug: string) {
  return prisma.adminTeam.findMany({
    where: { disciplineSlug },
    select: {
      platformId: true,
      platformName: true,
      platformNameRu: true,
      platformNameEn: true,
      normalizedName: true,
      normalizedNameRu: true,
      normalizedNameEn: true,
    },
    orderBy: { platformName: "asc" },
  });
}
