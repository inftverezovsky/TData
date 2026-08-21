import assert from "node:assert/strict";
import test from "node:test";

import {
  loadKhlMatchWindow,
  shouldApplyKhlMatchWindow,
} from "../frontend/src/components/results/khl/khlMatchWindow";

type Match = { id: string };

test("refresh reloads every already-opened match page instead of collapsing to 100", async () => {
  const requestedOffsets: number[] = [];
  const result = await loadKhlMatchWindow<Match>(200, async (offset, limit) => {
    requestedOffsets.push(offset);
    const total = 250;
    const count = Math.min(limit, total - offset);
    return {
      matches: Array.from({ length: count }, (_, index) => ({ id: `match-${offset + index}` })),
      pagination: { offset, limit, total, hasMore: offset + count < total },
    };
  });

  assert.deepEqual(requestedOffsets, [0, 100]);
  assert.equal(result.matches.length, 200);
  assert.equal(result.hasMore, true);
  assert.equal(result.loadedDepth, 200);
});

test("window loader deduplicates a shifting page boundary and stops at the total", async () => {
  const result = await loadKhlMatchWindow<Match>(300, async (offset, limit) => {
    if (offset === 0) {
      return {
        matches: Array.from({ length: 100 }, (_, index) => ({ id: `match-${index}` })),
        pagination: { offset, limit, total: 150, hasMore: true },
      };
    }
    return {
      matches: Array.from({ length: 51 }, (_, index) => ({ id: `match-${99 + index}` })),
      pagination: { offset, limit, total: 150, hasMore: false },
    };
  });

  assert.equal(result.matches.length, 150);
  assert.equal(result.hasMore, false);
  assert.equal(result.loadedDepth, 150);
});

test("a late polling response cannot collapse a deeper load-more window", () => {
  assert.equal(shouldApplyKhlMatchWindow(100, 200), false);
  assert.equal(shouldApplyKhlMatchWindow(200, 200), true);
  assert.equal(shouldApplyKhlMatchWindow(300, 200), true);
});
