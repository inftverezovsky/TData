import test from "node:test";
import assert from "node:assert/strict";
import { readManualImportParseRequest } from "../src/lib/manualImport/parseRequest";

test("readManualImportParseRequest accepts multipart image and text", async () => {
  const formData = new FormData();
  formData.append("disciplineSlug", " CounterStrike ");
  formData.append("disciplineId", "73");
  formData.append("text", "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1");
  formData.append("image", new File([Buffer.from("fake-png")], "schedule.png", { type: "image/png" }));

  const request = new Request("http://localhost/api/manual-import/parse", {
    method: "POST",
    body: formData,
  });

  const parsed = await readManualImportParseRequest(request);
  assert.equal(parsed.disciplineSlug, "counterstrike");
  assert.equal(parsed.disciplineId, "73");
  assert.equal(parsed.text, "Team Liquid\nG2 Esports\n23 May, 16:10 | Table 1");
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
      imageDataUrl: "data:image/png;base64,AA==",
    }),
  });

  const parsed = await readManualImportParseRequest(request);
  assert.equal(parsed.disciplineSlug, "valorant");
  assert.equal(parsed.disciplineId, "91");
  assert.equal(parsed.text, "16:10 Alpha vs Beta");
  assert.equal(parsed.imageDataUrl, "data:image/png;base64,AA==");
});
