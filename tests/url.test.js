import { describe, it, expect } from "vitest";
import { encodeMoves, decodeMoves, encodeState, decodeState } from "../src/share/url.js";

describe("encodeMoves / decodeMoves", () => {
  it("round-trips empty", () => {
    expect(decodeMoves(encodeMoves([]))).toEqual([]);
  });

  it("round-trips short sequences", () => {
    const seq = [0, 1, 2, 3, 0, 1];
    expect(decodeMoves(encodeMoves(seq))).toEqual(seq);
  });

  it("round-trips long random sequences", () => {
    const seq = [];
    for (let i = 0; i < 1000; i++) seq.push(Math.floor(Math.random() * 4));
    expect(decodeMoves(encodeMoves(seq))).toEqual(seq);
  });
});

describe("encodeState / decodeState", () => {
  it("round-trips seed + moves", () => {
    const s = { seed: 12345, moves: [0, 1, 2, 3], cursor: 4 };
    const hash = encodeState(s);
    const d = decodeState(hash);
    expect(d.seed).toBe(12345);
    expect(d.moves).toEqual([0, 1, 2, 3]);
    expect(d.cursor).toBe(4);
  });

  it("defaults cursor to end when omitted in URL", () => {
    const hash = encodeState({ seed: 1, moves: [0, 1], cursor: 2 });
    expect(hash).not.toContain("p=");
    const d = decodeState(hash);
    expect(d.cursor).toBe(2);
  });

  it("returns null for empty hash", () => {
    expect(decodeState("")).toBeNull();
    expect(decodeState("#")).toBeNull();
  });

  it("handles hash without moves", () => {
    const d = decodeState("#s=42");
    expect(d.seed).toBe(42);
    expect(d.moves).toEqual([]);
    expect(d.cursor).toBe(0);
  });
});
