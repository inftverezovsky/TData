import TournamentWorkspacePage from "@/components/tournament/TournamentWorkspacePage";

export const dynamic = "force-dynamic";

export default async function TableTTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <TournamentWorkspacePage
      disciplineSlug="tabletennis"
      id={id}
      refreshTargetBasePath="/tablet/tournament"
    />
  );
}
