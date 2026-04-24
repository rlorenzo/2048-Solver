// Bitboard representation for fast expectimax.
//
// The 4×4 board is stored as a Uint16Array of length 4. Each element is a
// "row": 16 bits packing 4 cells, each cell 4 bits holding the log2(value)
// (0 = empty, 1 = tile "2", 2 = tile "4", …, 11 = tile "2048", up to 15).
// Cell at column c of a row lives in bits [4c, 4c+4).
//
// All moves reduce to a row-slide operation, applied via precomputed lookup
// tables. UP/DOWN do the column equivalent by extracting columns into row-
// sized integers, looking up the slide, then scattering back.

import { DIR } from "../game/constants.js";

export { DIR };

// --- Slide a single 4-cell row to the left (toward column 0).
// Given a row as [c0, c1, c2, c3], slide non-zero cells left, merging equal
// adjacent cells exactly once per pair. Returns [newRow, scoreGained].
function slideLeft(cells) {
  const out = [0, 0, 0, 0];
  let score = 0;
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < 4; i++) {
    const v = cells[i];
    if (v === 0) continue;
    if (prev === v) {
      // Saturate at 0xf (exp 15 = tile 32768) so merging two 15s doesn't
      // wrap to 0 when packed into a 4-bit nibble by packRow(). Score still
      // reflects the true merged exponent even when stored cells saturate.
      const mergedExp = v + 1;
      const merged = Math.min(mergedExp, 0xf);
      out[idx - 1] = merged;
      score += 2 ** mergedExp;
      prev = 0;
    } else {
      out[idx] = v;
      prev = v;
      idx++;
    }
  }
  return [out, score];
}

// --- Precompute row transition tables (65536 entries each).
const ROW_LEFT = new Uint16Array(65536);
const ROW_RIGHT = new Uint16Array(65536);
const ROW_LEFT_SCORE = new Float64Array(65536);
const ROW_RIGHT_SCORE = new Float64Array(65536);

function reverseRow(r) {
  return ((r & 0xf) << 12) | (((r >> 4) & 0xf) << 8) | (((r >> 8) & 0xf) << 4) | ((r >> 12) & 0xf);
}

function packRow(cells) {
  return (
    (cells[0] & 0xf) | ((cells[1] & 0xf) << 4) | ((cells[2] & 0xf) << 8) | ((cells[3] & 0xf) << 12)
  );
}

for (let r = 0; r < 65536; r++) {
  const cells = [r & 0xf, (r >> 4) & 0xf, (r >> 8) & 0xf, (r >> 12) & 0xf];
  const [nc, s] = slideLeft(cells);
  ROW_LEFT[r] = packRow(nc);
  ROW_LEFT_SCORE[r] = s;
}
// RIGHT = reverse → slide left → reverse
for (let r = 0; r < 65536; r++) {
  const rev = reverseRow(r);
  ROW_RIGHT[r] = reverseRow(ROW_LEFT[rev]);
  ROW_RIGHT_SCORE[r] = ROW_LEFT_SCORE[rev];
}

// --- Transpose: rows ↔ columns. Treats the board as a 4x4 nibble grid.
export function transpose(board) {
  const out = new Uint16Array(4);
  // Column c of input (cell bits at offset 4c inside each row) becomes row c
  // of output (each row-i cell lives at nibble offset 4i).
  for (let c = 0; c < 4; c++) {
    out[c] =
      ((board[0] >> (4 * c)) & 0xf) |
      (((board[1] >> (4 * c)) & 0xf) << 4) |
      (((board[2] >> (4 * c)) & 0xf) << 8) |
      (((board[3] >> (4 * c)) & 0xf) << 12);
  }
  return out;
}

// --- Moves. Each returns a new board (Uint16Array(4)) plus score + moved flag.

function moveLeft(board) {
  const out = new Uint16Array(4);
  let score = 0;
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const r = board[i];
    const nr = ROW_LEFT[r];
    out[i] = nr;
    if (nr !== r) moved = true;
    score += ROW_LEFT_SCORE[r];
  }
  return { board: out, score, moved };
}

function moveRight(board) {
  const out = new Uint16Array(4);
  let score = 0;
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const r = board[i];
    const nr = ROW_RIGHT[r];
    out[i] = nr;
    if (nr !== r) moved = true;
    score += ROW_RIGHT_SCORE[r];
  }
  return { board: out, score, moved };
}

function moveUp(board) {
  // Slide each column toward row 0. Transpose, moveLeft, transpose back.
  const t = transpose(board);
  const { board: moved_t, score, moved } = moveLeft(t);
  return { board: transpose(moved_t), score, moved };
}

function moveDown(board) {
  const t = transpose(board);
  const { board: moved_t, score, moved } = moveRight(t);
  return { board: transpose(moved_t), score, moved };
}

export function bitMove(board, dir) {
  switch (dir) {
    case DIR.LEFT:
      return moveLeft(board);
    case DIR.RIGHT:
      return moveRight(board);
    case DIR.UP:
      return moveUp(board);
    case DIR.DOWN:
      return moveDown(board);
    default:
      throw new Error("bad dir");
  }
}

// --- Helpers on bitboards

function cloneBoard(b) {
  return new Uint16Array(b);
}

export function getCell(board, pos) {
  const row = pos >> 2;
  const col = pos & 3;
  return (board[row] >> (4 * col)) & 0xf;
}

// --- Helpers exported for tests; not used in production code paths. ---

export function setCellInPlace(board, pos, exp) {
  const row = pos >> 2;
  const col = pos & 3;
  board[row] = (board[row] & ~(0xf << (4 * col))) | ((exp & 0xf) << (4 * col));
}

export function withCell(board, pos, exp) {
  const out = cloneBoard(board);
  setCellInPlace(out, pos, exp);
  return out;
}

// --- End test-only helpers. ---

export function countEmpty(board) {
  let n = 0;
  for (let i = 0; i < 4; i++) {
    let r = board[i];
    if ((r & 0xf) === 0) n++;
    if (((r >> 4) & 0xf) === 0) n++;
    if (((r >> 8) & 0xf) === 0) n++;
    if (((r >> 12) & 0xf) === 0) n++;
  }
  return n;
}

export function bitCanMove(board) {
  if (countEmpty(board) > 0) return true;
  // Adjacent equals in rows
  for (let i = 0; i < 4; i++) {
    const r = board[i];
    if ((r & 0xf) === ((r >> 4) & 0xf)) return true;
    if (((r >> 4) & 0xf) === ((r >> 8) & 0xf)) return true;
    if (((r >> 8) & 0xf) === ((r >> 12) & 0xf)) return true;
  }
  // Adjacent equals in columns
  for (let c = 0; c < 4; c++) {
    const mask = 0xf << (4 * c);
    if ((board[0] & mask) === (board[1] & mask)) return true;
    if ((board[1] & mask) === (board[2] & mask)) return true;
    if ((board[2] & mask) === (board[3] & mask)) return true;
  }
  return false;
}

// --- Conversion to/from the UI's Uint8Array(16) board representation
// (which stores log2(value) directly at cell-index positions).

// Convert Uint8Array(16) board (log2 values at positions 0–15, row-major)
// into Uint16Array(4) bitboard (4-bit cells packed left-to-right per row).
// Position i maps to row i>>2, column i&3, nibble offset 4*(i&3).
// Exponents above 15 (tiles above 32768) are clamped to 15 because the
// 4-bit nibble format can't represent them. The AI will treat 65536+ tiles
// as 32768 — slightly inaccurate but keeps AI usable in extreme late-game.
export function fromBytes(bytes) {
  const out = new Uint16Array(4);
  for (let i = 0; i < 16; i++) {
    const v = Math.min(bytes[i], 0xf);
    const row = i >> 2; // which row (0–3)
    const col = i & 3; // which column (0–3)
    out[row] |= v << (4 * col); // pack into 4-bit nibble
  }
  return out;
}

// Inverse of fromBytes: unpack bitboard into Uint8Array(16).
export function toBytes(board) {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = getCell(board, i);
  }
  return out;
}

// Hash a bitboard into a single 64-bit-like key (pair of uint32s, packed into
// a string). Used for transposition tables.
export function keyOf(board) {
  return `${board[0]}|${board[1]}|${board[2]}|${board[3]}`;
}
