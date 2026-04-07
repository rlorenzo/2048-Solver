import { describe, it, expect } from "vite-plus/test";
import { move as byteMove, canMove as byteCanMove } from "../src/game/board.js";
import {
  DIR,
  fromBytes,
  toBytes,
  move as bitMove,
  canMove as bitCanMove,
  countEmpty,
  getCell,
  setCellInPlace,
  withCell,
  transpose,
} from "../src/ai/bitboard.js";

describe("bitboard conversions", () => {
  it("round-trips fromBytes/toBytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 0, 0, 0, 15]);
    const round = toBytes(fromBytes(bytes));
    expect(Array.from(round)).toEqual(Array.from(bytes));
  });

  it("getCell reads cells back", () => {
    const bits = fromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0]));
    for (let i = 0; i < 16; i++) {
      expect(getCell(bits, i)).toBe(i === 15 ? 0 : i + 1);
    }
  });

  it("setCellInPlace and withCell mutate correctly", () => {
    const bits = fromBytes(new Uint8Array(16));
    setCellInPlace(bits, 5, 7);
    expect(getCell(bits, 5)).toBe(7);
    const b2 = withCell(bits, 10, 3);
    expect(getCell(b2, 10)).toBe(3);
    expect(getCell(bits, 10)).toBe(0); // withCell doesn't mutate original
  });

  it("transpose swaps rows and columns", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0]);
    const bits = fromBytes(bytes);
    const t = transpose(bits);
    const tBytes = toBytes(t);
    // Row r, col c in original = row c, col r in transposed
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(tBytes[c * 4 + r]).toBe(bytes[r * 4 + c]);
      }
    }
  });

  it("transpose is self-inverse", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0]);
    const bits = fromBytes(bytes);
    const back = transpose(transpose(bits));
    expect(Array.from(back)).toEqual(Array.from(bits));
  });
});

describe("bitboard vs byte move parity (differential)", () => {
  function randBoard(rng) {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 8);
    }
    return bytes;
  }

  // deterministic PRNG for the test
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      return (a & 0xffffff) / 0x1000000;
    };
  }

  it("produces identical results across 2000 random positions × 4 dirs", () => {
    const r = rng(0xbad5eed);
    let diffs = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const bytes = randBoard(r);
      const bits = fromBytes(bytes);
      for (let d = 0; d < 4; d++) {
        const a = byteMove(bytes, d);
        const b = bitMove(bits, d);
        if (a.score !== b.score || a.moved !== b.moved) diffs++;
        const bBytes = toBytes(b.board);
        for (let i = 0; i < 16; i++) if (a.board[i] !== bBytes[i]) diffs++;
      }
      if (byteCanMove(bytes) !== bitCanMove(bits)) diffs++;
    }
    expect(diffs).toBe(0);
  });
});

describe("bitboard misc", () => {
  it("countEmpty counts zero cells", () => {
    const bytes = new Uint8Array([0, 1, 0, 2, 3, 0, 0, 4, 0, 5, 6, 0, 7, 0, 0, 0]);
    const bits = fromBytes(bytes);
    expect(countEmpty(bits)).toBe(9);
  });

  it("keeps true merge score when saturated tiles combine", () => {
    const bytes = new Uint8Array([15, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const moved = bitMove(fromBytes(bytes), DIR.LEFT);
    expect(moved.score).toBe(65536);
    expect(toBytes(moved.board)[0]).toBe(15);
  });

  it("DIR constants are distinct", () => {
    const ds = new Set(Object.values(DIR));
    expect(ds.size).toBe(4);
  });
});
