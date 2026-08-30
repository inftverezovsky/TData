import type { OfficialSourceMatch, TLineSourceTeam } from "../domain/types";

export interface TLineChampionshipConfig {
  readonly id: string;
  readonly externalId: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly sourceTimezone: string;
}

export interface ConnectionTestResult {
  readonly ok: true;
  readonly provider: string;
  readonly matchCount: number;
  readonly checkedAt: string;
}

export interface OfficialChampionshipSnapshot {
  readonly provider: string;
  readonly championshipId: string;
  readonly externalId: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly teams: readonly TLineSourceTeam[];
  readonly matches: readonly OfficialSourceMatch[];
}

export interface OfficialSourceAdapter {
  readonly provider: string;
  testConnection(config: TLineChampionshipConfig): Promise<ConnectionTestResult>;
  fetchChampionship(input: {
    readonly championship: TLineChampionshipConfig;
    readonly from: Date;
    readonly to: Date;
    readonly forceFresh: boolean;
    readonly signal?: AbortSignal;
  }): Promise<OfficialChampionshipSnapshot>;
}
