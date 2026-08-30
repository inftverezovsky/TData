export interface AdminLineMatch {
  id: string;
  championshipId: string;
  team1Id: string;
  team1Name: string;
  team2Id: string;
  team2Name: string;
  startsAtUtc: string;
  status: string;
}

export interface AdminChampionshipSnapshot {
  championshipId: string;
  championshipName: string;
  matches: AdminLineMatch[];
}

export interface AdminLineScope {
  sportId: string;
  shapkaId: string;
  championshipId: string;
}

export interface AdminLineFetchInput {
  scope: AdminLineScope;
  from: Date;
  to: Date;
  signal?: AbortSignal;
}

export interface AdminLineConnectionResult {
  ok: boolean;
  mode: "fixture" | "http";
  message: string;
}

export interface AdminLineAdapter {
  testConnection(): Promise<AdminLineConnectionResult>;
  fetchMatches(input: AdminLineFetchInput): Promise<AdminChampionshipSnapshot[]>;
}

export interface AdminLineFixture {
  championships: ReadonlyArray<{
    sportId: string;
    shapkaId: string;
    championshipId: string;
    championshipName: string;
    matches: ReadonlyArray<Readonly<AdminLineMatch>>;
  }>;
}
