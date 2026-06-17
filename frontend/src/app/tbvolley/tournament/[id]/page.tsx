import TournamentWorkspacePage from "@/components/tournament/TournamentWorkspacePage";

export const dynamic = "force-dynamic";

export default async function TBvolleyTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <TournamentWorkspacePage
      disciplineSlug="beachvolleyball"
      id={id}
      refreshTargetBasePath="/tbvolley/tournament"
    />
  );
}
