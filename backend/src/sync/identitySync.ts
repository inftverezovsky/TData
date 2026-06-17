import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@backend/db/db";
import { normalizeTeamName } from "@backend/teams/teams";

const IDENTITY_SYNC_SCHEMA_VERSION = 1;
const DEFAULT_SYNC_TIMEOUT_MS = 60000;
const MAPPING_STATUSES = new Set([
  "unmapped",
  "auto_mapped",
  "manual_mapped",
  "manual_unmapped",
  "ambiguous",
  "ignored",
]);

type IdentitySnapshot = {
  schemaVersion: number;
  generatedAt: string;
  instanceId?: string | null;
  data?: {
    disciplines?: any[];
    disciplineAdminSettings?: any[];
    teamMappings?: any[];
    tournamentAdminMappings?: any[];
    tournaments?: any[];
    participants?: any[];
  };
};

export async function exportIdentitySnapshot(): Promise<IdentitySnapshot> {
  const [
    disciplines,
    disciplineAdminSettings,
    teamMappings,
    tournamentAdminMappings,
    tournaments,
    participants,
  ] = await Promise.all([
    prisma.discipline.findMany({
      orderBy: { slug: "asc" },
      select: {
        slug: true,
        name: true,
        baseApiUrl: true,
        platformId: true,
        isEnabled: true,
      },
    }),
    prisma.disciplineAdminSettings.findMany({
      orderBy: { disciplineSlug: "asc" },
      select: {
        disciplineSlug: true,
        apiUrl: true,
        adminSportId: true,
        adminMax: true,
        defaultShapkaId: true,
        timezone: true,
        dateFormat: true,
        requestMode: true,
        sslVerify: true,
        updatedAt: true,
      },
    }),
    prisma.teamMapping.findMany({
      orderBy: [{ disciplineSlug: "asc" }, { liquipediaName: "asc" }],
      select: {
        disciplineSlug: true,
        liquipediaName: true,
        liquipediaNormalizedName: true,
        internalTeamId: true,
        platformId: true,
        canonicalName: true,
        confidenceScore: true,
        matchMethod: true,
        status: true,
        isManual: true,
        isLockedFromAutoMapping: true,
        alias: true,
        logoUrl: true,
        updatedAt: true,
      },
    }),
    prisma.tournamentAdminMapping.findMany({
      orderBy: [{ disciplineSlug: "asc" }, { sourceTournamentName: "asc" }],
      select: {
        disciplineSlug: true,
        tournamentId: true,
        sourceTournamentId: true,
        sourceTournamentName: true,
        adminShapkaId: true,
        adminShapkaName: true,
        updatedAt: true,
      },
    }),
    prisma.tournament.findMany({
      where: { platformId: { not: null } },
      orderBy: [{ disciplineSlug: "asc" }, { sourceTitle: "asc" }],
      select: {
        id: true,
        disciplineSlug: true,
        sourceTitle: true,
        sourceUrl: true,
        name: true,
        platformId: true,
        updatedAt: true,
      },
    }),
    prisma.tournamentParticipant.findMany({
      where: { platformId: { not: null } },
      orderBy: [{ tournamentId: "asc" }, { name: "asc" }],
      select: {
        tournamentId: true,
        name: true,
        platformId: true,
        tournament: {
          select: {
            disciplineSlug: true,
            sourceTitle: true,
            sourceUrl: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const adminTournamentMap = await buildTournamentMap(
    tournamentAdminMappings.map((mapping) => mapping.tournamentId)
  );
  const includeApiUrl = process.env.IDENTITY_SYNC_INCLUDE_API_URL === "1";

  return {
    schemaVersion: IDENTITY_SYNC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    instanceId: process.env.TDATA_INSTANCE_ID || process.env.HOSTNAME || null,
    data: {
      disciplines,
      disciplineAdminSettings: disciplineAdminSettings.map(({ apiUrl, ...settings }) => ({
        ...settings,
        ...(includeApiUrl ? { apiUrl } : {}),
      })),
      teamMappings,
      tournamentAdminMappings: tournamentAdminMappings.map((mapping) => {
        const tournament = adminTournamentMap.get(mapping.tournamentId);
        return {
          ...mapping,
          tournamentSourceTitle: tournament?.sourceTitle || null,
          tournamentSourceUrl: tournament?.sourceUrl || null,
          tournamentName: tournament?.name || null,
        };
      }),
      tournaments,
      participants: participants.map((participant) => ({
        tournamentId: participant.tournamentId,
        disciplineSlug: participant.tournament.disciplineSlug,
        tournamentSourceTitle: participant.tournament.sourceTitle,
        tournamentSourceUrl: participant.tournament.sourceUrl,
        tournamentName: participant.tournament.name,
        name: participant.name,
        platformId: participant.platformId,
      })),
    },
  };
}

export async function importIdentitySnapshot(snapshot: IdentitySnapshot) {
  if (!snapshot || snapshot.schemaVersion !== IDENTITY_SYNC_SCHEMA_VERSION) {
    throw new Error(`Unsupported identity sync snapshot version: ${snapshot?.schemaVersion ?? "unknown"}`);
  }

  const data = snapshot.data || {};
  const counts = {
    disciplines: 0,
    disciplineAdminSettings: 0,
    teamMappings: 0,
    tournamentAdminMappings: 0,
    tournaments: 0,
    participants: 0,
  };

  for (const discipline of data.disciplines || []) {
    const slug = cleanString(discipline.slug);
    if (!slug) continue;

    await prisma.discipline.upsert({
      where: { slug },
      update: {
        name: cleanString(discipline.name) || slug,
        baseApiUrl: cleanNullableString(discipline.baseApiUrl),
        platformId: cleanNullableString(discipline.platformId),
        isEnabled: discipline.isEnabled ?? true,
      },
      create: {
        slug,
        name: cleanString(discipline.name) || slug,
        baseApiUrl: cleanNullableString(discipline.baseApiUrl),
        platformId: cleanNullableString(discipline.platformId),
        isEnabled: discipline.isEnabled ?? true,
      },
    });
    counts.disciplines++;
  }

  for (const settings of data.disciplineAdminSettings || []) {
    const disciplineSlug = cleanString(settings.disciplineSlug);
    if (!disciplineSlug) continue;

    const settingsData = {
      adminSportId: cleanNullableString(settings.adminSportId),
      adminMax: cleanNullableString(settings.adminMax),
      defaultShapkaId: cleanNullableString(settings.defaultShapkaId),
      timezone: cleanString(settings.timezone) || "Europe/Moscow",
      dateFormat: cleanString(settings.dateFormat) || "DD.MM.YYYY HH:mm:ss",
      requestMode: cleanString(settings.requestMode) || "legacy_raw",
      sslVerify: settings.sslVerify ?? true,
      ...(settings.apiUrl ? { apiUrl: cleanNullableString(settings.apiUrl) } : {}),
    };

    await prisma.disciplineAdminSettings.upsert({
      where: { disciplineSlug },
      update: settingsData,
      create: {
        disciplineSlug,
        ...settingsData,
      },
    });
    counts.disciplineAdminSettings++;
  }

  counts.teamMappings = await importTeamMappings(data.teamMappings || []);

  for (const tournament of data.tournaments || []) {
    if (!("platformId" in tournament)) continue;
    const tournamentId = await resolveLocalTournamentId(tournament);
    if (!tournamentId) continue;

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { platformId: cleanNullableString(tournament.platformId) },
    });
    counts.tournaments++;
  }

  for (const mapping of data.tournamentAdminMappings || []) {
    const tournamentId = await resolveLocalTournamentId(mapping);
    const stableTournamentId = tournamentId || cleanString(mapping.tournamentId);
    const disciplineSlug = cleanString(mapping.disciplineSlug);
    const sourceTournamentName =
      cleanString(mapping.sourceTournamentName) ||
      cleanString(mapping.tournamentSourceTitle) ||
      cleanString(mapping.tournamentName) ||
      stableTournamentId;

    if (!stableTournamentId || !disciplineSlug || !sourceTournamentName) continue;

    await prisma.tournamentAdminMapping.upsert({
      where: { tournamentId: stableTournamentId },
      update: {
        disciplineSlug,
        sourceTournamentId:
          cleanNullableString(mapping.sourceTournamentId) ||
          cleanNullableString(mapping.tournamentSourceUrl) ||
          cleanNullableString(mapping.tournamentSourceTitle),
        sourceTournamentName,
        adminShapkaId: cleanNullableString(mapping.adminShapkaId),
        adminShapkaName: cleanNullableString(mapping.adminShapkaName),
      },
      create: {
        tournamentId: stableTournamentId,
        disciplineSlug,
        sourceTournamentId:
          cleanNullableString(mapping.sourceTournamentId) ||
          cleanNullableString(mapping.tournamentSourceUrl) ||
          cleanNullableString(mapping.tournamentSourceTitle),
        sourceTournamentName,
        adminShapkaId: cleanNullableString(mapping.adminShapkaId),
        adminShapkaName: cleanNullableString(mapping.adminShapkaName),
      },
    });
    counts.tournamentAdminMappings++;
  }

  for (const participant of data.participants || []) {
    const tournamentId = await resolveLocalTournamentId(participant);
    const name = cleanString(participant.name);
    if (!tournamentId || !name || !("platformId" in participant)) continue;

    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId, name },
      data: { platformId: cleanNullableString(participant.platformId) },
    });
    counts.participants++;
  }

  return counts;
}

export async function pushIdentitySnapshot(reason: string) {
  const peerUrls = getPeerUrls();
  if (peerUrls.length === 0) return { enabled: false };

  const token = getSyncToken();
  if (!token) return { enabled: true, ok: false, error: "TDATA_SYNC_TOKEN is not configured" };

  const snapshot = await exportIdentitySnapshot();
  const results = await Promise.all(
    peerUrls.map(async (peerUrl) => {
      const endpoint = buildSyncEndpoint(peerUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), getSyncTimeoutMs());

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-tdata-sync-origin": process.env.TDATA_INSTANCE_ID || "unknown",
          },
          body: JSON.stringify({ reason, snapshot }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        return { url: endpoint, ok: response.ok, status: response.status, body };
      } catch (error) {
        return {
          url: endpoint,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  return {
    enabled: true,
    ok: results.every((result) => result.ok),
    results,
  };
}

export function queueIdentitySync(reason: string) {
  const peerUrls = getPeerUrls();
  if (peerUrls.length === 0) return { enabled: false };

  void pushIdentitySnapshot(reason).then((result) => {
    if (result.enabled && !result.ok) {
      console.error("[Identity Sync] Push failed", result);
    }
  }).catch((error) => {
    console.error("[Identity Sync] Push failed", error);
  });

  return { enabled: true, queued: true };
}

export function verifyIdentitySyncRequest(request: Request) {
  const token = getSyncToken();
  if (!token) return false;

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerToken = request.headers.get("x-tdata-sync-token");
  return safeEqual(bearer || headerToken || "", token);
}

async function buildTournamentMap(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, { sourceTitle: string; sourceUrl: string; name: string }>();

  const tournaments = await prisma.tournament.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      sourceTitle: true,
      sourceUrl: true,
      name: true,
    },
  });

  return new Map(tournaments.map((tournament) => [tournament.id, tournament]));
}

async function resolveLocalTournamentId(input: any) {
  const directId = cleanString(input.tournamentId || input.id);
  if (directId) {
    const byId = await prisma.tournament.findUnique({
      where: { id: directId },
      select: { id: true },
    });
    if (byId) return byId.id;
  }

  const sourceUrl = cleanString(input.tournamentSourceUrl || input.sourceUrl || input.sourceTournamentId);
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
    const byUrl = await prisma.tournament.findFirst({
      where: { sourceUrl },
      select: { id: true },
    });
    if (byUrl) return byUrl.id;
  }

  const disciplineSlug = cleanString(input.disciplineSlug);
  const sourceTitle = cleanString(input.tournamentSourceTitle || input.sourceTitle);
  if (disciplineSlug && sourceTitle) {
    const bySourceTitle = await prisma.tournament.findUnique({
      where: {
        disciplineSlug_sourceTitle: {
          disciplineSlug,
          sourceTitle,
        },
      },
      select: { id: true },
    });
    if (bySourceTitle) return bySourceTitle.id;
  }

  const name = cleanString(input.tournamentName || input.sourceTournamentName || input.name);
  if (disciplineSlug && name) {
    const byName = await prisma.tournament.findFirst({
      where: {
        disciplineSlug,
        OR: [
          { name },
          { sourceTitle: name },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (byName) return byName.id;
  }

  return null;
}

function normalizeMappingStatus(status: unknown, platformId: string | null) {
  const raw = cleanString(status);
  if (raw && MAPPING_STATUSES.has(raw)) return raw;
  return platformId ? "manual_mapped" : "unmapped";
}

async function importTeamMappings(rawMappings: any[]) {
  const rows = rawMappings
    .map((mapping) => {
      const disciplineSlug = cleanString(mapping.disciplineSlug) || "counterstrike";
      const liquipediaName = cleanString(mapping.liquipediaName);
      if (!liquipediaName) return null;

      const platformId = cleanNullableString(mapping.platformId);
      return {
        id: buildStableTeamMappingId(disciplineSlug, liquipediaName),
        disciplineSlug,
        liquipediaName,
        liquipediaNormalizedName: cleanNullableString(mapping.liquipediaNormalizedName) || normalizeTeamName(liquipediaName),
        internalTeamId: cleanNullableString(mapping.internalTeamId),
        platformId,
        canonicalName: cleanNullableString(mapping.canonicalName),
        confidenceScore: Number.isFinite(Number(mapping.confidenceScore)) ? Number(mapping.confidenceScore) : null,
        matchMethod: cleanNullableString(mapping.matchMethod),
        status: normalizeMappingStatus(mapping.status, platformId),
        isManual: mapping.isManual ?? !!platformId,
        isLockedFromAutoMapping: mapping.isLockedFromAutoMapping ?? !!platformId,
        alias: cleanNullableString(mapping.alias),
        logoUrl: cleanNullableString(mapping.logoUrl),
      };
    })
    .filter(Boolean);

  if (rows.length === 0) return 0;

  await prisma.$executeRaw`
    INSERT INTO "TeamMapping" (
      "id",
      "disciplineSlug",
      "liquipediaName",
      "liquipediaNormalizedName",
      "internalTeamId",
      "platformId",
      "canonicalName",
      "confidenceScore",
      "matchMethod",
      "status",
      "isManual",
      "isLockedFromAutoMapping",
      "alias",
      "logoUrl",
      "createdAt",
      "updatedAt"
    )
    SELECT
      x."id",
      x."disciplineSlug",
      x."liquipediaName",
      x."liquipediaNormalizedName",
      x."internalTeamId",
      x."platformId",
      x."canonicalName",
      x."confidenceScore",
      x."matchMethod",
      x."status"::"MappingStatus",
      x."isManual",
      x."isLockedFromAutoMapping",
      x."alias",
      x."logoUrl",
      NOW(),
      NOW()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
      "id" text,
      "disciplineSlug" text,
      "liquipediaName" text,
      "liquipediaNormalizedName" text,
      "internalTeamId" text,
      "platformId" text,
      "canonicalName" text,
      "confidenceScore" double precision,
      "matchMethod" text,
      "status" text,
      "isManual" boolean,
      "isLockedFromAutoMapping" boolean,
      "alias" text,
      "logoUrl" text
    )
    ON CONFLICT ("disciplineSlug", "liquipediaName") DO UPDATE SET
      "liquipediaNormalizedName" = EXCLUDED."liquipediaNormalizedName",
      "internalTeamId" = EXCLUDED."internalTeamId",
      "platformId" = EXCLUDED."platformId",
      "canonicalName" = EXCLUDED."canonicalName",
      "confidenceScore" = EXCLUDED."confidenceScore",
      "matchMethod" = EXCLUDED."matchMethod",
      "status" = EXCLUDED."status",
      "isManual" = EXCLUDED."isManual",
      "isLockedFromAutoMapping" = EXCLUDED."isLockedFromAutoMapping",
      "alias" = EXCLUDED."alias",
      "logoUrl" = EXCLUDED."logoUrl",
      "updatedAt" = NOW()
  `;

  return rows.length;
}

function getPeerUrls() {
  const raw = process.env.TDATA_SYNC_PEER_URL || process.env.IDENTITY_SYNC_PEER_URL || "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSyncToken() {
  return process.env.TDATA_SYNC_TOKEN || process.env.IDENTITY_SYNC_TOKEN || "";
}

function getSyncTimeoutMs() {
  return Number(process.env.TDATA_SYNC_TIMEOUT_MS || process.env.IDENTITY_SYNC_TIMEOUT_MS || DEFAULT_SYNC_TIMEOUT_MS);
}

function buildSyncEndpoint(peerUrl: string) {
  const url = new URL(peerUrl);
  url.pathname = "/api/admin-settings/identity-sync";
  url.search = "";
  return url.toString();
}

function cleanString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cleanNullableString(value: unknown) {
  const cleaned = cleanString(value);
  return cleaned.length > 0 ? cleaned : null;
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function buildStableTeamMappingId(disciplineSlug: string, liquipediaName: string) {
  const hash = createHash("sha1")
    .update(`${disciplineSlug}:${liquipediaName.toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
  return `sync_team_${hash}`;
}
