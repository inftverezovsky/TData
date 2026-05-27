import { NextResponse } from "next/server";
import { ARCCODEX_RESPONSES_URL, MANUAL_IMPORT_AI_TIMEOUT_MS, MANUAL_IMPORT_MODEL } from "@/lib/manualImport/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const apiKey = process.env.ARCCODEX_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      status: "missing_key",
      message: "ARCCODEX_API_KEY не задан, поэтому ArcCodex недоступен.",
    }, { status: 503 });
  }

  try {
    const startedAt = Date.now();
    const response = await fetch(ARCCODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(Math.min(MANUAL_IMPORT_AI_TIMEOUT_MS, 15_000)),
      body: JSON.stringify({
        model: MANUAL_IMPORT_MODEL,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Ответь только словом ok" }],
          },
        ],
        max_output_tokens: 8,
      }),
    });

    const bodyText = await response.text();
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        status: "api_error",
        httpStatus: response.status,
        latencyMs,
        message: bodyText.slice(0, 500) || "ArcCodex вернул ошибку.",
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      status: "online",
      latencyMs,
      message: "ArcCodex API отвечает.",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: "request_failed",
      message: error instanceof Error ? error.message : "Проверка ArcCodex не удалась.",
    }, { status: 502 });
  }
}
