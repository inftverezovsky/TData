import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { parseHltvCopiedText } from "../backend/src/sources/tdata/hltv/manualTextParser";
import { extractManualImportOcr, shutdownManualImportOcrWorker } from "../backend/src/manualImport/ocrPipeline";

test("OCR rejects an AVIF/HEIF container even when its MIME claims PNG", async () => {
  const imageBuffer = Buffer.from("00000018667479706176696600000000617669666d696631", "hex");

  const result = await extractManualImportOcr({ imageBuffer, imageMime: "image/png" });

  assert.deepEqual(result.variants, []);
  assert.equal(result.text, "");
  assert.deepEqual(result.warnings, ["Для OCR поддерживаются только изображения PNG, JPEG и WebP."]);
});

test("OCR rejects unsupported bytes in a data URL before native image decoding", async () => {
  const imageDataUrl = `data:image/png;base64,${Buffer.from("unsupported-image").toString("base64")}`;

  const result = await extractManualImportOcr({ imageDataUrl });

  assert.deepEqual(result.variants, []);
  assert.deepEqual(result.warnings, ["Для OCR поддерживаются только изображения PNG, JPEG и WebP."]);
});

test("OCR hides native decoder diagnostics for a corrupt supported image", async () => {
  const result = await extractManualImportOcr({
    imageBuffer: Buffer.from("89504e470d0a1a0a00000000", "hex"), imageMime: "image/png",
  });
  assert.deepEqual(result.variants, []);
  assert.deepEqual(result.warnings, ["Не удалось подготовить изображение. Проверьте файл и повторите импорт."]);
});

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
