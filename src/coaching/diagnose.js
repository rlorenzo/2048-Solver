// Pure coaching logic — no DOM, no worker imports.
// Board format: flat Uint8Array of 16 exponents (row-major, 0 = empty).

import { DIR_LABELS } from "../game/constants.js";

// ---- Debug logging ----

export function coachLog(...args) {
  try {
    if (typeof localStorage !== "undefined" && localStorage.debug === "coach") {
      console.log("[coach]", ...args);
    }
  } catch {
    // localStorage may throw in restricted contexts; silently ignore.
  }
}

// ---- Helpers ----

function rowCol(index) {
  return { r: index >> 2, c: index & 3 };
}

function cellIndex(r, c) {
  return r * 4 + c;
}

const CORNERS = [
  { name: "top-left", r: 0, c: 0 },
  { name: "top-right", r: 0, c: 3 },
  { name: "bottom-left", r: 3, c: 0 },
  { name: "bottom-right", r: 3, c: 3 },
];

// ---- Anchor detection ----

function detectAnchor(board) {
  let maxExp = 0;
  for (let i = 0; i < 16; i++) {
    if (board[i] > maxExp) maxExp = board[i];
  }

  // Collect every tile tied for the max value — ties are common (e.g. two
  // 2048s), and only checking the first one in row-major order can miss a
  // duplicate that's actually sitting in a corner.
  const maxIndices = [];
  for (let i = 0; i < 16; i++) {
    if (board[i] === maxExp) maxIndices.push(i);
  }

  // If any max-value tile occupies a corner, the anchor is held there.
  const cornered = CORNERS.find((corner) => maxIndices.includes(cellIndex(corner.r, corner.c)));
  if (cornered) return { corner: cornered.name, held: true };

  // No max tile is cornered: report the nearest corner as the target anchor.
  const { r, c } = rowCol(maxIndices[0]);
  return { corner: nearestCorner(board, r, c).name, held: false };
}

// Nearest corner by Manhattan distance. Tie-break: prefer the corner aligned
// with the highest-value row/col edge.
function nearestCorner(board, r, c) {
  const rowSum = [0, 0, 0, 0];
  const colSum = [0, 0, 0, 0];
  for (let i = 0; i < 16; i++) {
    const rc = rowCol(i);
    rowSum[rc.r] += board[i];
    colSum[rc.c] += board[i];
  }

  let bestCorner = CORNERS[0];
  let bestDist = Infinity;
  let bestTieScore = -1;

  for (const corner of CORNERS) {
    const dist = Math.abs(r - corner.r) + Math.abs(c - corner.c);
    // Tie-break score: sum of the row-edge value and col-edge value for this corner
    const tieScore = rowSum[corner.r === 0 ? 0 : 3] + colSum[corner.c === 0 ? 0 : 3];

    if (dist < bestDist || (dist === bestDist && tieScore > bestTieScore)) {
      bestCorner = corner;
      bestDist = dist;
      bestTieScore = tieScore;
    }
  }

  return bestCorner;
}

// ---- Monotonicity ----

// Count how many of the four lines produced by `line(i)` are monotone.
function monotoneStats(line) {
  let count = 0;
  let broken = false;
  for (let i = 0; i < 4; i++) {
    const values = line(i);
    if (isNonIncreasing(values) || isNonDecreasing(values)) count++;
    else broken = true;
  }
  return { count, broken };
}

function detectMonotonicity(board) {
  const rows = monotoneStats((r) => [
    board[r * 4],
    board[r * 4 + 1],
    board[r * 4 + 2],
    board[r * 4 + 3],
  ]);
  const cols = monotoneStats((c) => [board[c], board[4 + c], board[8 + c], board[12 + c]]);

  const monoCount = rows.count + cols.count;
  let status;
  if (monoCount === 8) {
    status = "strong";
  } else if (monoCount < 4) {
    status = "broken";
  } else {
    status = "mixed";
  }

  // Report the broken axis; row wins when both are broken, col covers the
  // neither-broken case (mixed lines that are all individually monotone).
  const direction = status === "strong" ? null : rows.broken ? "row" : "col";

  return { status, direction };
}

function isNonIncreasing(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[i - 1]) return false;
  }
  return true;
}

function isNonDecreasing(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) return false;
  }
  return true;
}

// ---- Space ----

function detectSpace(board) {
  let empties = 0;
  for (let i = 0; i < 16; i++) {
    if (board[i] === 0) empties++;
  }

  let tier;
  if (empties >= 6) tier = "healthy";
  else if (empties >= 3) tier = "tight";
  else tier = "critical";

  return { empties, tier };
}

// ---- Merge chain ----

function detectMergeChain(board) {
  // Find the max tile value
  let maxExp = 0;
  for (let i = 0; i < 16; i++) {
    if (board[i] > maxExp) maxExp = board[i];
  }

  if (maxExp === 0) return { status: "none", longestRun: 0 };

  // Multiple tiles can tie for the max value. Walk the chain from every one
  // of them and keep the best result — a real chain shouldn't be missed just
  // because a different duplicate max was scanned first.
  let longestRun = 0;
  for (let i = 0; i < 16; i++) {
    if (board[i] !== maxExp) continue;
    const visited = new Set();
    const run = walkChain(board, i, visited);
    if (run > longestRun) longestRun = run;
  }

  let status;
  if (longestRun >= 4) status = "ready";
  else if (longestRun >= 2) status = "weak";
  else status = "none";

  return { status, longestRun };
}

function walkChain(board, idx, visited) {
  visited.add(idx);
  const { r, c } = rowCol(idx);
  const currentExp = board[idx];
  let best = 1; // count this cell

  const neighbors = [];
  if (r > 0) neighbors.push(cellIndex(r - 1, c));
  if (r < 3) neighbors.push(cellIndex(r + 1, c));
  if (c > 0) neighbors.push(cellIndex(r, c - 1));
  if (c < 3) neighbors.push(cellIndex(r, c + 1));

  for (const ni of neighbors) {
    if (visited.has(ni)) continue;
    // Must be strictly descending and non-zero
    if (board[ni] > 0 && board[ni] === currentExp - 1) {
      const run = 1 + walkChain(board, ni, visited);
      if (run > best) best = run;
    }
  }

  return best;
}

// ---- Move quality ----

// Grade a single score relative to the best score. Exported so UI renderers
// (e.g. score-bars) can reuse the same thresholds without reimplementing them.
export function gradeScore(score, bestScore) {
  if (!isFinite(score)) return null;
  if (bestScore <= 0) return "best";
  const delta = bestScore - score;
  if (delta === 0) return "best";
  const ratio = delta / bestScore;
  if (ratio < 0.005 && delta < 200) return "best";
  if (ratio < 0.01 && delta < 1000) return "good";
  if (ratio < 0.04 && delta < 5000) return "ok";
  if (ratio < 0.12 || delta < 20000) return "mistake";
  return "blunder";
}

function gradeMoveQuality(aiResult, transition) {
  const scores = aiResult.scores;

  // Separate valid moves (finite scores) from invalid (-Infinity)
  const validScores = [];
  for (let d = 0; d < 4; d++) {
    if (isFinite(scores[d])) validScores.push({ dir: d, score: scores[d] });
  }

  // Find best direction among valid moves
  let bestDir = 0;
  let bestScore = -Infinity;
  for (const v of validScores) {
    if (v.score > bestScore) {
      bestScore = v.score;
      bestDir = v.dir;
    }
  }

  const chosenScore = scores[transition.chosenDir];
  const chosenValid = isFinite(chosenScore);

  // Chose an invalid move (shouldn't happen in normal play)
  if (!chosenValid) {
    return { grade: "blunder", scoreDelta: Infinity, bestDir };
  }

  const delta = bestScore - chosenScore;

  // Dead position — all valid moves score the same (or near-zero)
  if (bestScore <= 0) {
    return { grade: "best", scoreDelta: 0, bestDir };
  }

  const grade = gradeScore(chosenScore, bestScore);
  return { grade, scoreDelta: delta, bestDir };
}

// ---- Coaching note ----

function generateCoachNote(grade, board, transition, preDiag, postDiag) {
  if (grade === "best" || grade === "good") {
    return null;
  }

  // Corner lost: max tile was anchored before but not after.
  // Only relevant when the max tile is significant (exponent >= 6 = tile 64+).
  const preAnchor = preDiag.anchor;
  const postAnchor = postDiag.anchor;
  const maxExp = Math.max(...board);
  if (maxExp >= 6 && preAnchor.held && !postAnchor.held) {
    return "Corner lost — high tile drifted from " + preAnchor.corner;
  }

  // Monotonicity broken: was strong/mixed, now broken
  if (preDiag.monotonicity.status !== "broken" && postDiag.monotonicity.status === "broken") {
    const axis = postDiag.monotonicity.direction || "row";
    return "Snake pattern broken along " + axis + " axis";
  }

  // Space critical: child board is critical
  if (preDiag.space.tier !== "critical" && postDiag.space.tier === "critical") {
    return "Board nearly full — only " + postDiag.space.empties + " cells left";
  }

  // Fallback
  return "Best move was " + DIR_LABELS[transition.bestDir];
}

// ---- Main entry point ----

export function diagnose(board, aiResult, transition) {
  const anchor = detectAnchor(board);
  const monotonicity = detectMonotonicity(board);
  const space = detectSpace(board);
  const mergeChain = detectMergeChain(board);

  const result = { anchor, monotonicity, space, mergeChain };

  if (transition) {
    const { grade, scoreDelta, bestDir } = gradeMoveQuality(aiResult, transition);

    // Compute post-move diagnostics for coaching note
    const postAnchor = detectAnchor(transition.childBoard);
    const postMono = detectMonotonicity(transition.childBoard);
    const postSpace = detectSpace(transition.childBoard);

    const preDiag = { anchor, monotonicity, space };
    const postDiag = {
      anchor: postAnchor,
      monotonicity: postMono,
      space: postSpace,
    };

    const coachNote = generateCoachNote(
      grade,
      board,
      { ...transition, bestDir },
      preDiag,
      postDiag,
    );

    result.moveQuality = { grade, scoreDelta, bestDir, coachNote };
  }

  coachLog("diagnose", { board: Array.from(board), result });

  return result;
}
