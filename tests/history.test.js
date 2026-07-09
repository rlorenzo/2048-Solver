import { describe, it, expect } from "vite-plus/test";
import { History } from "../src/game/history.js";

function makeBoard(seed) {
  const b = new Uint8Array(16);
  b[0] = seed;
  return b;
}

// Build a fresh History and record a sequence of moves. Each move uses
// makeBoard(i+2) as the resulting board (so boards differ per step) and
// `scoreFn(i)` for its score. Returns the History.
function historyWith(dirs, scoreFn = () => 0) {
  const h = new History(makeBoard(1));
  for (let i = 0; i < dirs.length; i++) {
    h.record(dirs[i], makeBoard(i + 2), scoreFn(i), null);
  }
  return h;
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
    const h = historyWith([0, 1], (i) => 4 * (i + 1));
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
    // branch A: UP then RIGHT
    const h = historyWith([0, 1], (i) => 4 * (i + 1));
    h.stepBack(); // back to node after UP
    expect(h.current().children.size).toBe(1);
    h.record(2, makeBoard(9), 12, null); // play DOWN — creates sibling
    h.stepBack(); // record advanced the cursor to the new child
    expect(h.current().children.size).toBe(2);
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

  it("preferredPathFromRoot includes future nodes on the visible branch", () => {
    const h = historyWith([0, 1, 2]);
    h.stepBack();
    h.stepBack();

    const visible = h.preferredPathFromRoot();
    expect(visible.map((node) => node.dir)).toEqual([null, 0, 1, 2]);
    expect(h.current().dir).toBe(0);
  });
});
