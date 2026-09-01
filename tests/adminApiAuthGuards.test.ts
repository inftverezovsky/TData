import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { requireSameOriginMutation } from "../backend/src/auth/adminAuth";
import { readImportTournamentRequestBody } from "../frontend/src/app/api/[disciplineSlug]/import-tournament/route";
import { BoundedBodyReadError } from "../backend/src/http/boundedResponse";

const API_ROOT = path.join(process.cwd(), "frontend", "src", "app", "api");
const ADMIN_GUARD_PATTERN = /\brequireAdmin\s*\(/;

const REQUIRED_ADMIN_GUARDED_ROUTES = new Set([
  "admin-settings/[disciplineSlug]/route.ts",
  "admin-settings/proxy-pool/route.ts",
  "admin/proxies/route.ts",
  "cron/check-proxies/route.ts",
  "settings/global/route.ts",
  "settings/route.ts",
]);

const UI_WORKFLOW_ROUTES = new Set([
  "[disciplineSlug]/import-tournament/route.ts",
  "[disciplineSlug]/search-tournament/route.ts",
  "[disciplineSlug]/tournament/[id]/admin-fixt-preview/route.ts",
  "[disciplineSlug]/tournament/[id]/admin-mapping/route.ts",
  "admin/sandbox/route.ts",
  "settings/clear-search-cache/route.ts",
]);

test("sensitive admin API routes require the admin password gate", () => {
  const missingGuards = collectRouteFiles(API_ROOT)
    .filter((filePath) => REQUIRED_ADMIN_GUARDED_ROUTES.has(toApiRelativePath(filePath)))
    .filter((filePath) => !ADMIN_GUARD_PATTERN.test(fs.readFileSync(filePath, "utf8")))
    .map(toApiRelativePath)
    .sort();

  assert.deepEqual(missingGuards, []);
});

test("parser and upload workflow routes stay callable from ungated UI pages", () => {
  const guardedWorkflowRoutes = collectRouteFiles(API_ROOT)
    .filter((filePath) => UI_WORKFLOW_ROUTES.has(toApiRelativePath(filePath)))
    .filter((filePath) => ADMIN_GUARD_PATTERN.test(fs.readFileSync(filePath, "utf8")))
    .map(toApiRelativePath)
    .sort();

  assert.deepEqual(guardedWorkflowRoutes, []);
});

test("admin origin validation ignores forwarded headers unless explicitly trusted", () => {
  const previous = process.env.TRUST_PROXY_HEADERS;
  try {
    delete process.env.TRUST_PROXY_HEADERS;
    const request = new Request("http://internal:3010/api/admin", {
      method: "POST",
      headers: {
        Origin: "https://admin.example",
        "Content-Type": "application/json",
        "X-Forwarded-Host": "admin.example",
        "X-Forwarded-Proto": "https",
      },
      body: "{}",
    });
    assert.equal(requireSameOriginMutation(request, ["application/json"])?.status, 403);

    process.env.TRUST_PROXY_HEADERS = "1";
    assert.equal(requireSameOriginMutation(request, ["application/json"]), null);
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS;
    else process.env.TRUST_PROXY_HEADERS = previous;
  }
});

test("admin origin validation accepts the explicitly configured public origin", () => {
  const previousPublicBaseUrl = process.env.TDATA_PUBLIC_BASE_URL;
  const previousTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
  try {
    process.env.TDATA_PUBLIC_BASE_URL = "https://www.tdata.info/app";
    delete process.env.TRUST_PROXY_HEADERS;

    const publicRequest = new Request("http://internal:3010/api/counterstrike/import-tournament", {
      method: "POST",
      headers: {
        Origin: "https://www.tdata.info",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(requireSameOriginMutation(publicRequest, ["application/json"]), null);

    const foreignRequest = new Request("http://internal:3010/api/counterstrike/import-tournament", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(requireSameOriginMutation(foreignRequest, ["application/json"])?.status, 403);
  } finally {
    if (previousPublicBaseUrl === undefined) delete process.env.TDATA_PUBLIC_BASE_URL;
    else process.env.TDATA_PUBLIC_BASE_URL = previousPublicBaseUrl;

    if (previousTrustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
    else process.env.TRUST_PROXY_HEADERS = previousTrustProxyHeaders;
  }
});

test("admin tournament import enforces 64 KiB while streaming chunked JSON", async () => {
  const encoder = new TextEncoder();
  const request = new Request("http://localhost/api/counterstrike/import-tournament", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`{"source":"hltv","padding":"`));
        controller.enqueue(new Uint8Array(65_536));
        controller.enqueue(encoder.encode('"}'));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(
    readImportTournamentRequestBody(request),
    (error: unknown) => error instanceof BoundedBodyReadError && error.code === "body_too_large",
  );
});

function collectRouteFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(fullPath);
    return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
  });
}

function toApiRelativePath(filePath: string) {
  return path.relative(API_ROOT, filePath).split(path.sep).join("/");
}
