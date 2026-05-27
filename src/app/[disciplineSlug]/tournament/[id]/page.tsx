import TournamentWorkspacePage from "@/components/tournament/TournamentWorkspacePage";

export const dynamic = "force-dynamic";

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ disciplineSlug: string; id: string }>;
}) {
  const { disciplineSlug, id } = await params;

  return <TournamentWorkspacePage disciplineSlug={disciplineSlug} id={id} />;
}
