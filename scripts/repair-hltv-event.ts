import type { Prisma } from "@prisma/client";
import { prisma } from "@backend/db/db";
import { mergeTournamentParticipantManualFields } from "@backend/sources/participantPreservation";
import {
  planDltvUploadLogTransfer,
  planTournamentIdentityMerge,
} from "./repair-dltv-identities";
import {
  extractHltvEventId,
  normalizeHltvEventUrl,
  normalizeHltvTournamentTitle,
  saveHltvTournamentMatches,
} from "@backend/sources/tdata/hltv/importTournament";
import { runHltvScript } from "@backend/sources/tdata/hltv/scraper";

const DEFAULT_EVENT_ID = "8249";
const DEFAULT_TITLE = "BLAST Open Porto 2026";
const DEFAULT_URL = "https://www.hltv.org/events/8249/blast-open-porto-2026";

async function main() {
  const args = parseArguments(process.argv.slice(2));

  const eventId = String(args["event-id"] || DEFAULT_EVENT_ID).trim();
  const title = normalizeHltvTournamentTitle(String(args.title || DEFAULT_TITLE));
  const url = normalizeHltvEventUrl(String(args.url || DEFAULT_URL));
  if (!/^\d+$/.test(eventId)) throw new Error("HLTV event id must contain digits only");
  if (extractHltvEventId(url) !== eventId) throw new Error("HLTV URL does not match the requested event id");
  if (!title) throw new Error("HLTV title must not be empty");

  const scrape = await runHltvScript("event", url, { noCache: true });
  const matches = Array.isArray(scrape.matches) ? scrape.matches : [];
  if (!scrape.ok || matches.length === 0 || scrape.stale) {
    throw new Error(`Fresh HLTV validation failed; refusing repair (${scrape.errorClass || scrape.error || "empty result"})`);
  }
  console.log(`Fresh HLTV validation passed with ${matches.length} matches.`);

  const existing = await prisma.tournament.findMany({
    where: {
      disciplineSlug: "counterstrike",
      AND: [
        {
          OR: [
            { sourceUrl: { startsWith: "https://www.hltv.org/events/" } },
            { sourceUrl: { startsWith: "https://hltv.org/events/" } },
          ],
        },
        {
          OR: [
            { sourceUrl: url },
            { sourceUrl: { contains: `/events/${eventId}/` } },
            { sourcePageId: Number(eventId) },
            { sourceTitle: { in: [title, `${title}LAN`] } },
          ],
        },
      ],
    },
    include: { _count: { select: { matches: true, participants: true } } },
    orderBy: { updatedAt: "desc" },
  });

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    eventId,
    title,
    existing: existing.map((tournament) => ({
      id: tournament.id,
      sourceTitle: tournament.sourceTitle,
      matches: tournament._count.matches,
      participants: tournament._count.participants,
    })),
  }, null, 2));

  if (!args.apply) {
    console.log("Dry-run complete. Re-run with --apply --backup-confirmed after a verified database backup.");
    return;
  }
  if (!args["backup-confirmed"]) {
    throw new Error("Refusing to mutate production data without --backup-confirmed");
  }

  const repairResult = await prisma.$transaction(async (tx) => {
    const mergeResult = existing.length > 0
      ? await mergeExistingEventRows({
          rows: existing.map(({ _count, ...tournament }) => tournament),
          title,
          url,
          eventId: Number(eventId),
        }, tx)
      : {
        tournamentId: (await tx.tournament.create({
          data: {
            sourcePageId: Number(eventId),
            sourceTitle: title,
            sourceUrl: url,
            name: title,
            disciplineSlug: "counterstrike",
            status: "ongoing",
            extractionStatus: "PARTIAL",
          },
        })).id,
        manualReviewReasons: [] as string[],
      };

    if (mergeResult.manualReviewReasons.length > 0) {
      return { savedMatches: 0, manualReviewReasons: mergeResult.manualReviewReasons };
    }
    const tournamentId = mergeResult.tournamentId;

    const snapshot = await saveHltvTournamentMatches({
      tournamentId,
      slug: "counterstrike",
      title,
      matches,
      force: true,
      client: tx,
      preserveExistingParticipants: true,
    });
    if (snapshot.savedCount === 0) throw new Error("Validated HLTV snapshot produced no persistable matches");

    await tx.tournament.update({
      where: { id: tournamentId },
      data: {
        sourcePageId: Number(eventId),
        sourceTitle: title,
        sourceUrl: url,
        name: title,
        extractionStatus: "SUCCESS",
      },
    });
    return { savedMatches: snapshot.savedCount, manualReviewReasons: [] as string[] };
  }, {
    isolationLevel: "Serializable",
    maxWait: 10_000,
    timeout: 120_000,
  });

  if (repairResult.manualReviewReasons.length > 0) {
    throw new Error(
      `HLTV repair requires manual review; no duplicates were deleted: ${repairResult.manualReviewReasons.join("; ")}`,
    );
  }

  console.log(`HLTV event ${eventId} repaired: ${repairResult.savedMatches} matches, title "${title}".`);
}

function parseArguments(values: readonly string[]) {
  const strings = new Map<string, string>();
  const booleans = new Set<string>();
  const booleanNames = new Set(["apply", "backup-confirmed"]);
  const stringNames = new Set(["event-id", "title", "url"]);

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const match = value.match(/^--([^=]+)(?:=(.*))?$/s);
    if (!match) throw new Error(`Unknown argument: ${value}`);
    const [, name, inlineValue] = match;
    if (booleanNames.has(name)) {
      if (inlineValue !== undefined) throw new Error(`--${name} does not accept a value`);
      booleans.add(name);
      continue;
    }
    if (!stringNames.has(name)) throw new Error(`Unknown argument: --${name}`);
    const nextValue = inlineValue ?? values[index + 1];
    if (!nextValue || (inlineValue === undefined && nextValue.startsWith("--"))) {
      throw new Error(`--${name} requires a value`);
    }
    strings.set(name, nextValue);
    if (inlineValue === undefined) index += 1;
  }

  return {
    apply: booleans.has("apply"),
    "backup-confirmed": booleans.has("backup-confirmed"),
    "event-id": strings.get("event-id") ?? DEFAULT_EVENT_ID,
    title: strings.get("title") ?? DEFAULT_TITLE,
    url: strings.get("url") ?? DEFAULT_URL,
  };
}

async function mergeExistingEventRows(input: {
  rows: Array<{ id: string; sourceTitle: string; updatedAt: Date; platformId: string | null }>;
  title: string;
  url: string;
  eventId: number;
}, tx: Prisma.TransactionClient) {
  const rowIds = input.rows.map((row) => row.id);
  const currentRows = await tx.tournament.findMany({
    where: { id: { in: rowIds } },
    select: { id: true, sourceTitle: true, updatedAt: true, platformId: true },
    orderBy: { updatedAt: "desc" },
  });
  const canonical = currentRows.find((row) => row.sourceTitle === input.title) ?? currentRows[0];
  if (!canonical) throw new Error("HLTV repair candidates disappeared before the transaction started");
  const duplicateIds = currentRows.filter((row) => row.id !== canonical.id).map((row) => row.id);
  const mappings = await tx.tournamentAdminMapping.findMany({
    where: { tournamentId: { in: currentRows.map((row) => row.id) } },
    orderBy: { updatedAt: "desc" },
  });
  const identityPlan = planTournamentIdentityMerge({
    tournaments: currentRows.map((row) => ({ id: row.id, platformId: row.platformId })),
    mappings,
    primaryId: canonical.id,
    disciplineSlug: "counterstrike",
    sourceTournamentId: input.url,
    sourceTournamentName: input.title,
  });
  if (identityPlan.manualReviewReasons.length > 0) {
    await tx.tournament.updateMany({
      where: { id: { in: currentRows.map((row) => row.id) } },
      data: { extractionStatus: "MANUAL_REVIEW" },
    });
    return { tournamentId: canonical.id, manualReviewReasons: identityPlan.manualReviewReasons };
  }

  if (duplicateIds.length > 0) {
      const participants = await tx.tournamentParticipant.findMany({
        where: { tournamentId: { in: currentRows.map((row) => row.id) } },
        orderBy: { createdAt: "asc" },
      });
      const uniqueParticipants = new Map<string, (typeof participants)[number]>();
      for (const participant of participants) {
        const key = participant.name.trim().toLocaleLowerCase("en-US");
        const previous = uniqueParticipants.get(key);
        if (!previous) {
          uniqueParticipants.set(key, participant);
          continue;
        }
        const preferred = !previous.platformId && participant.platformId ? participant : previous;
        const supplemental = preferred.id === previous.id ? participant : previous;
        uniqueParticipants.set(key, {
          ...preferred,
          ...mergeTournamentParticipantManualFields({
            existing: preferred,
            incoming: supplemental,
          }),
        });
      }

      await tx.tournamentMatch.updateMany({
        where: { tournamentId: { in: duplicateIds } },
        data: { tournamentId: canonical.id },
      });
      await tx.tournamentParticipant.deleteMany({
        where: { tournamentId: { in: currentRows.map((row) => row.id) } },
      });
      if (uniqueParticipants.size > 0) {
        await tx.tournamentParticipant.createMany({
          data: Array.from(uniqueParticipants.values()).map((participant) => ({
            tournamentId: canonical.id,
            name: participant.name,
            platformId: participant.platformId,
            seed: participant.seed,
            region: participant.region,
            status: participant.status,
            logoUrl: participant.logoUrl,
            rawText: participant.rawText,
          })),
        });
      }

      if (identityPlan.adminMapping) {
        if (identityPlan.adminMapping.obsoleteIds.length > 0) {
          await tx.tournamentAdminMapping.deleteMany({
            where: { id: { in: identityPlan.adminMapping.obsoleteIds } },
          });
        }
        await tx.tournamentAdminMapping.update({
          where: { id: identityPlan.adminMapping.selectedId },
          data: {
            tournamentId: identityPlan.adminMapping.tournamentId,
            disciplineSlug: identityPlan.adminMapping.disciplineSlug,
            sourceTournamentId: identityPlan.adminMapping.sourceTournamentId,
            sourceTournamentName: identityPlan.adminMapping.sourceTournamentName,
            adminShapkaId: identityPlan.adminMapping.adminShapkaId,
            adminShapkaName: identityPlan.adminMapping.adminShapkaName,
          },
        });
      }

      const uploadLogs = await tx.adminUploadLog.findMany({
        where: { tournamentId: { in: currentRows.map((row) => row.id) } },
        select: {
          id: true,
          tournamentId: true,
          disciplineSlug: true,
          payloadHash: true,
          status: true,
          createdAt: true,
        },
      });
      const uploadPlan = planDltvUploadLogTransfer(uploadLogs, canonical.id);
      if (uploadPlan.deleteIds.length > 0) {
        await tx.adminUploadLog.deleteMany({ where: { id: { in: uploadPlan.deleteIds } } });
      }
      if (uploadPlan.moveIds.length > 0) {
        await tx.adminUploadLog.updateMany({
          where: { id: { in: uploadPlan.moveIds } },
          data: { tournamentId: canonical.id },
        });
      }
      await tx.tournament.deleteMany({ where: { id: { in: duplicateIds } } });
  }

  await tx.tournament.update({
    where: { id: canonical.id },
    data: {
      sourcePageId: input.eventId,
      sourceTitle: input.title,
      name: input.title,
      sourceUrl: input.url,
      platformId: identityPlan.platformId,
    },
  });
  return { tournamentId: canonical.id, manualReviewReasons: [] as string[] };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
