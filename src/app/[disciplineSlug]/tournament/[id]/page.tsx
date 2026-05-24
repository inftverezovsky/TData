import { notFound } from "next/navigation";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import StatusBadge from "@/components/ui/StatusBadge";
import TeamMappingPanel from "@/components/tournament/TeamMappingPanel";
import TournamentAdminView from "@/components/tournament/TournamentAdminView";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";
import { prisma } from "@/lib/db/db";

import { formatDateTime } from "@/lib/utils/format";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getTeamAliasKey, getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { buildTeamMappingLookup, findTeamMapping } from "@/lib/teams/mappingLookup";
import { buildAdminTeamDisplayLookup, resolveTeamMappingDisplay } from "@/lib/teams/mappingDisplay";
import { normalizeTeamName } from "@/lib/teams/teams";
import { collectTournamentTeamNames } from "@/lib/teams/tournamentTeamNames";
import { detectTournamentSource, getTournamentSourceLabel } from "@/lib/utils/tournamentSource";
import { resolveAdminSettings } from "@/lib/adminUpload/resolveAdminSettings";

export const dynamic = "force-dynamic";

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ disciplineSlug: string; id: string }>;
}) {
  const { disciplineSlug, id } = await params;
  const slug = disciplineSlug.trim().toLowerCase();

  const tournament = await prisma.tournament.findUnique({
    where: { id: id },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
      matches: { orderBy: [{ matchDate: "asc" }, { createdAt: "asc" }] },
      lastImport: {
        select: { finishedAt: true }
      }
    }
  });

  if (!tournament) {
    notFound();
    return null;
  }

  const discipline = await prisma.discipline.findUnique({
    where: { slug }
  });

  const dedupedMatches = dedupeTournamentMatches(tournament.matches);
  const tournamentForView = { ...tournament, matches: dedupedMatches };
  const source = detectTournamentSource(tournament.sourceUrl);

  const teamNames = collectTournamentTeamNames({
    matches: dedupedMatches,
    participants: tournament.participants,
    disciplineSlug: slug,
    source,
  });
  const mappings = await prisma.teamMapping.findMany({
    where: {
      disciplineSlug: slug,
      OR: [
        { liquipediaName: { in: teamNames } },
        { platformId: { not: null } },
      ],
    }
  });
  const mappedPlatformIds = Array.from(new Set(mappings.map((mapping) => mapping.platformId).filter(Boolean) as string[]));
  const adminTeams = mappedPlatformIds.length > 0
    ? await prisma.adminTeam.findMany({
        where: {
          disciplineSlug: slug,
          platformId: { in: mappedPlatformIds },
        },
        select: { platformId: true, platformName: true },
      })
    : [];
  const adminTeamLookup = buildAdminTeamDisplayLookup(adminTeams);
  const displayMappings = mappings.map((mapping) => ({
    ...mapping,
    ...resolveTeamMappingDisplay(
      {
        liquipediaName: mapping.liquipediaName,
        canonicalName: mapping.canonicalName,
        platformId: mapping.platformId,
        status: mapping.status,
      },
      adminTeamLookup
    ),
    status: mapping.status,
  }));

  const mappingMap: Record<string, { alias: string | null; platformId: string | null; logoUrl: string | null }> = {};
  const mappingLookup = buildTeamMappingLookup(displayMappings);
  for (const teamName of teamNames) {
    const m = findTeamMapping(mappingLookup, teamName);
    if (!m) continue;

    const mapping = { 
      alias: m.alias, 
      platformId: m.platformId,
      logoUrl: m.logoUrl 
    };
    const keys = new Set([
      teamName,
      teamName.toLowerCase(),
      normalizeTeamName(teamName),
      getTeamAliasKey(teamName),
      ...getTeamMappingLookupKeys(m),
    ]);
    for (const key of keys) {
      if (key && !mappingMap[key]) mappingMap[key] = mapping;
    }
  }

  const disciplineName = discipline?.name || slug.charAt(0).toUpperCase() + slug.slice(1);
  const adminSettings = await resolveAdminSettings(slug);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-slate-400">{disciplineName}</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-950">{tournament.name}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <StatusBadge status={tournament.extractionStatus} />
              <div className="h-1 w-1 rounded-full bg-slate-300" />
              <a href={tournament.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-slate-600 hover:text-slate-950 transition underline underline-offset-4 decoration-slate-200 hover:decoration-slate-950">
                {getTournamentSourceLabel(source)}
              </a>
              {tournament.lastImport?.finishedAt ? (
                <>
                  <div className="h-1 w-1 rounded-full bg-slate-300" />
                  <span className="text-sm font-medium text-slate-500">Обновлено: {formatDateTime(tournament.lastImport.finishedAt)}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 gap-3">
            <LoadTournamentButton 
              pageId={tournament.sourcePageId} 
              title={tournament.sourceTitle} 
              pageUrl={tournament.sourceUrl} 
              disciplineSlug={slug} 
              initialTournamentId={tournament.id}
              force={true}
              source={source}
            />
          </div>
        </div>
      </section>

      <TournamentAdminView 
        tournament={tournamentForView} 
        mappingMap={mappingMap} 
        disciplineSlug={slug} 
        source={source}
        adminSettings={{
          apiUrl: adminSettings.apiUrl || "",
          adminSportId: adminSettings.adminSportId || "",
          adminMax: adminSettings.adminMax,
          defaultShapkaId: adminSettings.defaultShapkaId || "",
          timezone: adminSettings.timezone,
          dateFormat: adminSettings.dateFormat,
          requestMode: adminSettings.requestMode,
        }}
      />

      {/* Advanced Settings: Team Mapping */}
      <section className="rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200">
        <details className="group">
          <summary className="flex cursor-pointer items-center justify-between list-none">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-950">Маппинг команд</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">Привяжите команды к вашей платформе. Эти настройки сохраняются навсегда для всех турниров.</p>
            </div>
            <div className="rounded-full bg-slate-100 p-2 group-open:rotate-180 transition-transform">
              <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
          </summary>
          <div className="mt-8 border-t border-slate-100 pt-8">
            <ClientErrorBoundary title="Маппинг команд временно недоступен">
              <TeamMappingPanel teamNames={teamNames} initialMappings={displayMappings} disciplineSlug={slug} />
            </ClientErrorBoundary>
          </div>
        </details>
      </section>

    </div>
  );
}
