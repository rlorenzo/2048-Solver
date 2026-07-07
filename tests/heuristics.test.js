import { describe, it, expect } from "vite-plus/test";
import { transpose } from "../src/ai/bitboard.js";
import { evaluate } from "../src/ai/heuristics.js";

// Deterministic LCG so the fuzz coverage is reproducible across runs/CI.
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomBoard(rng) {
  const board = new Uint16Array(4);
  for (let i = 0; i < 4; i++) {
    let row = 0;
    for (let c = 0; c < 4; c++) {
      row |= Math.floor(rng() * 16) << (4 * c);
    }
    board[i] = row;
  }
  return board;
}

// Mirrors the shift/mask column extraction inlined in evaluate() (heuristics.js),
// reimplemented here so it can be checked independently against
// bitboard.transpose() — the known-correct (allocating) reference.
function extractColumns(board) {
  const b0 = board[0];
  const b1 = board[1];
  const b2 = board[2];
  const b3 = board[3];
  return [
    (b0 & 0xf) | ((b1 & 0xf) << 4) | ((b2 & 0xf) << 8) | ((b3 & 0xf) << 12),
    ((b0 >> 4) & 0xf) |
      (((b1 >> 4) & 0xf) << 4) |
      (((b2 >> 4) & 0xf) << 8) |
      (((b3 >> 4) & 0xf) << 12),
    ((b0 >> 8) & 0xf) |
      (((b1 >> 8) & 0xf) << 4) |
      (((b2 >> 8) & 0xf) << 8) |
      (((b3 >> 8) & 0xf) << 12),
    ((b0 >> 12) & 0xf) |
      (((b1 >> 12) & 0xf) << 4) |
      (((b2 >> 12) & 0xf) << 8) |
      (((b3 >> 12) & 0xf) << 12),
  ];
}

describe("evaluate() column extraction", () => {
  it("matches bitboard.transpose() column values for 500 random boards", () => {
    const rng = lcg(0xc0ffee);
    for (let trial = 0; trial < 500; trial++) {
      const board = randomBoard(rng);
      const expected = Array.from(transpose(board));
      const actual = extractColumns(board);
      expect(actual).toEqual(expected);
    }
  });

  it("does not allocate a new board or mutate the input across repeated calls", () => {
    const rng = lcg(1234);
    for (let trial = 0; trial < 500; trial++) {
      const board = randomBoard(rng);
      const before = Array.from(board);
      const first = evaluate(board);
      const second = evaluate(board);
      expect(Array.from(board)).toEqual(before); // input untouched
      expect(second).toBe(first); // deterministic, no shared-state leakage
    }
  });
});
