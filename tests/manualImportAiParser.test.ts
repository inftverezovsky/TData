import test from "node:test";
import assert from "node:assert/strict";
import { parseManualMatchesWithAi } from "../src/lib/manualImport/aiParser";

test("manual import parse mode text does not run OCR or AI", async () => {
  const previousApiKey = process.env.ARCCODEX_API_KEY;
  delete process.env.ARCCODEX_API_KEY;

  try {
    const result = await parseManualMatchesWithAi({
      disciplineSlug: "counterstrike",
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
      disciplineSlug: "counterstrike",
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
