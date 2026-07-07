// Row-based evaluation on the bitboard representation. Adapted from
// nneonneo/2048-ai. 65536-entry row score table; evaluate() does 8 lookups.

const SCORE_LOST_PENALTY = 200000.0;
const SCORE_MONOTONICITY_POWER = 4.0;
const SCORE_MONOTONICITY_WEIGHT = 47.0;
const SCORE_SUM_POWER = 3.5;
const SCORE_SUM_WEIGHT = 11.0;
const SCORE_MERGES_WEIGHT = 700.0;
const SCORE_EMPTY_WEIGHT = 270.0;

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

const ROW_SCORE = new Float64Array(65536);
for (let i = 0; i < 65536; i++) {
  const r0 = i & 0xf;
  const r1 = (i >> 4) & 0xf;
  const r2 = (i >> 8) & 0xf;
  const r3 = (i >> 12) & 0xf;
  ROW_SCORE[i] = computeLineScore(r0, r1, r2, r3);
}

// Evaluate a bitboard (Uint16Array(4)). Sum of row scores + column scores.
//
// Column values are extracted directly with shifts/masks (same technique as
// countEmpty/bitCanMove in bitboard.js) instead of calling transpose(), which
// would allocate a new Uint16Array(4) on every call — evaluate() runs at
// every search leaf, so that allocation was a hot-path cost worth avoiding.
export function evaluate(board) {
  const b0 = board[0];
  const b1 = board[1];
  const b2 = board[2];
  const b3 = board[3];

  // Column c of the board (cell bits at offset 4c inside each row) becomes a
  // row-sized packed value, identical to what transpose(board)[c] would hold.
  const t0 = (b0 & 0xf) | ((b1 & 0xf) << 4) | ((b2 & 0xf) << 8) | ((b3 & 0xf) << 12);
  const t1 =
    ((b0 >> 4) & 0xf) |
    (((b1 >> 4) & 0xf) << 4) |
    (((b2 >> 4) & 0xf) << 8) |
    (((b3 >> 4) & 0xf) << 12);
  const t2 =
    ((b0 >> 8) & 0xf) |
    (((b1 >> 8) & 0xf) << 4) |
    (((b2 >> 8) & 0xf) << 8) |
    (((b3 >> 8) & 0xf) << 12);
  const t3 =
    ((b0 >> 12) & 0xf) |
    (((b1 >> 12) & 0xf) << 4) |
    (((b2 >> 12) & 0xf) << 8) |
    (((b3 >> 12) & 0xf) << 12);

  return (
    ROW_SCORE[b0] +
    ROW_SCORE[b1] +
    ROW_SCORE[b2] +
    ROW_SCORE[b3] +
    ROW_SCORE[t0] +
    ROW_SCORE[t1] +
    ROW_SCORE[t2] +
    ROW_SCORE[t3]
  );
}
