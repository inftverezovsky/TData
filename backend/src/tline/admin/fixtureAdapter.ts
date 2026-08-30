import type {
  AdminChampionshipSnapshot,
  AdminLineAdapter,
  AdminLineFetchInput,
  AdminLineFixture,
} from "./types";

export class FixtureAdminLineAdapter implements AdminLineAdapter {
  private readonly fixture: AdminLineFixture;

  constructor(fixture: AdminLineFixture) {
    this.fixture = cloneFixture(fixture);
  }

  async testConnection() {
    return {
      ok: true,
      mode: "fixture" as const,
      message: "Fixture Admin line adapter is ready.",
    };
  }

  async fetchMatches(input: AdminLineFetchInput): Promise<AdminChampionshipSnapshot[]> {
    input.signal?.throwIfAborted();
    const fromMs = input.from.getTime();
    const toMs = input.to.getTime();

    return this.fixture.championships
      .filter((championship) =>
        championship.sportId === input.scope.sportId
        && championship.shapkaId === input.scope.shapkaId
        && championship.championshipId === input.scope.championshipId
      )
      .map((championship) => ({
        championshipId: championship.championshipId,
        championshipName: championship.championshipName,
        matches: championship.matches
          .filter((match) => {
            const startsAt = Date.parse(match.startsAtUtc);
            return Number.isFinite(startsAt) && startsAt >= fromMs && startsAt < toMs;
          })
          .map((match) => ({ ...match })),
      }));
  }
}

function cloneFixture(fixture: AdminLineFixture): AdminLineFixture {
  return {
    championships: fixture.championships.map((championship) => ({
      sportId: championship.sportId,
      shapkaId: championship.shapkaId,
      championshipId: championship.championshipId,
      championshipName: championship.championshipName,
      matches: championship.matches.map((match) => ({ ...match })),
    })),
  };
}
