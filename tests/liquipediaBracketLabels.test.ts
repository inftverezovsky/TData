import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import {
  findLiquipediaBracketRoundLabel,
  isLikelyLiquipediaLayoutNoise,
} from "../backend/src/sources/tdata/liquipedia/bracketLabels";

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

test("findLiquipediaBracketRoundLabel maps direct final center to the last multi-round header", () => {
  const $ = cheerio.load(`
    <div class="brkts-bracket">
      <div class="brkts-round-header">
        <div class="brkts-header brkts-header-div">Upper Bracket Quarterfinals</div>
        <div class="brkts-header brkts-header-div">Upper Bracket Semifinals</div>
        <div class="brkts-header brkts-header-div">Upper Bracket Final</div>
        <div class="brkts-header brkts-header-div">Grand Final</div>
      </div>
      <div class="brkts-round-body">
        <div class="brkts-round-lower">
          <div class="brkts-round-body">
            <div class="brkts-round-center">
              <div class="brkts-match" id="nested-match"></div>
            </div>
          </div>
        </div>
        <div class="brkts-round-lower-connectors"></div>
        <div class="brkts-round-center">
          <div class="brkts-match" id="grand-final">
            <a href="/leagueoflegends/Match:ID_TEST_R05-M001" title="Match:ID TEST R05-M001">details</a>
          </div>
        </div>
      </div>
    </div>
  `);

  assert.equal(findLiquipediaBracketRoundLabel($, $("#grand-final").get(0)), "Grand Final");
  assert.equal(findLiquipediaBracketRoundLabel($, $("#nested-match").get(0)), null);
});

test("Liquipedia bracket label noise detects truncated match HTML comments", () => {
  assert.equal(
    isLikelyLiquipediaLayoutNoise('#8 #9 May 30, 2026 - 14:00 CEST #8 ( ) #9 Game 1 <div class="generic-label" data'),
    true,
  );
});
