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
  let maxIdx = 0;
  for (let i = 0; i < 16; i++) {
    if (board[i] > maxExp) {
      maxExp = board[i];
      maxIdx = i;
    }
  }

  const { r, c } = rowCol(maxIdx);

  // Find highest-value row edge and col edge for tie-breaking
  let rowSum = [0, 0, 0, 0];
  let colSum = [0, 0, 0, 0];
  for (let i = 0; i < 16; i++) {
    const rc = rowCol(i);
    rowSum[rc.r] += board[i];
    colSum[rc.c] += board[i];
  }

  // Best corner = nearest by Manhattan distance.
  // Tie-break: prefer corner aligned with highest-value row/col edge.
  let bestCorner = CORNERS[0];
  let bestDist = Infinity;
  let bestTieScore = -1;

  for (const corner of CORNERS) {
    const dist = Math.abs(r - corner.r) + Math.abs(c - corner.c);
    // Tie-break score: sum of the row-edge value and col-edge value for this corner
    const edgeRow = corner.r === 0 ? 0 : 3;
    const edgeCol = corner.c === 0 ? 0 : 3;
    const tieScore = rowSum[edgeRow] + colSum[edgeCol];

    if (dist < bestDist || (dist === bestDist && tieScore > bestTieScore)) {
      bestCorner = corner;
      bestDist = dist;
      bestTieScore = tieScore;
    }
  }

  const held = r === bestCorner.r && c === bestCorner.c;

  return { corner: bestCorner.name, held };
}

// ---- Monotonicity ----

function detectMonotonicity(board) {
  let monoCount = 0;
  let rowBroken = false;
  let colBroken = false;

  // Check rows
  for (let r = 0; r < 4; r++) {
    const row = [board[r * 4], board[r * 4 + 1], board[r * 4 + 2], board[r * 4 + 3]];
    if (isNonIncreasing(row) || isNonDecreasing(row)) {
      monoCount++;
    } else {
      rowBroken = true;
    }
  }

  // Check columns
  for (let c = 0; c < 4; c++) {
    const col = [board[c], board[4 + c], board[8 + c], board[12 + c]];
    if (isNonIncreasing(col) || isNonDecreasing(col)) {
      monoCount++;
    } else {
      colBroken = true;
    }
  }

  let status;
  if (monoCount === 8) {
    status = "strong";
  } else if (monoCount < 4) {
    status = "broken";
  } else {
    status = "mixed";
  }

  let direction = null;
  if (status !== "strong") {
    if (rowBroken && !colBroken) direction = "row";
    else if (colBroken && !rowBroken) direction = "col";
    else if (rowBroken)
      direction = "row"; // both broken, report row
    else direction = "col";
  }

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
  // Find max tile position
  let maxExp = 0;
  let maxIdx = 0;
  for (let i = 0; i < 16; i++) {
    if (board[i] > maxExp) {
      maxExp = board[i];
      maxIdx = i;
    }
  }

  if (maxExp === 0) return { status: "none", longestRun: 0 };

  // BFS/DFS walk from max tile following descending exponents
  const visited = new Set();
  const longestRun = walkChain(board, maxIdx, visited);

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
    return "Monotonicity broken along " + axis + " axis";
  }

  // Space critical: child board is critical
  if (preDiag.space.tier !== "critical" && postDiag.space.tier === "critical") {
    return "Board nearly full — only " + postDiag.space.empties + " cells left";
  }

  // Fallback
  return "Best move was " + DIR_LABELS[transition.bestDir || 0];
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
