import { describe, it, expect } from "vite-plus/test";
import {
  DIR,
  emptyBoard,
  move,
  canMove,
  maxTile,
  emptyCells,
  spawn,
  initialBoard,
} from "../src/game/board.js";
import { mulberry32 } from "../src/game/rng.js";

function boardFrom(arr) {
  return new Uint8Array(arr);
}

describe("move()", () => {
  it("slides tiles left and merges equal adjacent", () => {
    const b = boardFrom([1, 1, 0, 0, 2, 0, 2, 0, 0, 3, 3, 0, 1, 2, 3, 4]);
    const r = move(b, DIR.LEFT);
    expect(Array.from(r.board)).toEqual([2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 1, 2, 3, 4]);
    // Merges (exp representation): row0 [1,1]->2 (gives 4), row1 [2,_,2]->3
    // (gives 8), row2 [_,3,3,_]->4 (gives 16), row3 unchanged. Total = 28.
    expect(r.score).toBe(28);
    expect(r.moved).toBe(true);
  });

  it("slides right correctly", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = move(b, DIR.RIGHT);
    expect(Array.from(r.board).slice(0, 4)).toEqual([0, 0, 0, 2]);
    expect(r.score).toBe(4);
  });

  it("slides up and down", () => {
    const b = boardFrom([1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]);
    const rUp = move(b, DIR.UP);
    expect(rUp.board[0]).toBe(2);
    expect(rUp.board[4]).toBe(3);
    expect(rUp.board[8]).toBe(0);

    const rDown = move(b, DIR.DOWN);
    expect(rDown.board[8]).toBe(2);
    expect(rDown.board[12]).toBe(3);
    expect(rDown.board[0]).toBe(0);
  });

  it("reports moved=false when nothing moves", () => {
    const b = boardFrom([2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2]);
    const r = move(b, DIR.LEFT);
    expect(r.moved).toBe(false);
    expect(r.score).toBe(0);
  });

  it("does not chain-merge in a single slide", () => {
    // [2,2,2,2] left -> [4,4,0,0], not [8,0,0,0]
    const b = boardFrom([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = move(b, DIR.LEFT);
    expect(Array.from(r.board).slice(0, 4)).toEqual([2, 2, 0, 0]);
    expect(r.score).toBe(8);
  });
});

describe("canMove()", () => {
  it("returns true when there is an empty cell", () => {
    const b = boardFrom([1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 0]);
    expect(canMove(b)).toBe(true);
  });

  it("returns true when adjacent tiles can merge", () => {
    const b = boardFrom([2, 1, 2, 1, 1, 1, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2]);
    expect(canMove(b)).toBe(true);
  });

  it("returns false on a sealed board", () => {
    const b = boardFrom([2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2]);
    expect(canMove(b)).toBe(false);
  });
});

describe("spawn + initialBoard", () => {
  it("produces deterministic spawns from the same seed", () => {
    const a = initialBoard(mulberry32(42));
    const b = initialBoard(mulberry32(42));
    expect(Array.from(a.board)).toEqual(Array.from(b.board));
    expect(a.spawns).toEqual(b.spawns);
  });

  it("places exactly two tiles initially, each 2 or 4", () => {
    const { board } = initialBoard(mulberry32(1));
    const empties = emptyCells(board);
    expect(empties.length).toBe(14);
    for (let i = 0; i < 16; i++) {
      const v = board[i];
      if (v !== 0) expect([1, 2]).toContain(v);
    }
  });

  it("spawn returns null on a full board", () => {
    const b = emptyBoard();
    for (let i = 0; i < 16; i++) b[i] = 1;
    expect(spawn(b, mulberry32(1))).toBeNull();
  });
});

describe("maxTile()", () => {
  it("returns 0 on empty board", () => {
    expect(maxTile(emptyBoard())).toBe(0);
  });
  it("returns 2^max(exp)", () => {
    const b = boardFrom([1, 0, 0, 0, 0, 5, 0, 0, 0, 0, 11, 0, 0, 0, 0, 3]);
    expect(maxTile(b)).toBe(2048);
  });
});
