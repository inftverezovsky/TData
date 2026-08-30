import type { ApiResult } from "./types";

export class TLineApiError extends Error {
  constructor(message: string, readonly code = "TLINE_REQUEST_FAILED") {
    super(message);
    this.name = "TLineApiError";
  }
}

export async function requestTLine<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null) as ApiResult<T> | T | null;
  if (!response.ok) {
    throw new TLineApiError(errorMessage(body) || `HTTP ${response.status}`);
  }
  if (isEnvelope<T>(body)) {
    if (!body.ok) throw new TLineApiError(body.error.message, body.error.code);
    return body.data;
  }
  return body as T;
}

export function jsonRequest(method: "POST" | "PATCH" | "DELETE", body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function isEnvelope<T>(value: unknown): value is ApiResult<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

function errorMessage(value: unknown) {
  if (typeof value !== "object" || value === null || !("error" in value)) return "";
  const error = value.error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "";
}
