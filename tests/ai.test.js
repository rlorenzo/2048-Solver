import { describe, it, expect } from "vite-plus/test";
import { fromBytes } from "../src/ai/bitboard.js";
import { bestMove } from "../src/ai/expectimax.js";
import { evaluate } from "../src/ai/heuristics.js";

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
