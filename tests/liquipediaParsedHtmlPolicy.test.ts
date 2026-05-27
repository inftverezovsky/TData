import test from "node:test";
import assert from "node:assert/strict";
import { shouldFetchParsedHtmlForDiscipline } from "../src/lib/config/env";

test("Liquipedia import always fetches parsed HTML for disciplines that need generated schedules", () => {
  assert.equal(shouldFetchParsedHtmlForDiscipline("valorant", true), true);
  assert.equal(shouldFetchParsedHtmlForDiscipline("leagueoflegends", true), true);
  assert.equal(shouldFetchParsedHtmlForDiscipline("counterstrike", true), false);
  assert.equal(shouldFetchParsedHtmlForDiscipline("dota2", false), true);
});
