import { parseHltvCopiedText } from "@/lib/hltv/manualTextParser";
import { createHash } from "node:crypto";
import { ARCCODEX_CHAT_COMPLETIONS_URL, ARCCODEX_RESPONSES_URL, MANUAL_IMPORT_AI_TIMEOUT_MS, MANUAL_IMPORT_MODEL } from "./config";
import type { ManualImportRawMatch } from "./buildManualFixtPayload";
import { extractManualImportOcr, type ManualImportOcrResult } from "./ocrPipeline";
import type { ManualImportParseMode } from "./parseRequest";

type AiParseInput = {
  text?: string;
  ocrText?: string;
  imageDataUrl?: string;
  imageBuffer?: Buffer;
  imageMime?: string;
  disciplineSlug: string;
  mode?: ManualImportParseMode;
  fast?: boolean;
};

type AiParseResult = {
  ok: boolean;
  matches: ManualImportRawMatch[];
  normalizedText?: string;
  ocrText?: string;
  ocrConfidence?: number | null;
  parseSource?: "local-text" | "local-ocr" | "ocr-cache" | "ai" | "fallback";
  warnings?: string[];
  error?: string;
  fallback?: boolean;
  cacheHit?: boolean;
  timings?: {
    aiMs?: number;
  };
};

type AiImageCacheEntry = {
  matches: ManualImportRawMatch[];
  normalizedText: string;
  expiresAt: number;
};

const AI_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_AI_IMAGE_CACHE_ENTRIES = 30;
const aiImageCache = new Map<string, AiImageCacheEntry>();

export async function parseManualMatchesWithAi(input: AiParseInput): Promise<AiParseResult> {
  const warnings: string[] = [];
  const mode = input.mode || "auto";
  const rawText = input.text?.trim() || "";
  const suppliedOcrText = input.ocrText?.trim() || "";
  const textCandidates = [rawText, suppliedOcrText].filter(Boolean);

  if (mode === "text") {
    const candidate = textCandidates[0] || "";
    const directMatches = candidate ? parseHltvCopiedText(candidate) : [];
    if (directMatches.length > 0) {
      return {
        ok: true,
        matches: directMatches,
        fallback: true,
        normalizedText: candidate,
        parseSource: "local-text",
        warnings,
        cacheHit: false,
      };
    }

    return {
      ok: false,
      matches: [],
      fallback: true,
      normalizedText: candidate,
      parseSource: "local-text",
      warnings: candidate ? ["Локальный парсер не нашёл матчей в тексте."] : warnings,
      error: "Матчи не распознаны локальным парсером.",
      cacheHit: false,
    };
  }

  if (mode !== "ai" && rawText) {
    const directMatches = parseHltvCopiedText(rawText);
    if (directMatches.length > 0) {
      return {
        ok: true,
        matches: directMatches,
        fallback: true,
        normalizedText: rawText,
        parseSource: "local-text",
        warnings,
        cacheHit: false,
      };
    }
  }

  let ocrResult: ManualImportOcrResult | null = null;
  if (mode === "auto" && (input.imageDataUrl || input.imageBuffer?.length)) {
    ocrResult = await extractManualImportOcr({
      imageDataUrl: input.imageDataUrl,
      imageBuffer: input.imageBuffer,
      imageMime: input.imageMime,
    });
    warnings.push(...ocrResult.warnings);

    if (ocrResult.text.trim()) {
      const ocrMatches = parseHltvCopiedText(ocrResult.text);
      if (ocrMatches.length > 0) {
        return {
          ok: true,
          matches: ocrMatches,
          fallback: true,
          normalizedText: ocrResult.text,
          ocrText: ocrResult.text,
          ocrConfidence: ocrResult.confidence,
          parseSource: ocrResult.cached ? "ocr-cache" : "local-ocr",
          warnings,
          cacheHit: Boolean(ocrResult.cached),
        };
      }
    }
  }

  if (mode !== "ai" && input.text?.trim()) {
    warnings.push("Локальный парсер не нашёл матчей в тексте.");
  }

  if (ocrResult?.text.trim()) {
    warnings.push("OCR-текст извлечён, но локальный парсер не смог собрать матчи.");
  }

  const apiKey = process.env.ARCCODEX_API_KEY;
  if (!apiKey) {
    return fallbackParse(
      { ...input, mode, ocrText: suppliedOcrText || ocrResult?.text || "" },
      "ARCCODEX_API_KEY is not configured.",
      ocrResult,
      warnings
    );
  }

  const aiInput = {
    ...input,
    mode,
    ocrText: suppliedOcrText || ocrResult?.text || "",
    imageDataUrl: input.imageDataUrl || imageBufferToDataUrl(input.imageBuffer, input.imageMime),
  };
  const aiImageCacheKey = getAiImageCacheKey(aiInput, rawText, suppliedOcrText);
  if (aiImageCacheKey) {
    const cached = getCachedAiImageParse(aiImageCacheKey);
    if (cached) {
      return {
        ok: true,
        matches: cloneMatches(cached.matches),
        normalizedText: cached.normalizedText,
        ocrText: suppliedOcrText || ocrResult?.text || "",
        ocrConfidence: ocrResult?.confidence ?? null,
        parseSource: "ai",
        warnings,
        cacheHit: true,
        timings: { aiMs: 0 },
      };
    }
  }

  try {
    const aiStartedAt = Date.now();
    const response = await fetch(ARCCODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(MANUAL_IMPORT_AI_TIMEOUT_MS),
      body: JSON.stringify(buildResponsesPayload(aiInput)),
    });
    const aiMs = Date.now() - aiStartedAt;

    const bodyText = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    if (!response.ok) {
      if (!shouldUseChatCompletionsFallback(response.status, bodyText, body)) {
        return fallbackParse(aiInput, body?.error?.message || bodyText || "AI parse request failed.", ocrResult, warnings, {
          aiMs,
        });
      }

      return parseManualMatchesWithChatCompletions(
        aiInput,
        apiKey,
        body?.error?.message || bodyText || "AI parse request failed.",
        ocrResult,
        warnings,
        aiImageCacheKey,
        aiMs
      );
    }

    const outputText = extractResponsesText(body);
    const parsed = parseAiJson(outputText);
    if (!parsed.matches.length) {
      return fallbackParse(aiInput, "AI did not return matches.", ocrResult, warnings, { aiMs });
    }

    if (aiImageCacheKey) {
      setCachedAiImageParse(aiImageCacheKey, parsed);
    }

    return {
      ok: true,
      matches: parsed.matches,
      normalizedText: parsed.normalizedText || outputText,
      ocrText: ocrResult?.text || suppliedOcrText || "",
      ocrConfidence: ocrResult?.confidence ?? null,
      parseSource: "ai",
      warnings,
      cacheHit: false,
      timings: { aiMs },
    };
  } catch (error) {
    if (input.fast) {
      return fallbackParse(
        aiInput,
        error instanceof Error ? error.message : "AI parse request failed.",
        ocrResult,
        warnings
      );
    }

    return parseManualMatchesWithChatCompletions(
      aiInput,
      apiKey,
      error instanceof Error ? error.message : "AI parse request failed.",
      ocrResult,
      warnings,
      aiImageCacheKey
    );
  }
}

async function parseManualMatchesWithChatCompletions(
  input: AiParseInput & { ocrText?: string; mode?: ManualImportParseMode },
  apiKey: string,
  previousError: string,
  ocrResult: ManualImportOcrResult | null,
  warnings: string[],
  aiImageCacheKey = "",
  previousAiMs = 0
): Promise<AiParseResult> {
  try {
    const aiStartedAt = Date.now();
    const response = await fetch(ARCCODEX_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(MANUAL_IMPORT_AI_TIMEOUT_MS),
      body: JSON.stringify(buildChatCompletionsPayload(input)),
    });
    const aiMs = previousAiMs + Date.now() - aiStartedAt;

    const bodyText = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    if (!response.ok) {
      return fallbackParse(input, body?.error?.message || bodyText || previousError, ocrResult, warnings, { aiMs });
    }

    const outputText = body?.choices?.[0]?.message?.content || "";
    const parsed = parseAiJson(outputText);
    if (!parsed.matches.length) {
      return fallbackParse(input, "AI did not return matches.", ocrResult, warnings, { aiMs });
    }

    if (aiImageCacheKey) {
      setCachedAiImageParse(aiImageCacheKey, parsed);
    }

    return {
      ok: true,
      matches: parsed.matches,
      normalizedText: parsed.normalizedText || outputText,
      ocrText: ocrResult?.text || input.ocrText || "",
      ocrConfidence: ocrResult?.confidence ?? null,
      parseSource: "ai",
      warnings,
      cacheHit: false,
      timings: { aiMs },
    };
  } catch (error) {
    return fallbackParse(input, error instanceof Error ? error.message : previousError, ocrResult, warnings);
  }
}

function buildResponsesPayload(input: AiParseInput & { ocrText?: string; mode?: ManualImportParseMode }) {
  const content: any[] = [
    {
      type: "input_text",
      text: [
        "Extract esports match fixtures from the provided screenshot or text.",
        "The image may be a table-like schedule where two participant names appear before each time/table line.",
        "If you see lines like 'DD month, HH:mm | Table N', pair the two names above that line into one match.",
        "Return only valid JSON with this shape:",
        '{"matches":[{"tournament":"string","team1":"string","team2":"string","date":"DD.MM.YYYY HH:mm:ss"}],"normalizedText":"string"}',
        "Dates must be Moscow time. If the source gives YYYY-MM-DD and HH:mm, convert to DD.MM.YYYY HH:mm:ss.",
        "Do not include completed match scores. Keep team names clean and remove OCR artifacts.",
        input.text ? `Raw text:\n${input.text}` : "",
        input.ocrText ? `Local OCR text:\n${input.ocrText}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  if (input.imageDataUrl) {
    content.push({
      type: "input_image",
      image_url: input.imageDataUrl,
    });
  }

  return {
    model: MANUAL_IMPORT_MODEL,
    input: [
      {
        role: "user",
        content,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "manual_matches",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            normalizedText: { type: "string" },
            matches: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  tournament: { type: "string" },
                  team1: { type: "string" },
                  team2: { type: "string" },
                  date: { type: "string" },
                },
                required: ["tournament", "team1", "team2", "date"],
              },
            },
          },
          required: ["normalizedText", "matches"],
        },
      },
    },
  };
}

function buildChatCompletionsPayload(input: AiParseInput & { ocrText?: string; mode?: ManualImportParseMode }) {
  const content: any[] = [
    {
      type: "text",
      text: [
        "Extract esports match fixtures from the provided screenshot or text.",
        "The image may be a table-like schedule where two participant names appear before each time/table line.",
        "If you see lines like 'DD month, HH:mm | Table N', pair the two names above that line into one match.",
        "Return only valid JSON with this shape:",
        '{"matches":[{"tournament":"string","team1":"string","team2":"string","date":"DD.MM.YYYY HH:mm:ss"}],"normalizedText":"string"}',
        "Dates must be Moscow time. If the source gives YYYY-MM-DD and HH:mm, convert to DD.MM.YYYY HH:mm:ss.",
        "Do not include completed match scores. Keep team names clean and remove OCR artifacts.",
        input.text ? `Raw text:\n${input.text}` : "",
        input.ocrText ? `Local OCR text:\n${input.ocrText}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  if (input.imageDataUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: input.imageDataUrl,
      },
    });
  }

  return {
    model: MANUAL_IMPORT_MODEL,
    messages: [
      {
        role: "user",
        content,
      },
    ],
    response_format: { type: "json_object" },
  };
}

function extractResponsesText(body: any) {
  if (typeof body?.output_text === "string") return body.output_text;

  const fragments: string[] = [];
  const output = Array.isArray(body?.output) ? body.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") fragments.push(part.text);
      if (typeof part?.json === "object") fragments.push(JSON.stringify(part.json));
    }
  }

  return fragments.join("\n").trim();
}

function parseAiJson(text: string): { matches: ManualImportRawMatch[]; normalizedText: string } {
  const raw = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const data = JSON.parse(raw);
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  return {
    matches: matches.filter((match: any) => match && typeof match === "object"),
    normalizedText: typeof data?.normalizedText === "string" ? data.normalizedText : "",
  };
}

async function fallbackParse(
  input: AiParseInput & { ocrText?: string; mode?: ManualImportParseMode },
  error: string,
  ocrResult: ManualImportOcrResult | null,
  warnings: string[],
  timings?: AiParseResult["timings"]
): Promise<AiParseResult> {
  const candidates: string[] = [];

  if (input.text && input.text.trim()) {
    candidates.push(input.text);
  }

  if (input.ocrText?.trim()) {
    candidates.push(input.ocrText);
  }

  let finalOcrResult = ocrResult;
  const directCandidate = parseFirstCandidate(candidates);
  if (directCandidate) {
    return {
      ok: true,
      matches: directCandidate.matches,
      fallback: true,
      normalizedText: directCandidate.text,
      ocrText: finalOcrResult?.text || input.ocrText || "",
      ocrConfidence: finalOcrResult?.confidence ?? null,
      parseSource: "fallback",
      warnings,
      error,
      cacheHit: false,
      timings,
    };
  }

  if (!finalOcrResult && input.mode === "auto" && (input.imageDataUrl || input.imageBuffer?.length)) {
    finalOcrResult = await extractManualImportOcr({
      imageDataUrl: input.imageDataUrl,
      imageBuffer: input.imageBuffer,
      imageMime: input.imageMime,
    });
    warnings.push(...finalOcrResult.warnings);
    if (finalOcrResult.text.trim()) {
      candidates.push(finalOcrResult.text);
    }
  }

  const fallbackCandidate = parseFirstCandidate(candidates);
  if (fallbackCandidate) {
    return {
      ok: true,
      matches: fallbackCandidate.matches,
      fallback: true,
      normalizedText: fallbackCandidate.text,
      ocrText: finalOcrResult?.text || input.ocrText || "",
      ocrConfidence: finalOcrResult?.confidence ?? null,
      parseSource: "fallback",
      warnings,
      error,
      cacheHit: false,
      timings,
    };
  }

  return {
    ok: false,
    matches: [],
    fallback: true,
    normalizedText: candidates[0] || input.text || "",
    ocrText: finalOcrResult?.text || input.ocrText || "",
    ocrConfidence: finalOcrResult?.confidence ?? null,
    parseSource: "fallback",
    warnings,
    error,
    cacheHit: false,
    timings,
  };
}

function shouldUseChatCompletionsFallback(status: number, bodyText: string, body: any) {
  const message = String(body?.error?.message || bodyText || "").toLowerCase();
  return (
    status === 404 ||
    status === 405 ||
    message.includes("unsupported") ||
    message.includes("not supported") ||
    message.includes("unknown endpoint")
  );
}

function imageBufferToDataUrl(buffer?: Buffer, mime?: string) {
  if (!buffer?.length) return "";
  const safeMime = mime?.startsWith("image/") ? mime : "image/png";
  return `data:${safeMime};base64,${buffer.toString("base64")}`;
}

function parseFirstCandidate(candidates: string[]) {
  for (const candidate of candidates) {
    const matches = parseHltvCopiedText(candidate);
    if (matches.length > 0) {
      return { text: candidate, matches };
    }
  }
  return null;
}

function getAiImageCacheKey(input: AiParseInput & { imageDataUrl?: string }, rawText: string, suppliedOcrText: string) {
  if (input.mode !== "ai" || !input.imageDataUrl || rawText || suppliedOcrText) return "";
  return `${input.disciplineSlug}:${createHash("sha256").update(input.imageDataUrl).digest("hex")}`;
}

function getCachedAiImageParse(key: string) {
  const entry = aiImageCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    aiImageCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedAiImageParse(key: string, parsed: { matches: ManualImportRawMatch[]; normalizedText: string }) {
  cleanupAiImageCache();
  aiImageCache.set(key, {
    matches: cloneMatches(parsed.matches),
    normalizedText: parsed.normalizedText,
    expiresAt: Date.now() + AI_IMAGE_CACHE_TTL_MS,
  });
}

function cleanupAiImageCache() {
  const now = Date.now();
  for (const [key, entry] of aiImageCache) {
    if (entry.expiresAt < now) aiImageCache.delete(key);
  }

  while (aiImageCache.size >= MAX_AI_IMAGE_CACHE_ENTRIES) {
    const oldestKey = aiImageCache.keys().next().value;
    if (!oldestKey) break;
    aiImageCache.delete(oldestKey);
  }
}

function cloneMatches(matches: ManualImportRawMatch[]) {
  return matches.map((match) => ({ ...match }));
}
