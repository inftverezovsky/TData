import assert from "node:assert/strict";
import test from "node:test";
import { importFandomTournament } from "../src/lib/importSources/fandom";

test("Fandom importer is scoped to League of Legends", async () => {
  await assert.rejects(
    importFandomTournament({
      slug: "valorant",
      disciplineId: "discipline",
      title: "Parser Cup",
      pageUrl: "https://lol.fandom.com/wiki/Parser_Cup",
    }),
    /League of Legends/,
  );
});
