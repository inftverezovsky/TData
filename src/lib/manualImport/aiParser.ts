import { parseHltvCopiedText } from "@/lib/hltv/manualTextParser";
import { ARCCODEX_CHAT_COMPLETIONS_URL, ARCCODEX_RESPONSES_URL, MANUAL_IMPORT_MODEL } from "./config";
import type { ManualImportRawMatch } from "./buildManualFixtPayload";
import { resolve } from "node:path";
import type { Worker } from "tesseract.js";

type AiParseInput = {
  text?: string;
  imageDataUrl?: string;
  disciplineSlug: string;
};

type AiParseResult = {
  ok: boolean;
  matches: ManualImportRawMatch[];
  normalizedText?: string;
  error?: string;
  fallback?: boolean;
};

let ocrWorkerPromise: Promise<Worker> | null = null;

export async function parseManualMatchesWithAi(input: AiParseInput): Promise<AiParseResult> {
  if (input.text?.trim()) {
    const directMatches = parseHltvCopiedText(input.text);
    if (directMatches.length > 0) {
      return {
        ok: true,
        matches: directMatches,
        fallback: true,
        normalizedText: input.text,
      };
    }
  }

  const apiKey = process.env.ARCCODEX_API_KEY;
  if (!apiKey) {
    return fallbackParse(input, "ARCCODEX_API_KEY is not configured.");
  }

  try {
    const response = await fetch(ARCCODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildResponsesPayload(input)),
    });

    const bodyText = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    if (!response.ok) {
      return parseManualMatchesWithChatCompletions(input, apiKey, body?.error?.message || bodyText || "AI parse request failed.");
    }

    const outputText = extractResponsesText(body);
    const parsed = parseAiJson(outputText);
    if (!parsed.matches.length) {
      return fallbackParse(input, "AI did not return matches.");
    }

    return {
      ok: true,
      matches: parsed.matches,
      normalizedText: parsed.normalizedText || outputText,
    };
  } catch (error) {
    return parseManualMatchesWithChatCompletions(input, apiKey, error instanceof Error ? error.message : "AI parse request failed.");
  }
}

async function parseManualMatchesWithChatCompletions(
  input: AiParseInput,
  apiKey: string,
  previousError: string
): Promise<AiParseResult> {
  try {
    const response = await fetch(ARCCODEX_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatCompletionsPayload(input)),
    });

    const bodyText = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    if (!response.ok) {
      return fallbackParse(input, body?.error?.message || bodyText || previousError);
    }

    const outputText = body?.choices?.[0]?.message?.content || "";
    const parsed = parseAiJson(outputText);
    if (!parsed.matches.length) {
      return fallbackParse(input, "AI did not return matches.");
    }

    return {
      ok: true,
      matches: parsed.matches,
      normalizedText: parsed.normalizedText || outputText,
    };
  } catch (error) {
    return fallbackParse(input, error instanceof Error ? error.message : previousError);
  }
}

function buildResponsesPayload(input: AiParseInput) {
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
        `Discipline slug: ${input.disciplineSlug}.`,
        input.text ? `Raw text:\n${input.text}` : "",
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

function buildChatCompletionsPayload(input: AiParseInput) {
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
        `Discipline slug: ${input.disciplineSlug}.`,
        input.text ? `Raw text:\n${input.text}` : "",
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

async function fallbackParse(input: AiParseInput, error: string): Promise<AiParseResult> {
  const candidates: string[] = [];

  if (input.text && input.text.trim()) {
    candidates.push(input.text);
  }

  if (input.imageDataUrl) {
    const ocrText = await extractTextFromImage(input.imageDataUrl);
    if (ocrText.trim()) {
      candidates.push(ocrText);
    }
  }

  for (const candidate of candidates) {
    const matches = parseHltvCopiedText(candidate);
    if (matches.length > 0) {
      return {
        ok: true,
        matches,
        fallback: true,
        normalizedText: candidate,
        error,
      };
    }
  }

  return {
    ok: false,
    matches: [],
    fallback: true,
    normalizedText: candidates[0] || input.text || "",
    error,
  };
}

async function extractTextFromImage(imageDataUrl: string) {
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(imageDataUrl);
    return typeof result?.data?.text === "string" ? result.data.text : "";
  } catch {
    ocrWorkerPromise = null;
    return "";
  }
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createOcrWorker();
  }

  return ocrWorkerPromise;
}

async function createOcrWorker() {
  const { createWorker } = await import("tesseract.js");
  return createWorker(["rus", "eng"], 1, {
    langPath: resolve(process.cwd(), "data", "tessdata").replace(/\\/g, "/"),
    cachePath: resolve(process.cwd(), ".tesseract-cache").replace(/\\/g, "/"),
    gzip: false,
  });
}
