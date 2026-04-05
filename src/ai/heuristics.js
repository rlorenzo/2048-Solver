// Board evaluation heuristics for 2048 expectimax.
// Board is Uint8Array(16) storing log2(value).
// All scores are additive; higher = better.

// Precomputed row heuristics for speed. Each row (4 cells × 4 bits each)
// is treated as a 16-bit key; we precompute monotonicity, smoothness, empty
// count, and max merge score per row.
//
// Rather than full table precomputation (2^16 entries), we compute on demand
// — Uint8Array board means each cell is 0..15 realistically, so rows are
// bounded but table would be ~65k entries × 4 metrics. We'll keep it simple
// and compute per-call; it's still fast enough for depth 6 expectimax.

const WEIGHT_EMPTY = 270.0;
const WEIGHT_MONO = 47.0;
const WEIGHT_SMOOTH = 10.0;
const WEIGHT_MAX = 1.0;
const WEIGHT_CORNER = 20.0;

// Snake-like weight matrix to reward stacking large tiles in one corner
// (top-left) monotonically decreasing.
// prettier-ignore
const SNAKE_WEIGHTS = new Float64Array([
  15, 14, 13, 12,
   8,  9, 10, 11,
   7,  6,  5,  4,
   0,  1,  2,  3,
]);

export function evaluate(b) {
  let empty = 0;
  let maxTile = 0;
  let mono = 0;
  let smooth = 0;
  let corner = 0;

  for (let i = 0; i < 16; i++) {
    const v = b[i];
    if (v === 0) empty++;
    if (v > maxTile) maxTile = v;
    if (v > 0) corner += v * SNAKE_WEIGHTS[i];
  }

  // Monotonicity: penalize non-monotonic rows and columns.
  // For each line, measure the "cost" of going up vs down; take the minimum.
  for (let r = 0; r < 4; r++) {
    let up = 0;
    let down = 0;
    for (let c = 0; c < 3; c++) {
      const cur = b[r * 4 + c];
      const next = b[r * 4 + c + 1];
      if (cur > next) down += next - cur;
      else up += cur - next;
    }
    mono += Math.max(up, down);
  }
  for (let c = 0; c < 4; c++) {
    let up = 0;
    let down = 0;
    for (let r = 0; r < 3; r++) {
      const cur = b[r * 4 + c];
      const next = b[(r + 1) * 4 + c];
      if (cur > next) down += next - cur;
      else up += cur - next;
    }
    mono += Math.max(up, down);
  }

  // Smoothness: adjacent tiles should be close in log value.
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = b[r * 4 + c];
      if (v === 0) continue;
      if (c < 3 && b[r * 4 + c + 1] !== 0) {
        smooth -= Math.abs(v - b[r * 4 + c + 1]);
      }
      if (r < 3 && b[(r + 1) * 4 + c] !== 0) {
        smooth -= Math.abs(v - b[(r + 1) * 4 + c]);
      }
    }
  }

  return (
    WEIGHT_EMPTY * empty +
    WEIGHT_MONO * mono +
    WEIGHT_SMOOTH * smooth +
    WEIGHT_MAX * maxTile +
    WEIGHT_CORNER * corner
  );
}
