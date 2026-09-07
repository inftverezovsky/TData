import type { Prisma, PrismaClient } from "@prisma/client";
import { computeMatchSetQuality, shouldKeepPreviousMatches } from "@backend/matches/quality";

/**
 * Публикует уже проверенный снимок расписания: удалить старые строки → записать новые.
 * Оба шага входят в одну транзакцию, чтобы сбой вставки сохранил прежнее расписание.
 * Проверка качества выполняется вызывающим импортёром до входа в эту функцию.
 */
export async function replaceTournamentMatchSnapshot(
  client: PrismaClient,
  tournamentId: string,
  matches: Prisma.TournamentMatchCreateManyInput[],
  participants?: Prisma.TournamentParticipantCreateManyInput[],
) {
  await client.$transaction((transaction) => writeTournamentSnapshot(transaction, tournamentId, matches, participants));
}

/** Проверить полный результат всех страниц → сохранить предыдущий либо опубликовать оба набора.
 * Force меняет только способ загрузки: проверка качества обязательна для любого импорта.
 */
export async function publishTournamentSnapshot(
  client: PrismaClient,
  tournamentId: string,
  matches: Prisma.TournamentMatchCreateManyInput[],
  participants: Prisma.TournamentParticipantCreateManyInput[],
  sourceHadError: boolean,
) {
  return client.$transaction(async (transaction) => {
    // Сначала блокируем турнир. Конкурирующий импорт читает предыдущий снимок только после commit владельца.
    await transaction.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
    const previousMatches = await transaction.tournamentMatch.findMany({ where: { tournamentId } });
    const previousParticipantCount = await transaction.tournamentParticipant.count({ where: { tournamentId } });
    const qualityScore = computeMatchSetQuality(matches, previousMatches);
    // У будущего турнира может быть только состав: отсутствие матчей не делает его пустым снимком.
    const rosterOnlyWouldBeLost = previousMatches.length === 0 && previousParticipantCount > 0
      && (participants.length === 0 || (sourceHadError && participants.length < previousParticipantCount));
    const keptPrevious = rosterOnlyWouldBeLost || shouldKeepPreviousMatches({
      newMatches: matches, previousMatches, newQualityScore: qualityScore, sourceHadError,
    });
    if (!keptPrevious) await writeTournamentSnapshot(transaction, tournamentId, matches, participants);
    return { keptPrevious, qualityScore, matches: keptPrevious ? previousMatches : matches };
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}

async function writeTournamentSnapshot(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  matches: Prisma.TournamentMatchCreateManyInput[],
  participants?: Prisma.TournamentParticipantCreateManyInput[],
) {
  await transaction.tournamentMatch.deleteMany({ where: { tournamentId } });
  if (matches.length > 0) {
    await transaction.tournamentMatch.createMany({ data: matches, skipDuplicates: true });
  }
  if (participants !== undefined) {
    await transaction.tournamentParticipant.deleteMany({ where: { tournamentId } });
    if (participants.length > 0) {
      await transaction.tournamentParticipant.createMany({ data: participants, skipDuplicates: true });
    }
  }
}
