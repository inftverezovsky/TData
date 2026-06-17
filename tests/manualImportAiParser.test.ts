import test from "node:test";
import assert from "node:assert/strict";
import { parseManualMatchesWithAi } from "../backend/src/manualImport/aiParser";

test("manual import parse mode text does not run OCR or AI", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  delete process.env.ARCCODEX_API_KEY;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "73",
      mode: "text",
      text: "not a schedule",
      imageBuffer: Buffer.from("not-an-image"),
      imageMime: "image/png",
    });

    assert.equal(result.ok, false);
    assert.equal(result.matches.length, 0);
    assert.equal(result.ocrText, undefined);
    assert.equal(result.parseSource, "local-text");
  } finally {
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});

test("manual import parse mode ai reuses OCR text without running OCR again", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  delete process.env.ARCCODEX_API_KEY;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "73",
      mode: "ai",
      text: "",
      ocrText: "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1",
      imageBuffer: Buffer.from("not-an-image"),
      imageMime: "image/png",
    });

    assert.equal(result.ok, true);
    assert.ok(result.matches.length >= 1);
    assert.equal(result.ocrText, "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1");
    assert.equal(result.parseSource, "fallback");
  } finally {
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});

test("manual import parse mode ai sends image to ArcCodex without local OCR first", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ARCCODEX_API_KEY = "test-key";
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          normalizedText: "NAVI vs Vitality 23.05.2026 18:00",
          matches: [
            {
              tournament: "Manual Import",
              team1: "NAVI",
              team2: "Vitality",
              date: "23.05.2026 18:00:00",
            },
          ],
        }),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "73",
      mode: "ai",
      imageBuffer: Buffer.from("not-an-image-but-ai-sees-data-url"),
      imageMime: "image/png",
    });

    assert.equal(fetchCalls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.parseSource, "ai");
    assert.equal(result.matches.length, 1);
    assert.equal(result.ocrText, "");
    assert.deepEqual(result.warnings, []);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});

test("manual import ai image cache hit does not call ArcCodex twice", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ARCCODEX_API_KEY = "test-key";
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          normalizedText: "Team Liquid vs G2 Esports 23.05.2026 16:10",
          matches: [
            {
              tournament: "Manual Import",
              team1: "Team Liquid",
              team2: "G2 Esports",
              date: "23.05.2026 16:10:00",
            },
          ],
        }),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const input = {
      disciplineSlug: "73",
      mode: "ai" as const,
      imageBuffer: Buffer.from("same-image-for-ai-cache"),
      imageMime: "image/png",
    };
    const first = await parseManualMatchesWithAi(input);
    const second = await parseManualMatchesWithAi(input);

    assert.equal(fetchCalls, 1);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(second.matches, first.matches);
    assert.equal(second.parseSource, "ai");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});

test("manual import fast ai image parse does not call chat fallback on primary 500", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ARCCODEX_API_KEY = "test-key";
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ error: { message: "temporary upstream failure" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "73",
      mode: "ai",
      fast: true,
      imageBuffer: Buffer.from("fast-failure-image"),
      imageMime: "image/png",
    });

    assert.equal(fetchCalls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.matches.length, 0);
    assert.equal(result.parseSource, "fallback");
    assert.equal(result.cacheHit, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});

test("manual import fast ai image parse handles empty successful AI output", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ARCCODEX_API_KEY = "test-key";
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        id: "resp_empty",
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [] }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "73",
      mode: "ai",
      fast: true,
      imageBuffer: Buffer.from("empty-ai-output-image"),
      imageMime: "image/jpeg",
    });

    assert.equal(fetchCalls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.matches.length, 0);
    assert.equal(result.parseSource, "fallback");
    assert.equal(result.error, "AI did not return valid JSON.");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});

test("manual import fast ai image parse handles non-json AI output without raw JSON errors", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ARCCODEX_API_KEY = "test-key";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "I cannot parse this image." }] }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "73",
      mode: "ai",
      fast: true,
      imageBuffer: Buffer.from("non-json-ai-output-image"),
      imageMime: "image/jpeg",
    });

    assert.equal(result.ok, false);
    assert.equal(result.parseSource, "fallback");
    assert.equal(result.error, "AI returned a non-JSON response.");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});

test("manual import ai image parse uses chat fallback only for unsupported primary endpoint", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ARCCODEX_API_KEY = "test-key";
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return new Response(JSON.stringify({ error: { message: "unsupported endpoint" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                normalizedText: "NAVI vs Vitality 23.05.2026 18:00",
                matches: [
                  {
                    tournament: "Manual Import",
                    team1: "NAVI",
                    team2: "Vitality",
                    date: "23.05.2026 18:00:00",
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "73",
      mode: "ai",
      fast: true,
      imageBuffer: Buffer.from("unsupported-primary-image"),
      imageMime: "image/png",
    });

    assert.equal(fetchCalls, 2);
    assert.equal(result.ok, true);
    assert.equal(result.parseSource, "ai");
    assert.equal(result.matches.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ARCCODEX_API_KEY;
    else process.env.ARCCODEX_API_KEY = previousApiKey;
  }
});
