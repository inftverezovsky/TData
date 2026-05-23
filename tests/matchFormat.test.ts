import test from "node:test";
import assert from "node:assert/strict";
import { getBestOfLabel } from "../src/lib/matches/format";

test("getBestOfLabel normalizes known map-count formats", () => {
  assert.equal(getBestOfLabel("bo1"), "BO1");
  assert.equal(getBestOfLabel("BO 3"), "BO3");
  assert.equal(getBestOfLabel("bo3 © 9z"), "BO3");
  assert.equal(getBestOfLabel("Best of 5"), "BO5");
  assert.equal(getBestOfLabel("best-of-three"), "BO3");
  assert.equal(getBestOfLabel("3"), "BO3");
});

test("getBestOfLabel ignores non-map tournament formats", () => {
  assert.equal(getBestOfLabel("Round robin"), null);
  assert.equal(getBestOfLabel("Group Stage"), null);
  assert.equal(getBestOfLabel(null), null);
});
