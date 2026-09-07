import type { Prisma } from "@prisma/client";

export function mergeParticipantCandidates(candidates: readonly Prisma.TournamentParticipantCreateManyInput[]) {
  // Главная страница идёт первой. Подстраницы добавляют новых участников, не стирая её seed, регион и логотип.
  const participants = new Map<string | undefined, Prisma.TournamentParticipantCreateManyInput>();
  for (const participant of candidates) {
    if (!participants.has(participant.id)) participants.set(participant.id, participant);
  }
  return [...participants.values()];
}
