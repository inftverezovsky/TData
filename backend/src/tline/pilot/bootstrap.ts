import type { PrismaClient } from "@prisma/client";

import { DEFAULT_TLINE_SLOT_HOURS, DEFAULT_TLINE_TIMEZONE } from "../scheduler/slots";
import { VOLLEY_RU_PROVIDER } from "../sources/volleyRu";

export const TLINE_VOLLEYBALL_PILOT_CHAMPIONSHIPS = Object.freeze([
  Object.freeze({
    name: "Волейбол. Россия. Высшая лига А. Женщины",
    season: "2026/27",
    sourceProvider: VOLLEY_RU_PROVIDER,
    sourceChampionshipId: "01KYPZAKJB0SMM0D6TGV3W0Y85",
    sourceUrl: "https://volley.ru/calendar/01KYPZAKJB0SMM0D6TGV3W0Y85/allgames",
    sourceTimezone: "Europe/Moscow",
  }),
  Object.freeze({
    name: "Волейбол. Россия. Высшая лига Б. Мужчины",
    season: "2026/27",
    sourceProvider: VOLLEY_RU_PROVIDER,
    sourceChampionshipId: "01KZQZR5T3NETE0RT7VHND16VW",
    sourceUrl: "https://volley.ru/calendar/01KZQZR5T3NETE0RT7VHND16VW/allgames",
    sourceTimezone: "Europe/Moscow",
  }),
] as const);

export async function bootstrapTLineVolleyballPilot(client: PrismaClient) {
  const discipline = await client.discipline.upsert({
    where: { slug: "volleyball" },
    update: {},
    create: { slug: "volleyball", name: "Волейбол", isEnabled: true },
    select: { id: true },
  });
  const sport = await client.tLineSportConfig.upsert({
    where: { disciplineId: discipline.id },
    update: {},
    create: {
      disciplineId: discipline.id,
      adminSportId: null,
      active: true,
      autoEnabled: false,
      autoPeriodFromOffsetMinutes: null,
      autoPeriodToOffsetMinutes: null,
      candidateMatchWindowMinutes: null,
      defaultAllowedTimeDriftMinutes: null,
    },
    select: { id: true },
  });
  const championships = [];
  for (const pilot of TLINE_VOLLEYBALL_PILOT_CHAMPIONSHIPS) {
    const championship = await client.tLineChampionship.upsert({
      where: {
        sportConfigId_sourceProvider_sourceUrl: {
          sportConfigId: sport.id,
          sourceProvider: pilot.sourceProvider,
          sourceUrl: pilot.sourceUrl,
        },
      },
      update: {
        name: pilot.name,
        season: pilot.season,
        sourceChampionshipId: pilot.sourceChampionshipId,
        sourceTimezone: pilot.sourceTimezone,
      },
      create: {
        sportConfigId: sport.id,
        name: pilot.name,
        season: pilot.season,
        sourceProvider: pilot.sourceProvider,
        sourceUrl: pilot.sourceUrl,
        sourceChampionshipId: pilot.sourceChampionshipId,
        sourceTimezone: pilot.sourceTimezone,
        adminChampionshipId: null,
        adminChampionshipName: null,
        active: true,
        autoEnabled: false,
        allowedTimeDriftMinutes: null,
        candidateMatchWindowMinutes: null,
      },
      select: { id: true },
    });
    championships.push(championship);
  }
  await client.tLineScheduleState.upsert({
    where: { id: "global" },
    update: {},
    create: {
      id: "global",
      enabled: false,
      timezone: DEFAULT_TLINE_TIMEZONE,
      slotHours: [...DEFAULT_TLINE_SLOT_HOURS],
    },
  });
  return Object.freeze({
    disciplineId: discipline.id,
    sportConfigId: sport.id,
    championshipIds: Object.freeze(championships.map((championship) => championship.id)),
  });
}
