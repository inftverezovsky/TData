import type { OfficialSourceMatch, TLineSourceTeam } from "../domain/types";

export interface TLineChampionshipConfig {
  readonly id: string;
  readonly externalId: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly sourceTimezone: string;
}

export interface OfficialSourceDiagnostics {
  readonly reasonCodes: readonly string[];
  readonly excludedStageNames: readonly string[];
  readonly excludedMatchCount: number;
  readonly eligibleMatchCount: number;
}

export interface ConnectionTestResult {
  readonly ok: true;
  readonly provider: string;
  readonly teamCount: number;
  readonly matchCount: number;
  readonly eligibleMatchCount: number;
  readonly excludedMatchCount: number;
  readonly exactTimeCount: number;
  readonly dateOnlyTimeCount: number;
  readonly undefinedTimeCount: number;
  readonly diagnostics: OfficialSourceDiagnostics;
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
  readonly diagnostics?: OfficialSourceDiagnostics;
}

export interface OfficialSourceAdapter {
  readonly provider: string;
  testConnection(
    config: TLineChampionshipConfig,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ConnectionTestResult>;
  fetchChampionship(input: {
    readonly championship: TLineChampionshipConfig;
    readonly from: Date;
    readonly to: Date;
    readonly forceFresh: boolean;
    readonly includeUndatedSourceMatches: boolean;
    readonly signal?: AbortSignal;
  }): Promise<OfficialChampionshipSnapshot>;
}
