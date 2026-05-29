import { notFound } from "next/navigation";
import LoadTournamentButton from "@/components/ui/LoadTournamentButton";
import StatusBadge from "@/components/ui/StatusBadge";
import TeamMappingPanel from "@/components/tournament/TeamMappingPanel";
import TournamentAdminView from "@/components/tournament/TournamentAdminView";
import TBvolleyGenderSwitcher from "@/components/tbvolley/TBvolleyGenderSwitcher";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";
import { prisma } from "@/lib/db/db";

import { formatDateTime } from "@/lib/utils/format";
import { dedupeTournamentMatches } from "@/lib/matches/dedupe";
import { getTeamAliasKey, getTeamMappingLookupKeys } from "@/lib/teams/canonicalize";
import { buildTeamMappingLookup, findTeamMapping } from "@/lib/teams/mappingLookup";
import { buildAdminTeamDisplayLookup, resolveTeamMappingDisplay } from "@/lib/teams/mappingDisplay";
import { normalizeTeamName } from "@/lib/teams/teams";
import { collectTournamentTeamNames } from "@/lib/teams/tournamentTeamNames";
import { detectTournamentSource, getTournamentSourceLabel, isBeachVolleyballTournamentSource } from "@/lib/utils/tournamentSource";
import { resolveAdminSettings } from "@/lib/adminUpload/resolveAdminSettings";
import {
  normalizeBeachVolleyballGender,
  readBeachVolleyballGenderFromNormalization,
  resolveTournamentTeamMappingDisciplineSlug,
} from "@/lib/sources/tbvolley/config";

export default async function TournamentWorkspacePage({
  disciplineSlug,
  id,
  refreshTargetBasePath,
}: {
  disciplineSlug: string;
  id: string;
  refreshTargetBasePath?: string;
}) {
  const slug = disciplineSlug.trim().toLowerCase();

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
      matches: { orderBy: [{ matchDate: "asc" }, { createdAt: "asc" }] },
      lastImport: {
        select: { finishedAt: true },
      },
    },
  });

  if (!tournament) {
    notFound();
    return null;
  }

  const discipline = await prisma.discipline.findUnique({
    where: { slug },
  });

  const dedupedMatches = dedupeTournamentMatches(tournament.matches);
  const tournamentForView = { ...tournament, matches: dedupedMatches };
  const source = detectTournamentSource(tournament.sourceUrl);
  const teamMappingDisciplineSlug = resolveTournamentTeamMappingDisciplineSlug(slug, tournament.normalization);

  const teamNames = collectTournamentTeamNames({
    matches: dedupedMatches,
    participants: tournament.participants,
    disciplineSlug: slug,
    source,
  });
  const mappings = await prisma.teamMapping.findMany({
    where: {
      disciplineSlug: teamMappingDisciplineSlug,
      OR: [
        { liquipediaName: { in: teamNames } },
        { platformId: { not: null } },
      ],
    },
  });
  const mappedPlatformIds = Array.from(new Set(mappings.map((mapping) => mapping.platformId).filter(Boolean) as string[]));
  const adminTeams = mappedPlatformIds.length > 0
    ? await prisma.adminTeam.findMany({
        where: {
          disciplineSlug: teamMappingDisciplineSlug,
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
      adminTeamLookup,
    ),
    status: mapping.status,
  }));

  const mappingMap: Record<string, { alias: string | null; platformId: string | null; logoUrl: string | null; countryCode?: string | null }> = {};
  const mappingLookup = buildTeamMappingLookup(displayMappings);
  const participantDisplayLookup = buildParticipantDisplayLookup(tournament.participants);
  for (const teamName of teamNames) {
    const m = findTeamMapping(mappingLookup, teamName);
    const participantInfo = findParticipantDisplayInfo(participantDisplayLookup, teamName);
    if (!m && !participantInfo) continue;

    const mapping = {
      alias: m?.alias || null,
      platformId: m?.platformId || null,
      logoUrl: m?.logoUrl || participantInfo?.logoUrl || null,
      countryCode: participantInfo?.countryCode || null,
    };
    const keys = new Set([
      teamName,
      teamName.toLowerCase(),
      normalizeTeamName(teamName),
      getTeamAliasKey(teamName),
      ...(m ? getTeamMappingLookupKeys(m) : []),
    ]);
    for (const key of keys) {
      if (key && !mappingMap[key]) mappingMap[key] = mapping;
    }
  }

  const disciplineName = discipline?.name || slug.charAt(0).toUpperCase() + slug.slice(1);
  const adminSettings = await resolveAdminSettings(slug);
  const refreshExtraPayload = getRefreshExtraPayload(tournament.normalization);
  const tbvolleyGender = normalizeBeachVolleyballGender(readBeachVolleyballGenderFromNormalization(tournament.normalization));
  const showTbvolleyGenderSwitcher = slug === "beachvolleyball"
    && isBeachVolleyballTournamentSource(source)
    && Boolean(tbvolleyGender)
    && (source === "volleyballworld" || source === "beachvolleyru" || source === "germanbeachtour");

  return (
    <div className="space-y-6">
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
              targetBasePath={refreshTargetBasePath}
              extraPayload={refreshExtraPayload}
            />
          </div>
        </div>
      </section>

      {showTbvolleyGenderSwitcher && tbvolleyGender ? (
        <TBvolleyGenderSwitcher
          currentGender={tbvolleyGender}
          currentTournamentId={tournament.id}
          disciplineSlug={slug}
          targetBasePath={refreshTargetBasePath}
        />
      ) : null}

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
              <TeamMappingPanel teamNames={teamNames} initialMappings={displayMappings} disciplineSlug={teamMappingDisciplineSlug} />
            </ClientErrorBoundary>
          </div>
        </details>
      </section>
    </div>
  );
}

function getRefreshExtraPayload(normalization: unknown): Record<string, unknown> | undefined {
  const root = asRecord(normalization);
  const volleyballWorld = asRecord(root?.volleyballWorld);
  if (volleyballWorld) {
    return {
      tournamentNo: volleyballWorld.tournamentNo,
      gender: volleyballWorld.gender,
      fromDate: volleyballWorld.fromDate,
      toDate: volleyballWorld.toDate,
    };
  }

  const beachVolleyRu = asRecord(root?.beachVolleyRu);
  if (beachVolleyRu) {
    return {
      eventId: beachVolleyRu.eventId,
      gender: beachVolleyRu.gender,
    };
  }

  const germanBeachTour = asRecord(root?.germanBeachTour);
  if (germanBeachTour) {
    return {
      tournamentId: germanBeachTour.tournamentId,
      gender: germanBeachTour.gender,
    };
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function buildParticipantDisplayLookup(
  participants: Array<{ name: string | null; logoUrl?: string | null; rawText?: string | null }>,
) {
  const lookup = new Map<string, { countryCode: string | null; logoUrl: string | null }>();

  for (const participant of participants) {
    const name = String(participant.name || "").trim();
    if (!name) continue;

    const info = {
      countryCode: extractCountryCode(participant.rawText),
      logoUrl: participant.logoUrl || null,
    };
    if (!info.countryCode && !info.logoUrl) continue;

    for (const key of getDisplayLookupKeys(name)) {
      if (key && !lookup.has(key)) lookup.set(key, info);
    }
  }

  return lookup;
}

function findParticipantDisplayInfo(
  lookup: Map<string, { countryCode: string | null; logoUrl: string | null }>,
  name: string,
) {
  for (const key of getDisplayLookupKeys(name)) {
    const info = lookup.get(key);
    if (info) return info;
  }
  return null;
}

function getDisplayLookupKeys(name: string) {
  return [
    name,
    name.toLowerCase(),
    normalizeTeamName(name),
    getTeamAliasKey(name),
  ].filter(Boolean);
}

function extractCountryCode(rawText: string | null | undefined) {
  const match = String(rawText || "").match(/(?:^|;\s*)code=([^;]+)/i);
  const code = String(match?.[1] || "").trim().toUpperCase();
  return /^[A-Z0-9]{2,4}$/.test(code) ? code : null;
}
