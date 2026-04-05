// Expectimax search for 2048.
// Player moves: maximize. Chance node (tile spawn): weighted average over
// empty cells × {2 value (0.9), 4 value (0.1)}.

import { move, emptyCells, canMove } from "../game/board.js";
import { evaluate } from "./heuristics.js";

// Transposition cache keyed by board bytes + depth. Cleared per search.
let cache;

// Depth to search. Adaptive: deeper when board is more full.
function adaptiveDepth(b, userDepth) {
  if (userDepth !== "auto") return userDepth;
  const empties = emptyCells(b).length;
  // Fewer empty cells means branching shrinks, so we can afford more depth
  // AND we need it because the game is getting precarious.
  if (empties <= 3) return 7;
  if (empties <= 6) return 6;
  return 5;
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
    const score = chanceNode(r.board, depth - 1, 1.0);
    scores[d] = score;
    if (score > bestScore) {
      bestScore = score;
      bestDir = d;
    }
  }

  return { dir: bestDir, scores, depth };
}

function cacheKey(b, depth) {
  // Board packs 16 cells × 4 bits into 64 bits
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 8; i++) lo = (lo * 16 + b[i]) >>> 0;
  for (let i = 8; i < 16; i++) hi = (hi * 16 + b[i]) >>> 0;
  return `${hi}:${lo}:${depth}`;
}

function maxNode(b, depth, prob) {
  if (depth <= 0 || prob < 0.0001) return evaluate(b);
  if (!canMove(b)) return evaluate(b);

  const key = cacheKey(b, depth | 0x1000);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let best = -Infinity;
  for (let d = 0; d < 4; d++) {
    const r = move(b, d);
    if (!r.moved) continue;
    const s = chanceNode(r.board, depth - 1, prob);
    if (s > best) best = s;
  }
  if (best === -Infinity) best = evaluate(b);
  cache.set(key, best);
  return best;
}

function chanceNode(b, depth, prob) {
  if (depth <= 0 || prob < 0.0001) return evaluate(b);

  const empties = emptyCells(b);
  if (empties.length === 0) return maxNode(b, depth, prob);

  const key = cacheKey(b, depth);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  // Probability per empty cell
  const perCell = 1 / empties.length;
  const probPerBranch = prob * perCell;

  let sum = 0;
  for (const pos of empties) {
    // 90% chance of 2 (exp=1)
    b[pos] = 1;
    sum += 0.9 * perCell * maxNode(b, depth - 1, probPerBranch * 0.9);
    // 10% chance of 4 (exp=2)
    b[pos] = 2;
    sum += 0.1 * perCell * maxNode(b, depth - 1, probPerBranch * 0.1);
    b[pos] = 0;
  }

  cache.set(key, sum);
  return sum;
}
