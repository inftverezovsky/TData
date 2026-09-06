import { NextResponse } from "next/server";

import { requireSameOriginJsonMutation } from "@backend/auth/adminAuth";
import { prisma } from "@backend/db/db";
import {
  confirmKhlPlayerExtraBinding,
  KhlPlayerExtraBindingError,
  type ConfirmKhlPlayerExtraBindingInput,
} from "@backend/results/khl/playerExtraBindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_KEYS = new Set(["khlPlayerId", "extraCode", "adminExtraId", "adminExtraName"]);

export async function POST(request: Request) {
  const unsafeRequest = requireSameOriginJsonMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const parsed = await parseBoundedJsonObject(request);
  if (parsed instanceof Response) return parsed;
  if (Object.keys(parsed).some((key) => !ALLOWED_KEYS.has(key))) {
    return NextResponse.json({ error: "Request body contains unknown fields." }, { status: 400 });
  }

  try {
    const result = await confirmKhlPlayerExtraBinding(prisma, {
      ...parsed,
      confirmedBy: "admin-session",
    } as ConfirmKhlPlayerExtraBindingInput);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof KhlPlayerExtraBindingError) {
      const status = error.code === "PLAYER_NOT_FOUND"
        ? 404
        : error.code === "INVALID_BINDING" ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[KHL player extra binding]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save KHL player extra binding." }, { status: 500 });
  }
}

async function parseBoundedJsonObject(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "Request body must be a valid JSON object." }, { status: 400 });
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return NextResponse.json({ error: "Request body could not be read." }, { status: 400 });
  }

  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be a valid JSON object." }, { status: 400 });
  }
}
