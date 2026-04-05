import { describe, it, expect } from "vite-plus/test";
import { encodeMoves, decodeMoves, encodeState, decodeState } from "../src/share/url.js";

describe("encodeMoves / decodeMoves", () => {
  it("round-trips empty", () => {
    expect(decodeMoves(encodeMoves([]))).toEqual([]);
  });

  it("round-trips short sequences", () => {
    const seq = [0, 1, 2, 3, 0, 1];
    expect(decodeMoves(encodeMoves(seq))).toEqual(seq);
  });

  it("round-trips long pseudo-random sequences deterministically", () => {
    // Deterministic PRNG so failures reproduce across runs.
    let a = 0xdead_beef;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      return a & 3;
    };
    const seq = [];
    for (let i = 0; i < 1000; i++) seq.push(next());
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

  it("clamps cursor to [0, moves.length]", () => {
    const hash = encodeState({ seed: 1, moves: [0, 1, 2], cursor: 1 });
    // Manually craft out-of-range cursor
    const highCursor = hash.replace("p=1", "p=999");
    expect(decodeState(highCursor).cursor).toBe(3);
    const negCursor = hash.replace("p=1", "p=-5");
    expect(decodeState(negCursor).cursor).toBe(0);
  });

  it("rejects absurd move counts to prevent DoS", () => {
    // Craft a string claiming an enormous length
    const bogus = "A.zzzzzzz";
    expect(decodeMoves(bogus)).toEqual([]);
  });

  it("rejects garbage seeds", () => {
    expect(decodeState("#s=notanumber")).toBeNull();
  });

  it("rejects partial-number seeds (e.g. 123abc)", () => {
    expect(decodeState("#s=123abc")).toBeNull();
  });

  it("rejects seeds outside uint32 range", () => {
    expect(decodeState("#s=99999999999")).toBeNull();
  });

  it("rejects oversized base64 payload with tiny declared length", () => {
    // A huge base64 prefix paired with a length claiming only 4 moves should
    // be rejected before we spend time decoding the payload.
    const longB64 = "A".repeat(10000);
    expect(decodeMoves(longB64 + ".4")).toEqual([]);
  });

  it("rejects base64 with invalid characters", () => {
    // "@" is outside the alphabet
    expect(decodeMoves("@@@@.4")).toEqual([]);
  });
});
