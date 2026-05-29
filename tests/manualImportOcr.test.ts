import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { parseHltvCopiedText } from "../src/lib/sources/TCyber/hltv/manualTextParser";
import { extractManualImportOcr, shutdownManualImportOcrWorker } from "../src/lib/manualImport/ocrPipeline";

test("extractManualImportOcr reads a generated schedule image", async () => {
  const svg = `
<svg width="900" height="260" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>
  <text x="40" y="60" font-family="Arial" font-size="32" fill="black">Team Liquid</text>
  <text x="40" y="105" font-family="Arial" font-size="32" fill="black">G2 Esports</text>
  <text x="40" y="150" font-family="Arial" font-size="30" fill="black">23 May, 16:10 | Table 1</text>
  <text x="40" y="205" font-family="Arial" font-size="32" fill="black">NAVI vs FaZe Clan 18:30</text>
</svg>`;

  try {
    const imageBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const ocr = await extractManualImportOcr({ imageBuffer, imageMime: "image/png" });
    const matches = parseHltvCopiedText(ocr.text);

    assert.equal(ocr.warnings.length, 0);
    assert.equal(ocr.cached, undefined);
    assert.ok((ocr.confidence || 0) > 60);
    assert.ok(ocr.text.includes("Team Liquid"));
    assert.ok(matches.length >= 2);
    assert.equal(ocr.variants.length, 1);
    assert.ok(matches.some((match) => match.date === "23.05.2026 16:10:00"));
    assert.ok(matches.some((match) => match.date === "23.05.2026 18:30:00"));

    const cachedOcr = await extractManualImportOcr({ imageBuffer, imageMime: "image/png" });
    assert.equal(cachedOcr.cached, true);
    assert.equal(cachedOcr.text, ocr.text);
  } finally {
    await shutdownManualImportOcrWorker();
  }
});
