// Row-based evaluation adapted from nneonneo/2048-ai.
// Precomputed lookup table: for every possible 4-cell row (4 bits per cell,
// 65536 entries), store the heuristic score. evaluate() becomes 8 table
// lookups per board (4 rows + 4 columns) — no per-call Math.pow.

const SCORE_LOST_PENALTY = 200000.0;
const SCORE_MONOTONICITY_POWER = 4.0;
const SCORE_MONOTONICITY_WEIGHT = 47.0;
const SCORE_SUM_POWER = 3.5;
const SCORE_SUM_WEIGHT = 11.0;
const SCORE_MERGES_WEIGHT = 700.0;
const SCORE_EMPTY_WEIGHT = 270.0;

// Rank 0..15 (game never goes above 65536 realistically)
const POW_MONO = new Float64Array(16);
const POW_SUM = new Float64Array(16);
for (let i = 0; i < 16; i++) {
  POW_MONO[i] = Math.pow(i, SCORE_MONOTONICITY_POWER);
  POW_SUM[i] = Math.pow(i, SCORE_SUM_POWER);
}

function computeLineScore(r0, r1, r2, r3) {
  const ranks = [r0, r1, r2, r3];
  let empty = 0;
  let merges = 0;
  let sum = 0;
  let prev = 0;
  let counter = 0;
  for (const r of ranks) {
    if (r === 0) {
      empty++;
    } else {
      sum += POW_SUM[r];
      if (r === prev) {
        counter++;
      } else if (counter > 0) {
        merges += 1 + counter;
        counter = 0;
      }
      prev = r;
    }
  }
  if (counter > 0) merges += 1 + counter;

  let monoLeft = 0;
  let monoRight = 0;
  for (let i = 1; i < 4; i++) {
    const a = ranks[i - 1];
    const b = ranks[i];
    if (a > b) monoLeft += POW_MONO[a] - POW_MONO[b];
    else monoRight += POW_MONO[b] - POW_MONO[a];
  }

  return (
    SCORE_LOST_PENALTY +
    SCORE_EMPTY_WEIGHT * empty +
    SCORE_MERGES_WEIGHT * merges -
    SCORE_MONOTONICITY_WEIGHT * Math.min(monoLeft, monoRight) -
    SCORE_SUM_WEIGHT * sum
  );
}

// Precompute scores for all 65536 possible rows.
const ROW_SCORE = new Float64Array(65536);
for (let i = 0; i < 65536; i++) {
  const r0 = i & 0xf;
  const r1 = (i >> 4) & 0xf;
  const r2 = (i >> 8) & 0xf;
  const r3 = (i >> 12) & 0xf;
  ROW_SCORE[i] = computeLineScore(r0, r1, r2, r3);
}

export function evaluate(b) {
  // Rows
  const r0 = b[0] | (b[1] << 4) | (b[2] << 8) | (b[3] << 12);
  const r1 = b[4] | (b[5] << 4) | (b[6] << 8) | (b[7] << 12);
  const r2 = b[8] | (b[9] << 4) | (b[10] << 8) | (b[11] << 12);
  const r3 = b[12] | (b[13] << 4) | (b[14] << 8) | (b[15] << 12);
  // Columns
  const c0 = b[0] | (b[4] << 4) | (b[8] << 8) | (b[12] << 12);
  const c1 = b[1] | (b[5] << 4) | (b[9] << 8) | (b[13] << 12);
  const c2 = b[2] | (b[6] << 4) | (b[10] << 8) | (b[14] << 12);
  const c3 = b[3] | (b[7] << 4) | (b[11] << 8) | (b[15] << 12);
  return (
    ROW_SCORE[r0] +
    ROW_SCORE[r1] +
    ROW_SCORE[r2] +
    ROW_SCORE[r3] +
    ROW_SCORE[c0] +
    ROW_SCORE[c1] +
    ROW_SCORE[c2] +
    ROW_SCORE[c3]
  );
}
