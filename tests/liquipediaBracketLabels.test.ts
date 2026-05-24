import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import {
  findLiquipediaBracketRoundLabel,
  isLikelyLiquipediaLayoutNoise,
} from "../src/lib/liquipedia/bracketLabels";

test("findLiquipediaBracketRoundLabel maps match R-number to bracket header", () => {
  const $ = cheerio.load(`
    <div class="brkts-bracket">
      <div class="brkts-round-header">
        <div class="brkts-header brkts-header-div">
          Upper Bracket Semifinals
          <div class="brkts-header-option">UB SF</div>
        </div>
        <div class="brkts-header brkts-header-div">
          Grand Final
          <div class="brkts-header-option">GF</div>
        </div>
      </div>
      <div class="brkts-round-body">
        <div class="brkts-round-center">
          <div class="brkts-match" id="m1">
            <a href="/counterstrike/index.php?title=Match:ID_TEST_R02-M001&amp;action=edit">details</a>
          </div>
        </div>
      </div>
    </div>
  `);

  assert.equal(findLiquipediaBracketRoundLabel($, $("#m1").get(0)), "Grand Final");
});

test("Liquipedia bracket label noise detects truncated match HTML comments", () => {
  assert.equal(
    isLikelyLiquipediaLayoutNoise('#8 #9 May 30, 2026 - 14:00 CEST #8 ( ) #9 Game 1 <div class="generic-label" data'),
    true,
  );
});
