import { FixtureAdminLineAdapter } from "./fixtureAdapter";
import type { AdminLineAdapter, AdminLineFixture } from "./types";

export type TLineAdminConfigurationErrorCode =
  | "FIXTURE_FORBIDDEN"
  | "ADMIN_LINE_NOT_CONFIGURED";

export class TLineAdminConfigurationError extends Error {
  constructor(
    readonly code: TLineAdminConfigurationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TLineAdminConfigurationError";
  }
}

export function createAdminLineAdapter(options: {
  mode: "fixture" | "http";
  environment?: string;
  fixture?: AdminLineFixture;
}): AdminLineAdapter {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";

  if (options.mode === "fixture") {
    if (environment === "production") {
      throw new TLineAdminConfigurationError(
        "FIXTURE_FORBIDDEN",
        "Fixture Admin line data is forbidden in production."
      );
    }
    return new FixtureAdminLineAdapter(options.fixture ?? { championships: [] });
  }

  throw new TLineAdminConfigurationError(
    "ADMIN_LINE_NOT_CONFIGURED",
    "The read-only Admin line contract is not configured."
  );
}
