// Expectimax search on the bitboard. Max node iterates over 4 directions;
// chance node iterates over empty cells × {2,4}. Transposition table keyed
// by (board, depth) in a single Map.
//
// Note on caching: the table is keyed only by (board, depth). To keep that
// correct we do NOT prune by cumulative probability along the path — if we
// did, two calls that reach the same (board, depth) via different path
// probabilities would compute and then cache different answers. Depth is the
// sole budget; that's sufficient given our adaptive-depth bounds.

import { move, countEmpty, canMove, keyOf, setCellInPlace } from "./bitboard.js";
import { evaluate } from "./heuristics.js";

// Transposition cache, reset per search.
let cache;

function adaptiveDepth(board, userDepth) {
  if (userDepth !== "auto") return userDepth;
  const empties = countEmpty(board);
  // Deeper when danger is higher, shallower when early game.
  if (empties <= 3) return 8;
  if (empties <= 6) return 7;
  return 6;
}

export function bestMove(board, userDepth = "auto") {
  cache = new Map();
  const depth = adaptiveDepth(board, userDepth);

  let bestScore = -Infinity;
  let bestDir = -1;
  const scores = [0, 0, 0, 0];

  for (let d = 0; d < 4; d++) {
    const r = move(board, d);
    if (!r.moved) {
      scores[d] = -Infinity;
      continue;
    }
    const s = chanceNode(r.board, depth - 1);
    scores[d] = s;
    if (s > bestScore) {
      bestScore = s;
      bestDir = d;
    }
  }

  return { dir: bestDir, scores, depth };
}

function maxNode(board, depth) {
  if (depth <= 0) return evaluate(board);
  if (!canMove(board)) return evaluate(board);

  const key = keyOf(board) + "m" + depth;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let best = -Infinity;
  for (let d = 0; d < 4; d++) {
    const r = move(board, d);
    if (!r.moved) continue;
    const s = chanceNode(r.board, depth - 1);
    if (s > best) best = s;
  }
  if (best === -Infinity) best = evaluate(board);
  cache.set(key, best);
  return best;
}

function chanceNode(board, depth) {
  if (depth <= 0) return evaluate(board);

  // Enumerate empty positions
  const positions = [];
  for (let pos = 0; pos < 16; pos++) {
    const row = pos >> 2;
    const col = pos & 3;
    if (((board[row] >> (4 * col)) & 0xf) === 0) positions.push(pos);
  }
  if (positions.length === 0) return maxNode(board, depth);

  const key = keyOf(board) + "c" + depth;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const perCell = 1 / positions.length;
  // Mutate board in place, then restore (faster than allocating per child).
  let sum = 0;
  for (const pos of positions) {
    const row = pos >> 2;
    const col = pos & 3;
    const orig = board[row];
    // Tile value 2 (exp=1), probability 0.9
    board[row] = orig | (1 << (4 * col));
    sum += 0.9 * perCell * maxNode(board, depth - 1);
    // Tile value 4 (exp=2), probability 0.1
    board[row] = orig | (2 << (4 * col));
    sum += 0.1 * perCell * maxNode(board, depth - 1);
    // Restore
    board[row] = orig;
  }

  cache.set(key, sum);
  return sum;
}

// Exposed for tests/sanity checks.
export { setCellInPlace };
