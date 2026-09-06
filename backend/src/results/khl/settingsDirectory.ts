import {
  KhlBindingStatus,
  KhlStatScope,
  type PrismaClient,
} from "@prisma/client";

import { KHL_TEAM_STAT_CODES } from "@backend/results/khl/adminPayload";
import { KHL_RESULTS_CUTOFF } from "@backend/results/khl/autoSync";
import { KHL_PLAYER_STAT_CODES } from "@backend/results/khl/targetBindings";
import {
  formatKhlPlayerExtraLabel,
  KHL_PLAYER_EXTRA_DEFINITIONS,
} from "@backend/results/khl/playerExtras";

export const KHL_SETTINGS_CUTOFF = KHL_RESULTS_CUTOFF;

export async function getKhlSettingsDirectory(prisma: PrismaClient) {
  const [teams, players, storedMappings] = await Promise.all([
    prisma.khlTeam.findMany({
      where: {
        OR: [
          { homeMatches: { some: { startsAt: { gte: KHL_SETTINGS_CUTOFF } } } },
          { awayMatches: { some: { startsAt: { gte: KHL_SETTINGS_CUTOFF } } } },
        ],
      },
      select: {
        khlTeamId: true,
        name: true,
        location: true,
        adminTeamId: true,
        adminBindingStatus: true,
        adminConfirmedAt: true,
        adminConfirmedBy: true,
        teamStatBindings: {
          select: {
            adminTeamStatId: true,
            adminBindingStatus: true,
            adminConfirmedAt: true,
            adminConfirmedBy: true,
            statMapping: { select: { semanticCode: true } },
          },
        },
        _count: {
          select: {
            homeMatches: { where: { startsAt: { gte: KHL_SETTINGS_CUTOFF } } },
            awayMatches: { where: { startsAt: { gte: KHL_SETTINGS_CUTOFF } } },
          },
        },
      },
      orderBy: [{ name: "asc" }, { khlTeamId: "asc" }],
    }),
    prisma.khlPlayer.findMany({
      where: {
        participants: {
          some: {
            isListed: true,
            match: { startsAt: { gte: KHL_SETTINGS_CUTOFF } },
          },
        },
      },
      select: {
        khlPlayerId: true,
        name: true,
        role: true,
        adminPlayerId: true,
        adminBindingStatus: true,
        adminConfirmedAt: true,
        adminConfirmedBy: true,
        extraBindings: {
          select: {
            extraCode: true,
            adminExtraId: true,
            adminExtraName: true,
            adminBindingStatus: true,
            adminConfirmedAt: true,
            adminConfirmedBy: true,
          },
        },
        _count: {
          select: {
            participants: {
              where: {
                isListed: true,
                match: { startsAt: { gte: KHL_SETTINGS_CUTOFF } },
              },
            },
          },
        },
        participants: {
          where: {
            isListed: true,
            match: { startsAt: { gte: KHL_SETTINGS_CUTOFF } },
          },
          select: {
            adminMatchPlayerId: true,
            adminBindingStatus: true,
            team: { select: { khlTeamId: true, name: true } },
            match: { select: { khlGameId: true, startsAt: true } },
          },
          orderBy: [{ match: { startsAt: "desc" } }, { match: { khlGameId: "desc" } }],
          take: 1,
        },
      },
      orderBy: [{ name: "asc" }, { khlPlayerId: "asc" }],
    }),
    prisma.khlStatMapping.findMany({
      where: {
        OR: [
          { scope: KhlStatScope.TEAM, semanticCode: { in: [...KHL_TEAM_STAT_CODES] } },
          { scope: KhlStatScope.PLAYER, semanticCode: { in: [...KHL_PLAYER_STAT_CODES] } },
        ],
      },
      select: {
        scope: true,
        semanticCode: true,
        adminStatTypeId: true,
        adminBindingStatus: true,
        adminConfirmedAt: true,
        adminConfirmedBy: true,
      },
    }),
  ]);

  const mappingByKey = new Map(
    storedMappings.map((mapping) => [`${mapping.scope}:${mapping.semanticCode}`, mapping])
  );
  const statMappings = [
    ...KHL_TEAM_STAT_CODES.map((semanticCode) => mappingEntry(
      KhlStatScope.TEAM,
      semanticCode,
      mappingByKey.get(`${KhlStatScope.TEAM}:${semanticCode}`)
    )),
    ...KHL_PLAYER_STAT_CODES.map((semanticCode) => mappingEntry(
      KhlStatScope.PLAYER,
      semanticCode,
      mappingByKey.get(`${KhlStatScope.PLAYER}:${semanticCode}`)
    )),
  ];

  return {
    cutoff: KHL_SETTINGS_CUTOFF.toISOString(),
    teams: teams.map(({ _count, teamStatBindings, ...team }) => ({
      ...team,
      adminConfirmedAt: isoDate(team.adminConfirmedAt),
      matchCount: _count.homeMatches + _count.awayMatches,
      statBindings: KHL_TEAM_STAT_CODES.map((semanticCode) => {
        const stored = teamStatBindings.find(
          (binding) => binding.statMapping.semanticCode === semanticCode
        );
        return {
          semanticCode,
          adminTeamStatId: stored?.adminTeamStatId ?? null,
          adminBindingStatus: stored?.adminBindingStatus ?? KhlBindingStatus.UNMAPPED,
          adminConfirmedAt: isoDate(stored?.adminConfirmedAt ?? null),
          adminConfirmedBy: stored?.adminConfirmedBy ?? null,
        };
      }),
    })),
    players: players.map(({ _count, participants, extraBindings, ...player }) => {
      const participant = participants[0];
      return {
        ...player,
        adminConfirmedAt: isoDate(player.adminConfirmedAt),
        matchCount: _count.participants,
        extraBindings: KHL_PLAYER_EXTRA_DEFINITIONS.map((definition) => {
          const stored = extraBindings.find((binding) => binding.extraCode === definition.code);
          return {
            extraCode: definition.code,
            label: formatKhlPlayerExtraLabel(player.name, definition.code),
            adminExtraId: stored?.adminExtraId ?? null,
            adminExtraName: stored?.adminExtraName ?? null,
            adminBindingStatus: stored?.adminBindingStatus ?? KhlBindingStatus.UNMAPPED,
            adminConfirmedAt: isoDate(stored?.adminConfirmedAt ?? null),
            adminConfirmedBy: stored?.adminConfirmedBy ?? null,
          };
        }),
        recentAppearance: participant ? {
          khlGameId: participant.match.khlGameId,
          startsAt: participant.match.startsAt.toISOString(),
          team: participant.team,
          adminMatchPlayerId: participant.adminMatchPlayerId,
          adminBindingStatus: participant.adminBindingStatus,
        } : null,
      };
    }),
    statMappings,
  };
}

type StoredMapping = {
  adminStatTypeId: string | null;
  adminBindingStatus: KhlBindingStatus;
  adminConfirmedAt: Date | null;
  adminConfirmedBy: string | null;
};

function mappingEntry(
  scope: KhlStatScope,
  semanticCode: string,
  stored: StoredMapping | undefined
) {
  return {
    scope,
    semanticCode,
    adminStatTypeId: stored?.adminStatTypeId ?? null,
    adminBindingStatus: stored?.adminBindingStatus ?? KhlBindingStatus.UNMAPPED,
    adminConfirmedAt: isoDate(stored?.adminConfirmedAt ?? null),
    adminConfirmedBy: stored?.adminConfirmedBy ?? null,
  };
}

function isoDate(value: Date | null) {
  return value?.toISOString() ?? null;
}
