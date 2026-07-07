import { describe, it, expect } from "vite-plus/test";
import { fromBytes } from "../src/ai/bitboard.js";
import { bestMove, adaptiveDepth } from "../src/ai/expectimax.js";
import { evaluate } from "../src/ai/heuristics.js";

// Builds a bitboard with exactly `empties` empty cells (rest filled with
// non-empty, non-mergeable-adjacent exponent-1 tiles isn't required here —
// adaptiveDepth only cares about countEmpty(), not board legality).
function boardWithEmpties(empties) {
  const bytes = new Uint8Array(16).fill(1);
  for (let i = 0; i < empties; i++) bytes[i] = 0;
  return fromBytes(bytes);
}

describe("heuristics.evaluate", () => {
  it("prefers boards with stacked monotonic corners", () => {
    const good = fromBytes(new Uint8Array([7, 6, 5, 4, 3, 4, 3, 2, 2, 3, 2, 1, 0, 0, 0, 0]));
    const bad = fromBytes(new Uint8Array([7, 0, 5, 0, 0, 4, 0, 2, 3, 0, 2, 0, 0, 6, 0, 1]));
    expect(evaluate(good)).toBeGreaterThan(evaluate(bad));
  });

  it("prefers more empties over alternating-tile clutter (no merge potential)", () => {
    const sparse = fromBytes(new Uint8Array([4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const cluttered = fromBytes(new Uint8Array([4, 3, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2]));
    expect(evaluate(sparse)).toBeGreaterThan(evaluate(cluttered));
  });
});

describe("bestMove", () => {
  it("returns a valid direction when moves exist", () => {
    const bits = fromBytes(new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const { dir } = bestMove(bits, 3);
    expect(dir).toBeGreaterThanOrEqual(0);
    expect(dir).toBeLessThanOrEqual(3);
  });

  it("returns -1 when no moves are possible", () => {
    // Fully sealed board
    const bits = fromBytes(new Uint8Array([2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2]));
    const { dir } = bestMove(bits, 3);
    expect(dir).toBe(-1);
  });

  it("respects fixed depth parameter", () => {
    const bits = fromBytes(new Uint8Array([1, 2, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const res = bestMove(bits, 4);
    expect(res.depth).toBe(4);
  });
});

describe("adaptiveDepth", () => {
  it("passes through a fixed numeric depth untouched, regardless of board", () => {
    expect(adaptiveDepth(boardWithEmpties(0), 5)).toBe(5);
    expect(adaptiveDepth(boardWithEmpties(15), 2)).toBe(2);
  });

  it("returns 8 when 3 or fewer empties remain (danger zone)", () => {
    expect(adaptiveDepth(boardWithEmpties(0), "auto")).toBe(8);
    expect(adaptiveDepth(boardWithEmpties(1), "auto")).toBe(8);
    expect(adaptiveDepth(boardWithEmpties(3), "auto")).toBe(8);
  });

  it("returns 7 when between 4 and 6 empties remain", () => {
    expect(adaptiveDepth(boardWithEmpties(4), "auto")).toBe(7);
    expect(adaptiveDepth(boardWithEmpties(6), "auto")).toBe(7);
  });

  it("returns 6 when more than 6 empties remain (early game)", () => {
    expect(adaptiveDepth(boardWithEmpties(7), "auto")).toBe(6);
    expect(adaptiveDepth(boardWithEmpties(15), "auto")).toBe(6);
  });
});
