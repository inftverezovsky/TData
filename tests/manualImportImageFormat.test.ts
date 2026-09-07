import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { isSupportedOcrImage } from "../backend/src/manualImport/imageFormat";

test("OCR signature policy accepts PNG, JPEG and WebP generated images", async () => {
  const raster = sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } });
  for (const format of ["png", "jpeg", "webp"] as const) {
    const input = await raster.clone().toFormat(format).toBuffer();
    assert.equal(isSupportedOcrImage(input), true, format);
  }
});

test("OCR signature policy rejects HEIF, SVG, GIF, truncated and unrelated RIFF input", () => {
  for (const input of [
    Buffer.alloc(0),
    Buffer.from([0xff, 0xd8]),
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    Buffer.from("GIF89a"),
    Buffer.from("00000018667479706865696300000000686569636d696631", "hex"),
    Buffer.from("RIFF0000WAVEfmt "),
    Buffer.from("RIFF0000WEBP????"),
    Buffer.from("RIFF0000WEBP"),
  ]) {
    assert.equal(isSupportedOcrImage(input), false);
  }
});
