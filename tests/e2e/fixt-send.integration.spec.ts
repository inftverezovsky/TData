import http from "http";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

const runDbE2E = process.env.RUN_DB_E2E === "1" || process.env.RUN_DB_E2E === "true";
const databaseUrl = process.env.DATABASE_URL || "";
const dbLooksExplicitlyTest = /(?:test|e2e)/i.test(databaseUrl);

test.describe("FIxt upload integration", () => {
  test.skip(!runDbE2E, "Set RUN_DB_E2E=1 and point DATABASE_URL at a test database.");
  test.skip(runDbE2E && !dbLooksExplicitlyTest, "DATABASE_URL must explicitly contain test or e2e for DB integration tests.");

  test("builds, sends, logs and blocks duplicate FIxt payloads", async ({ request }, testInfo) => {
    const prisma = new PrismaClient();
    const mock = await startAdminApiMock();
    const suffix = `${Date.now()}-${testInfo.workerIndex}`;
    const disciplineSlug = `e2e-fixt-${suffix}`;
    const tournamentId = `e2e-tournament-${suffix}`;
    const matchId = `e2e-match-${suffix}`;
    const placeholderMatchId = `e2e-match-tbd-${suffix}`;

    try {
      await seedFixtFixture(prisma, {
        disciplineSlug,
        tournamentId,
        matchId,
        apiUrl: mock.url,
      });

      const cookie = await loginAndGetCookie(request);
      const previewAll = await request.post(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-preview`, {
        headers: { cookie },
        data: { selectedMatchIds: [] },
      });
      await expect(previewAll).toBeOK();

      const previewAllJson = await previewAll.json();
      expect(previewAllJson.readyMatchesCount).toBe(1);
      expect(previewAllJson.skippedMatches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            matchId: placeholderMatchId,
            reason: "Missing or unmapped team platform IDs",
          }),
        ])
      );

      await prisma.teamMapping.createMany({
        data: [
          {
            disciplineSlug,
            liquipediaName: "TBD1",
            platformId: "333",
            status: "manual_mapped",
            isManual: true,
          },
          {
            disciplineSlug,
            liquipediaName: "TBD2",
            platformId: "444",
            status: "manual_mapped",
            isManual: true,
          },
        ],
      });

      const previewTbd = await request.post(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-preview`, {
        headers: { cookie },
        data: { selectedMatchIds: [placeholderMatchId] },
      });
      await expect(previewTbd).toBeOK();

      await expect(await previewTbd.json()).toMatchObject({
        ok: true,
        readyMatchesCount: 1,
        phpArray: {
          match: [{ team1: 333, team2: 444 }],
        },
      });

      const preview = await request.post(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-preview`, {
        headers: { cookie },
        data: { selectedMatchIds: [matchId] },
      });
      await expect(preview).toBeOK();

      const previewJson = await preview.json();
      expect(previewJson).toMatchObject({
        ok: true,
        readyMatchesCount: 1,
        phpArray: {
          shapka: 987,
          sport: 73,
          max: 5000,
          match: [{ team1: 111, team2: 222 }],
        },
      });
      expect(previewJson.phpArray.match[0].date).toBe("10.05.2026 15:30:00");

      const send = await request.post(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-send`, {
        headers: { cookie },
        data: { selectedMatchIds: [matchId] },
      });
      await expect(send).toBeOK();
      await expect(await send.json()).toMatchObject({
        ok: true,
        status: "success_like",
        markedMatchesCount: 1,
        rawResponse: "1",
      });

      expect(mock.requests).toHaveLength(1);
      const postedForm = new URLSearchParams(mock.requests[0].body);
      const serialized = postedForm.get("fixt") || "";
      expect(serialized).toContain("s:6:\"shapka\";i:987");
      expect(serialized).toContain("s:5:\"sport\";i:73");
      expect(serialized).toContain("s:5:\"team1\";i:111");
      expect(serialized).toContain("s:5:\"team2\";i:222");

      const duplicate = await request.post(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-send`, {
        headers: { cookie },
        data: { selectedMatchIds: [matchId] },
      });
      expect(duplicate.status()).toBe(409);
      await expect(await duplicate.json()).toMatchObject({
        ok: false,
        error: "This payload was already sent or is currently being sent. Use force option to override.",
      });
      expect(mock.requests).toHaveLength(1);

      const duplicateWithStringForce = await request.post(`/api/${disciplineSlug}/tournament/${tournamentId}/admin-fixt-send`, {
        headers: { cookie },
        data: { selectedMatchIds: [matchId], force: "false" },
      });
      expect(duplicateWithStringForce.status()).toBe(409);
      expect(mock.requests).toHaveLength(1);

      const syncedMatch = await prisma.tournamentMatch.findUnique({
        where: { matchId },
        select: { syncedAt: true },
      });
      expect(syncedMatch?.syncedAt).toBeTruthy();

      const placeholderMatch = await prisma.tournamentMatch.findUnique({
        where: { matchId: placeholderMatchId },
        select: { syncedAt: true },
      });
      expect(placeholderMatch?.syncedAt).toBeNull();

      const uploadLog = await prisma.adminUploadLog.findFirst({
        where: { disciplineSlug, tournamentId },
      });
      expect(uploadLog).toMatchObject({
        status: "success_like",
        readyMatchesCount: 1,
        skippedMatchesCount: 0,
        adminSportId: "73",
        adminShapkaId: "987",
      });
    } finally {
      await cleanupFixtFixture(prisma, { disciplineSlug, tournamentId, matchId });
      await prisma.tournamentMatch.deleteMany({
        where: { matchId: placeholderMatchId },
      });
      await prisma.$disconnect();
      await mock.close();
    }
  });
});

async function loginAndGetCookie(request: APIRequestContext) {
  const login = await request.post("/api/admin-auth/login", {
    data: { password: "63016" },
  });
  await expect(login).toBeOK();

  const setCookie = login.headers()["set-cookie"];
  expect(setCookie).toContain("tcyber_admin_session=");

  return setCookie.split(";")[0];
}

async function seedFixtFixture(
  prisma: PrismaClient,
  fixture: { disciplineSlug: string; tournamentId: string; matchId: string; apiUrl: string }
) {
  await cleanupFixtFixture(prisma, fixture);

  await prisma.disciplineAdminSettings.create({
    data: {
      disciplineSlug: fixture.disciplineSlug,
      apiUrl: fixture.apiUrl,
      adminSportId: "73",
      adminMax: "5000",
      defaultShapkaId: "987",
      timezone: "Europe/Moscow",
      dateFormat: "DD.MM.YYYY HH:mm:ss",
      requestMode: "urlencoded",
      sslVerify: false,
    },
  });

  await prisma.tournament.create({
    data: {
      id: fixture.tournamentId,
      sourceTitle: `E2E FIxt ${fixture.matchId}`,
      sourceUrl: `https://example.test/${fixture.matchId}`,
      name: "E2E FIxt Tournament",
      disciplineSlug: fixture.disciplineSlug,
      extractionStatus: "SUCCESS",
    },
  });

  await prisma.tournamentMatch.create({
    data: {
      matchId: fixture.matchId,
      tournamentId: fixture.tournamentId,
      matchDate: new Date("2026-05-10T12:30:00.000Z"),
      teamAName: "Team Alpha",
      teamBName: "Team Beta",
      status: "upcoming",
    },
  });
  await prisma.tournamentMatch.create({
    data: {
      matchId: fixture.matchId.replace("e2e-match-", "e2e-match-tbd-"),
      tournamentId: fixture.tournamentId,
      matchDate: new Date("2026-05-10T13:30:00.000Z"),
      teamAName: "TBD1",
      teamBName: "TBD2",
      status: "upcoming",
      hasPlaceholderTeams: true,
    },
  });

  await prisma.teamMapping.createMany({
    data: [
      {
        disciplineSlug: fixture.disciplineSlug,
        liquipediaName: "Team Alpha",
        platformId: "111",
        status: "manual_mapped",
        isManual: true,
      },
      {
        disciplineSlug: fixture.disciplineSlug,
        liquipediaName: "Team Beta",
        platformId: "222",
        status: "manual_mapped",
        isManual: true,
      },
    ],
  });
}

async function cleanupFixtFixture(
  prisma: PrismaClient,
  fixture: { disciplineSlug: string; tournamentId: string; matchId: string }
) {
  await prisma.adminUploadLog.deleteMany({
    where: { disciplineSlug: fixture.disciplineSlug },
  });
  await prisma.tournamentAdminMapping.deleteMany({
    where: { tournamentId: fixture.tournamentId },
  });
  await prisma.tournamentMatch.deleteMany({
    where: { matchId: { in: [fixture.matchId, fixture.matchId.replace("e2e-match-", "e2e-match-tbd-")] } },
  });
  await prisma.tournament.deleteMany({
    where: { id: fixture.tournamentId },
  });
  await prisma.teamMapping.deleteMany({
    where: { disciplineSlug: fixture.disciplineSlug },
  });
  await prisma.disciplineAdminSettings.deleteMany({
    where: { disciplineSlug: fixture.disciplineSlug },
  });
}

async function startAdminApiMock() {
  const requests: Array<{ method: string; url: string; body: string }> = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method || "",
        url: req.url || "",
        body,
      });
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("1");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start admin API mock");
  }

  return {
    requests,
    url: `http://127.0.0.1:${address.port}/fixt`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
