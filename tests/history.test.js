import { describe, it, expect } from "vite-plus/test";
import { History } from "../src/game/history.js";

function makeBoard(seed) {
  const b = new Uint8Array(16);
  b[0] = seed;
  return b;
}

describe("History", () => {
  it("tracks cursor and depth", () => {
    const h = new History(makeBoard(1));
    expect(h.depth()).toBe(0);
    h.record(0, makeBoard(2), 4, { pos: 1, exp: 1 });
    h.record(1, makeBoard(3), 8, { pos: 2, exp: 1 });
    expect(h.depth()).toBe(2);
    expect(h.current().score).toBe(8);
  });

  it("stepBack and stepForward", () => {
    const h = new History(makeBoard(1));
    h.record(0, makeBoard(2), 4, null);
    h.record(1, makeBoard(3), 8, null);
    h.stepBack();
    expect(h.depth()).toBe(1);
    h.stepBack();
    expect(h.depth()).toBe(0);
    expect(h.stepBack()).toBe(false);
    h.stepForward();
    expect(h.depth()).toBe(1);
  });

  it("stepForward replays the last-visited branch", () => {
    const h = new History(makeBoard(1));
    h.record(0, makeBoard(2), 4, null);
    const forkId = h.current().id;

    h.record(1, makeBoard(3), 8, null);
    const rightId = h.current().id;

    h.jumpTo(forkId);
    h.record(2, makeBoard(4), 12, null);
    const downId = h.current().id;

    h.stepBack();
    expect(h.current().id).toBe(forkId);
    h.stepForward();
    expect(h.current().id).toBe(downId);

    h.stepBack();
    h.jumpTo(rightId);
    h.stepBack();
    h.stepForward();
    expect(h.current().id).toBe(rightId);
  });

  it("creates new branch when cursor is rewound and a different dir is played", () => {
    const h = new History(makeBoard(1));
    h.record(0, makeBoard(2), 4, null); // branch A, move UP
    h.record(1, makeBoard(3), 8, null); // continue A
    h.stepBack(); // back to node after UP
    expect(h.siblings().length).toBe(1);
    h.record(2, makeBoard(9), 12, null); // play DOWN — creates sibling
    expect(h.siblings().length).toBe(2);
  });

  it("reuses identical-spawn child on replay", () => {
    const h = new History(makeBoard(1));
    const spawnA = { pos: 3, exp: 1 };
    const childId = h.record(0, makeBoard(2), 4, spawnA);
    h.stepBack();
    // Replaying the same move+spawn: reuse existing child
    const reused = h.record(0, makeBoard(2), 4, { pos: 3, exp: 1 });
    expect(reused).toBe(childId);
  });

  it("movesFromRoot returns directions along path", () => {
    const h = new History(makeBoard(1));
    h.record(0, makeBoard(2), 0, null);
    h.record(1, makeBoard(3), 0, null);
    h.record(2, makeBoard(4), 0, null);
    expect(h.movesFromRoot()).toEqual([0, 1, 2]);
  });

  it("branchPointsOnPath identifies forks", () => {
    const h = new History(makeBoard(1));
    h.record(0, makeBoard(2), 0, null);
    const forkNodeId = h.current().id;
    h.record(1, makeBoard(3), 0, null);
    h.jumpTo(forkNodeId);
    h.record(2, makeBoard(4), 0, null); // fork: node at depth 1 now has 2 children
    // The current path is [root, depth1, depth2-via-DOWN]. The depth-2 node
    // should be flagged as a branch point (its parent has >1 child).
    const bp = h.branchPointsOnPath();
    expect(bp.length).toBe(1);
  });
});
