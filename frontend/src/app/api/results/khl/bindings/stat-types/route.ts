import { NextResponse } from "next/server";

import { requireAdmin, requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  confirmKhlStatTypes,
  KhlTargetBindingError,
  type ConfirmKhlStatTypesInput,
} from "@backend/results/khl/targetBindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_STAT_TYPE_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const parsed = await parseBoundedJsonObject(request);
  if (parsed instanceof Response) return parsed;

  try {
    const result = await confirmKhlStatTypes(prisma, {
      ...parsed,
      confirmedBy: "admin-session",
    } as ConfirmKhlStatTypesInput);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof KhlTargetBindingError) {
      const status = error.code === "INVALID_TARGET_BINDINGS" ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[KHL stat type bindings]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to confirm KHL stat type bindings." }, { status: 500 });
  }
}

async function parseBoundedJsonObject(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_STAT_TYPE_BODY_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let text: string | Response;
  try {
    text = await readBoundedBody(request);
  } catch {
    return NextResponse.json({ error: "Request body could not be read." }, { status: 400 });
  }
  if (text instanceof Response) return text;

  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be a valid JSON object." }, { status: 400 });
  }
}

async function readBoundedBody(request: Request): Promise<string | Response> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_STAT_TYPE_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
