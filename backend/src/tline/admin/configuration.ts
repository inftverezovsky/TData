import { readFileSync, statSync } from "node:fs";

import { createAdminLineAdapter, TLineAdminConfigurationError } from "./factory";
import type { AdminLineFixture } from "./types";

const MAX_ADMIN_FIXTURE_BYTES = 5 * 1024 * 1024;

export function getAdminLineConfiguration() {
  const mode = process.env.TLINE_ADMIN_MODE === "fixture" ? "fixture" : "http";
  const productionFixture = mode === "fixture" && process.env.NODE_ENV === "production";
  return {
    mode,
    configured: mode === "fixture" && !productionFixture,
    productionFixtureForbidden: productionFixture,
  } as const;
}

export function createConfiguredAdminLineAdapter(fixture?: AdminLineFixture) {
  const configuration = getAdminLineConfiguration();
  if (!configuration.configured) {
    throw new TLineAdminConfigurationError(
      configuration.productionFixtureForbidden ? "FIXTURE_FORBIDDEN" : "ADMIN_LINE_NOT_CONFIGURED",
      "The read-only Admin line adapter is not configured for this environment.",
    );
  }
  return createAdminLineAdapter({
    mode: configuration.mode,
    environment: process.env.NODE_ENV,
    fixture: fixture ?? loadConfiguredFixture(),
  });
}

export function createOptionalConfiguredAdminLineAdapter(fixture?: AdminLineFixture) {
  const configuration = getAdminLineConfiguration();
  if (configuration.productionFixtureForbidden) {
    return createConfiguredAdminLineAdapter(fixture);
  }
  return configuration.configured ? createConfiguredAdminLineAdapter(fixture) : null;
}

function loadConfiguredFixture(): AdminLineFixture {
  const fixturePath = process.env.TLINE_ADMIN_FIXTURE_PATH?.trim();
  if (!fixturePath) return { championships: [] };
  const size = statSync(fixturePath).size;
  if (size > MAX_ADMIN_FIXTURE_BYTES) {
    throw new TLineAdminConfigurationError("ADMIN_LINE_NOT_CONFIGURED", "Admin fixture exceeds the size limit.");
  }
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!isAdminLineFixture(parsed)) {
    throw new TLineAdminConfigurationError("ADMIN_LINE_NOT_CONFIGURED", "Admin fixture schema is invalid.");
  }
  return parsed;
}

function isAdminLineFixture(value: unknown): value is AdminLineFixture {
  if (!isRecord(value) || !Array.isArray(value.championships)) return false;
  return value.championships.every((championship) =>
    isRecord(championship)
    && typeof championship.sportId === "string"
    && typeof championship.shapkaId === "string"
    && typeof championship.championshipId === "string"
    && typeof championship.championshipName === "string"
    && Array.isArray(championship.matches)
    && championship.matches.every((match) =>
      isRecord(match)
      && ["id", "championshipId", "team1Id", "team1Name", "team2Id", "team2Name", "startsAtUtc", "status"]
        .every((key) => typeof match[key] === "string")
      && Number.isFinite(Date.parse(match.startsAtUtc as string))
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
