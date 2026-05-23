import test from "node:test";
import assert from "node:assert/strict";
import { readManualImportParseRequest } from "../src/lib/manualImport/parseRequest";

test("readManualImportParseRequest accepts multipart image and text", async () => {
  const formData = new FormData();
  formData.append("disciplineSlug", " CounterStrike ");
  formData.append("disciplineId", "73");
  formData.append("text", "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1");
  formData.append("fast", "true");
  formData.append("image", new File([Buffer.from("fake-png")], "schedule.png", { type: "image/png" }));

  const request = new Request("http://localhost/api/manual-import/parse", {
    method: "POST",
    body: formData,
  });

  const parsed = await readManualImportParseRequest(request);
  assert.equal(parsed.disciplineSlug, "73");
  assert.equal(parsed.disciplineId, "73");
  assert.equal(parsed.text, "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1");
  assert.equal(parsed.ocrText, "");
  assert.equal(parsed.mode, "auto");
  assert.equal(parsed.fast, true);
  assert.equal(parsed.imageMime, "image/png");
  assert.equal(parsed.imageBuffer?.toString(), "fake-png");
});

test("readManualImportParseRequest keeps JSON imageDataUrl compatibility", async () => {
  const request = new Request("http://localhost/api/manual-import/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      disciplineSlug: "valorant",
      disciplineId: 91,
      text: "16:10 Alpha vs Beta",
      ocrText: "Alpha\nBeta",
      imageDataUrl: "data:image/png;base64,AA==",
      mode: "ai",
      fast: true,
    }),
  });

  const parsed = await readManualImportParseRequest(request);
  assert.equal(parsed.disciplineSlug, "91");
  assert.equal(parsed.disciplineId, "91");
  assert.equal(parsed.text, "16:10 Alpha vs Beta");
  assert.equal(parsed.ocrText, "Alpha\nBeta");
  assert.equal(parsed.imageDataUrl, "data:image/png;base64,AA==");
  assert.equal(parsed.mode, "ai");
  assert.equal(parsed.fast, true);
});

test("readManualImportParseRequest keeps legacy slug only when discipline ID is absent", async () => {
  const request = new Request("http://localhost/api/manual-import/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      disciplineSlug: "dota2",
      mode: "text",
    }),
  });

  const parsed = await readManualImportParseRequest(request);
  assert.equal(parsed.disciplineSlug, "dota2");
  assert.equal(parsed.disciplineId, "");
});

test("readManualImportParseRequest falls back to auto for unknown mode", async () => {
  const request = new Request("http://localhost/api/manual-import/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      disciplineSlug: "dota2",
      mode: "slow",
    }),
  });

  const parsed = await readManualImportParseRequest(request);
  assert.equal(parsed.mode, "auto");
  assert.equal(parsed.fast, false);
});
