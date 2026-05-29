import { readSheet } from "read-excel-file/node";

export const MAX_ADMIN_TEAM_SOURCE_BYTES = 10 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15000;

export type AdminTeamSpreadsheetSource = {
  rows: unknown[][];
  fileName: string;
  sourceType: "file" | "url";
  byteLength: number;
  cacheHit: boolean;
  timingsMs: AdminTeamSpreadsheetSourceTimings;
};

export type AdminTeamSpreadsheetSourceTimings = {
  fetch: number;
  readBytes: number;
  readSheet: number;
  total: number;
};

const GOOGLE_SHEETS_CACHE_TTL_MS = 10 * 60 * 1000;
const googleSheetsRowsCache = new Map<
  string,
  {
    expiresAt: number;
    rows: unknown[][];
    byteLength: number;
  }
>();

export async function readAdminTeamRowsFromSpreadsheetSource(input: {
  file?: File | null;
  url?: string | null;
}): Promise<AdminTeamSpreadsheetSource> {
  const startedAt = performance.now();
  const file = input.file || null;
  const url = typeof input.url === "string" ? input.url.trim() : "";

  if (file && url) {
    throw createSpreadsheetSourceError("Укажите только один источник: файл или Google Sheets ссылку.", 400);
  }

  if (!file && !url) {
    throw createSpreadsheetSourceError("No file or URL provided", 400);
  }

  let buffer: Buffer;
  let fileName: string;
  let sourceType: "file" | "url";
  let fetchMs = 0;
  let readBytesMs = 0;

  if (file) {
    if (file.size > MAX_ADMIN_TEAM_SOURCE_BYTES) {
      throw createSpreadsheetSourceError("File is too large", 413);
    }

    const readBytesStartedAt = performance.now();
    const bytes = await file.arrayBuffer();
    readBytesMs = performance.now() - readBytesStartedAt;
    buffer = Buffer.from(bytes);
    fileName = file.name || "upload.xlsx";
    sourceType = "file";
  } else {
    const fetchUrl = toGoogleSheetsExportUrl(url);
    if (!fetchUrl) {
      throw createSpreadsheetSourceError("Укажите ссылку на Google Sheets таблицу.", 400);
    }

    const cached = googleSheetsRowsCache.get(fetchUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        rows: cached.rows,
        fileName: "remote_url",
        sourceType: "url",
        byteLength: cached.byteLength,
        cacheHit: true,
        timingsMs: {
          fetch: 0,
          readBytes: 0,
          readSheet: 0,
          total: performance.now() - startedAt,
        },
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    const fetchStartedAt = performance.now();
    const response = await fetch(fetchUrl, { signal: controller.signal }).finally(() => clearTimeout(timeout));
    fetchMs = performance.now() - fetchStartedAt;

    if (!response.ok) {
      throw createSpreadsheetSourceError(
        response.status === 403 || response.status === 404
          ? "Google Sheets не отдаёт таблицу. Проверьте, что ссылка открыта для просмотра всем, у кого есть ссылка."
          : `Не удалось скачать Google Sheets: ${response.status} ${response.statusText}`,
        400
      );
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ADMIN_TEAM_SOURCE_BYTES) {
      throw createSpreadsheetSourceError("Remote file is too large", 413);
    }

    const readBytesStartedAt = performance.now();
    const bytes = await response.arrayBuffer();
    readBytesMs = performance.now() - readBytesStartedAt;
    if (bytes.byteLength > MAX_ADMIN_TEAM_SOURCE_BYTES) {
      throw createSpreadsheetSourceError("Remote file is too large", 413);
    }

    buffer = Buffer.from(bytes);
    if (looksLikeHtml(buffer, response.headers.get("content-type"))) {
      throw createSpreadsheetSourceError(
        "Google Sheets вернул HTML-страницу вместо Excel. Откройте доступ к таблице по ссылке или используйте прямой Excel-файл.",
        400
      );
    }
    fileName = "remote_url";
    sourceType = "url";
  }

  if (buffer.byteLength === 0) {
    throw createSpreadsheetSourceError("Source has no data", 400);
  }

  const readSheetStartedAt = performance.now();
  const rows = await readSheet(buffer);
  const readSheetMs = performance.now() - readSheetStartedAt;
  if (rows.length < 1) {
    throw createSpreadsheetSourceError("Source has no data", 400);
  }

  if (sourceType === "url") {
    const fetchUrl = toGoogleSheetsExportUrl(url);
    if (fetchUrl) {
      googleSheetsRowsCache.set(fetchUrl, {
        expiresAt: Date.now() + GOOGLE_SHEETS_CACHE_TTL_MS,
        rows,
        byteLength: buffer.byteLength,
      });
    }
  }

  return {
    rows,
    fileName,
    sourceType,
    byteLength: buffer.byteLength,
    cacheHit: false,
    timingsMs: {
      fetch: fetchMs,
      readBytes: readBytesMs,
      readSheet: readSheetMs,
      total: performance.now() - startedAt,
    },
  };
}

export function toGoogleSheetsExportUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== "docs.google.com" || !parsed.pathname.includes("/spreadsheets/")) {
      return null;
    }

    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return null;

    const gid = parsed.searchParams.get("gid") || parsed.hash.match(/gid=(\d+)/)?.[1] || "";
    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
    exportUrl.searchParams.set("format", "xlsx");
    if (gid) exportUrl.searchParams.set("gid", gid);
    return exportUrl.toString();
  } catch {
    return null;
  }
}

export function looksLikeHtml(buffer: Buffer, contentType: string | null) {
  if (contentType?.toLowerCase().includes("text/html")) return true;
  const head = buffer.subarray(0, 128).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export function getSpreadsheetSourceErrorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) || 500
    : 500;
}

function createSpreadsheetSourceError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}
