import { KhlBindingStatus, KhlStatScope } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import { KHL_TEAM_STAT_CODES } from "@backend/results/khl/adminPayload";
import {
  KhlTargetBindingError,
  confirmKhlResultTargets,
  type ConfirmKhlResultTargetsInput,
} from "@backend/results/khl/targetBindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("khlGameId");
  const khlGameId = raw && /^[1-9]\d{0,127}$/.test(raw) ? raw : null;
  if (!khlGameId) {
    return NextResponse.json({ error: "khlGameId must be a positive decimal string." }, { status: 400 });
  }
  const match = await prisma.khlMatch.findUnique({
    where: { khlGameId },
    include: {
      homeTeam: { include: { teamStatBindings: { include: { statMapping: true } } } },
      awayTeam: { include: { teamStatBindings: { include: { statMapping: true } } } },
      participants: {
        where: { isListed: true },
        include: {
          player: true,
          playerStatTargets: { include: { statMapping: true } },
        },
        orderBy: [{ teamId: "asc" }, { shirtNumber: "asc" }],
      },
    },
  });
  if (!match) return NextResponse.json({ error: "KHL match was not ingested." }, { status: 404 });

  const statMappings = await prisma.khlStatMapping.findMany();
  const statTypeId = (scope: KhlStatScope, code: string) => {
    const mapping = statMappings.find((candidate) => (
      candidate.scope === scope && candidate.semanticCode === code
    ));
    return confirmedValue(mapping?.adminBindingStatus, mapping?.adminStatTypeId);
  };
  const teamStats = (bindings: typeof match.homeTeam.teamStatBindings) => Object.fromEntries(
    KHL_TEAM_STAT_CODES.map((code) => {
      const target = bindings.find((candidate) => candidate.statMapping.semanticCode === code);
      return [code, {
        adminMatchStatId: confirmedValue(
          target?.adminBindingStatus,
          target?.adminTeamStatId
        ),
      }];
    })
  );
  const playerCodes = ["goals", "assists", "points"] as const;
  return NextResponse.json({
    labels: {
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      players: Object.fromEntries(
        match.participants.map((participant) => [
          String(participant.player.khlPlayerId),
          participant.player.name,
        ])
      ),
      playerBindings: Object.fromEntries(
        match.participants.map((participant) => [
          String(participant.player.khlPlayerId),
          {
            player: participant.player.adminBindingStatus,
            matchPlayer: participant.adminBindingStatus,
          },
        ])
      ),
    },
    template: {
      khlGameId,
      teamStatTypes: Object.fromEntries(
        KHL_TEAM_STAT_CODES.map((code) => [code, statTypeId(KhlStatScope.TEAM, code)])
      ),
      playerStatTypes: Object.fromEntries(
        playerCodes.map((code) => [code, statTypeId(KhlStatScope.PLAYER, code)])
      ),
      teams: {
        home: { stats: teamStats(match.homeTeam.teamStatBindings) },
        away: { stats: teamStats(match.awayTeam.teamStatBindings) },
      },
      players: match.participants.map((participant) => ({
        khlPlayerId: participant.player.khlPlayerId,
        adminPlayerId: confirmedValue(
          participant.player.adminBindingStatus,
          participant.player.adminPlayerId
        ),
        adminMatchPlayerId: confirmedValue(
          participant.adminBindingStatus,
          participant.adminMatchPlayerId
        ),
        stats: Object.fromEntries(playerCodes.map((code) => {
          const target = participant.playerStatTargets.find(
            (candidate) => candidate.statMapping.semanticCode === code
          );
          return [code, confirmedValue(
            target?.adminBindingStatus,
            target?.adminPlayerStatId
          )];
        })),
      })),
    },
  });
}

function confirmedValue(
  status: KhlBindingStatus | undefined,
  value: string | null | undefined
) {
  return status === KhlBindingStatus.CONFIRMED ? value || "" : "";
}

export async function POST(request: Request) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  try {
    const result = await confirmKhlResultTargets(prisma, {
      ...(body as Omit<ConfirmKhlResultTargetsInput, "confirmedBy">),
      confirmedBy: "admin-session",
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof KhlTargetBindingError) {
      const status = error.code === "MATCH_NOT_FOUND"
        ? 404
        : error.code === "INVALID_TARGET_BINDINGS" ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[KHL target bindings]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to confirm KHL target bindings." }, { status: 500 });
  }
}
