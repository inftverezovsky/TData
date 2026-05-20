import { getOrCreateDiscipline } from "@/lib/config/disciplines";
import { createSearchTournamentPostRoute } from "@/lib/liquipedia/searchRoute";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disciplineSlug: string }> }
) {
  const { disciplineSlug } = await params;
  const slug = disciplineSlug.trim().toLowerCase();

  const routeHandler = createSearchTournamentPostRoute({
    disciplineSlug: slug,
    getDiscipline: () => getOrCreateDiscipline(slug),
    defaultApiUrl: `https://liquipedia.net/${slug}/api.php`,
  });

  return routeHandler(request);
}
