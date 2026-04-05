// Core 2048 game logic. Pure functions — no mutation of inputs.
// Board represented as Uint8Array of length 16, storing log2(value), 0 = empty.
// So value 2 -> 1, value 4 -> 2, ..., 2048 -> 11.

import { DIR, DIR_NAMES } from "./constants.js";

export { DIR, DIR_NAMES };

export const SIZE = 4;
export const CELLS = SIZE * SIZE;

export function emptyBoard() {
  return new Uint8Array(CELLS);
}

export function cloneBoard(b) {
  return new Uint8Array(b);
}

export function boardEquals(a, b) {
  for (let i = 0; i < CELLS; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function valueAt(b, i) {
  return b[i] === 0 ? 0 : 1 << b[i];
}

export function maxTile(b) {
  let m = 0;
  for (let i = 0; i < CELLS; i++) if (b[i] > m) m = b[i];
  return m === 0 ? 0 : 1 << m;
}

export function emptyCells(b) {
  const out = [];
  for (let i = 0; i < CELLS; i++) if (b[i] === 0) out.push(i);
  return out;
}

// Slide + merge a single row to the LEFT. Returns [newRow, scoreGained].
function slideRowLeft(row) {
  const out = [0, 0, 0, 0];
  let score = 0;
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < 4; i++) {
    const v = row[i];
    if (v === 0) continue;
    if (prev === v) {
      out[idx - 1] = v + 1;
      score += 1 << (v + 1);
      prev = 0;
    } else {
      out[idx] = v;
      prev = v;
      idx++;
    }
  }
  return [out, score];
}

// Apply a move in the given direction. Returns
// { board, score, moved } — a NEW board if moved, else original.
export function move(board, dir) {
  const b = board;
  const out = new Uint8Array(CELLS);
  let score = 0;
  let moved = false;

  // We extract rows in the direction we're sliding TOWARD,
  // slide left, then write back.
  for (let line = 0; line < 4; line++) {
    const row = [0, 0, 0, 0];
    // Read indices in the current direction
    for (let k = 0; k < 4; k++) {
      row[k] = b[readIndex(dir, line, k)];
    }
    const [newRow, s] = slideRowLeft(row);
    score += s;
    for (let k = 0; k < 4; k++) {
      const idx = readIndex(dir, line, k);
      out[idx] = newRow[k];
      if (newRow[k] !== row[k]) moved = true;
    }
  }

  return { board: moved ? out : b, score, moved };
}

// Map (direction, line, positionAlongSlide) -> flat board index.
// We always "slide toward the start" of the axis, so position 0 is where tiles end up.
function readIndex(dir, line, k) {
  switch (dir) {
    case DIR.LEFT: // rows, reading left->right (start at col 0)
      return line * 4 + k;
    case DIR.RIGHT: // rows, reading right->left
      return line * 4 + (3 - k);
    case DIR.UP: // columns, reading top->bottom
      return k * 4 + line;
    case DIR.DOWN: // columns, reading bottom->top
      return (3 - k) * 4 + line;
    default:
      throw new Error("bad dir");
  }
}

export function canMove(b) {
  for (let i = 0; i < CELLS; i++) if (b[i] === 0) return true;
  // adjacent equal?
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = b[r * 4 + c];
      if (c < 3 && b[r * 4 + c + 1] === v) return true;
      if (r < 3 && b[(r + 1) * 4 + c] === v) return true;
    }
  }
  return false;
}

export function anyMoveChanges(b) {
  for (let d = 0; d < 4; d++) {
    if (move(b, d).moved) return true;
  }
  return false;
}

// Spawn a tile (value 2 or 4) into an empty cell using the provided rng().
// Returns { board, spawn: { pos, exp } } or null if no space.
export function spawn(board, rng) {
  const empties = emptyCells(board);
  if (empties.length === 0) return null;
  const pos = empties[Math.floor(rng() * empties.length)];
  const exp = rng() < 0.9 ? 1 : 2; // 90% -> 2, 10% -> 4
  const out = cloneBoard(board);
  out[pos] = exp;
  return { board: out, spawn: { pos, exp } };
}

export function initialBoard(rng) {
  let b = emptyBoard();
  const a = spawn(b, rng);
  b = a.board;
  const c = spawn(b, rng);
  return { board: c.board, spawns: [a.spawn, c.spawn] };
}
