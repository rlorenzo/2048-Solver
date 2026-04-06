import "./style.css";
import {
  DIR,
  DIR_NAMES,
  initialBoard,
  move as boardMove,
  spawn,
  canMove,
  maxTile,
} from "./game/board.js";
import { mulberry32, randomSeed } from "./game/rng.js";
import { History } from "./game/history.js";
import { createBoardRenderer } from "./ui/board.js";
import { createTimelineRenderer } from "./ui/timeline.js";
import { encodeState, decodeState } from "./share/url.js";

// --- DOM handles
const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const bestTileEl = document.getElementById("best-tile");
const moveCountEl = document.getElementById("move-count");
const statusEl = document.getElementById("status");
const seedInput = document.getElementById("seed");
const speedInput = document.getElementById("speed");
const speedLabel = document.getElementById("speed-label");
const depthSelect = document.getElementById("depth");
const timelineEl = document.getElementById("timeline");
const timelinePositionEl = document.getElementById("timeline-position");
const branchLabelEl = document.getElementById("branch-label");

const btnNew = document.getElementById("btn-new");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const btnPlayPause = document.getElementById("btn-playpause");
const btnStop = document.getElementById("btn-stop");
const btnShare = document.getElementById("btn-share");
const btnBranchPrev = document.getElementById("btn-branch-prev");
const btnBranchNext = document.getElementById("btn-branch-next");

// --- Game state
const boardRenderer = createBoardRenderer(boardEl);
const timelineRenderer = createTimelineRenderer(timelineEl, (nodeId) => {
  if (!state.history.jumpTo(nodeId)) return;
  renderAll();
  syncURL();
});

let state = null; // { seed, history }
let aiRunning = false;
let aiTimer = null;
let aiWorker = null;
let aiRequestId = 0;

// Speed slider -> moves per second. Slider values 0..6 map into SPEEDS.
const SPEEDS = [1, 2, 4, 8, 16, 40, 200]; // per second

function speedMs() {
  const v = parseInt(speedInput.value, 10);
  return 1000 / SPEEDS[v];
}

function updateSpeedLabel() {
  const v = parseInt(speedInput.value, 10);
  speedLabel.textContent = `${SPEEDS[v]}/s`;
}

// --- Game setup

function newGame(seed, replayMoves = [], replayCursor = null) {
  if (aiRunning) stopAI();
  // Invalidate any in-flight AI requests — their onMessage callbacks check
  // `e.data.id !== id` and will silently drop stale results.
  aiRequestId++;
  const actualSeed = seed >>> 0;
  const rng = mulberry32(actualSeed);
  const { board } = initialBoard(rng);
  const history = new History(board);
  state = { seed: actualSeed, history };
  seedInput.value = String(actualSeed);

  // Replay moves if provided
  if (replayMoves.length > 0) {
    for (const dir of replayMoves) {
      if (!applyMove(dir, { silent: true })) break;
    }
    if (replayCursor !== null && replayCursor < replayMoves.length) {
      // Walk cursor back
      const steps = replayMoves.length - replayCursor;
      for (let i = 0; i < steps; i++) state.history.stepBack();
    }
  }

  boardRenderer.reset();
  renderAll();
  syncURL();
}

// Apply a move from the CURRENT cursor position. Generates the next spawn
// using an RNG seeded from (seed, move-path) so spawns are deterministic per
// branch. Computes the path hash incrementally to avoid O(n) movesFromRoot()
// on every move.
function applyMove(dir, opts = {}) {
  const cur = state.history.current();
  const result = boardMove(cur.board, dir);
  if (!result.moved) return false;

  // Derive an RNG seeded from (seed, move-path) so each branch is reproducible.
  // Accumulate the hash from the parent's stored hash rather than rewalking
  // the entire path from root — keeps each applyMove call O(1).
  const parentHash = cur.pathHash ?? state.seed;
  const pathSeed = stepHash(parentHash, dir);
  const rng = mulberry32(pathSeed);
  const s = spawn(result.board, rng);
  const newBoard = s ? s.board : result.board;
  const spawnInfo = s ? s.spawn : null;
  const newScore = cur.score + result.score;

  const childId = state.history.record(dir, newBoard, newScore, spawnInfo);
  // Store the accumulated hash on the new node for future children.
  state.history.get(childId).pathHash = pathSeed;

  if (!opts.silent) {
    renderAll();
    syncURL();
  }
  return true;
}

// Single step of the FNV-1a–like hash used by applyMove. Kept separate from
// the full-path version so applyMove can call it incrementally.
function stepHash(h, dir) {
  h = (h * 0x9e3779b1 + dir) >>> 0; // Knuth multiplicative hash step
  h ^= h >>> 16;
  return h >>> 0;
}

// --- Rendering

function renderAll() {
  const cur = state.history.current();
  boardRenderer.render(cur.board, { spawnPos: cur.spawn?.pos });
  scoreEl.textContent = String(cur.score);
  bestTileEl.textContent = String(maxTile(cur.board));

  const depth = state.history.depth();
  moveCountEl.textContent = String(depth);

  // Depth along the preferred (first-child) branch forward from cursor.
  // With branching, other branches may be longer; this shows the primary path.
  let forwardDepth = depth;
  let node = cur;
  while (node.children.size > 0) {
    const next = state.history.get(node.children.values().next().value);
    node = next;
    forwardDepth++;
  }
  timelinePositionEl.textContent = `${depth} / ${forwardDepth}`;

  // Status
  if (!canMove(cur.board)) {
    const mt = maxTile(cur.board);
    if (mt >= 2048) {
      statusEl.textContent = `Game won! Best tile: ${mt}`;
      statusEl.className = "status win";
    } else {
      statusEl.textContent = "Game over. Rewind and try a different path!";
      statusEl.className = "status lose";
    }
  } else if (maxTile(cur.board) >= 2048) {
    statusEl.textContent = `2048 reached! Keep going…`;
    statusEl.className = "status win";
  } else {
    statusEl.textContent = "";
    statusEl.className = "status";
  }

  // Branch label
  const siblings = state.history.siblings();
  if (siblings.length > 1) {
    const idx = siblings.indexOf(state.history.cursor);
    const dirs = siblings.map((id) => DIR_NAMES[state.history.get(id).dir] ?? "?");
    branchLabelEl.textContent = `Branch ${idx + 1}/${siblings.length}: [${dirs.join(" ")}]`;
  } else {
    branchLabelEl.textContent = "";
  }

  // Buttons
  btnUndo.disabled = cur.parent === null;
  btnRedo.disabled = cur.children.size === 0;
  btnBranchPrev.disabled = siblings.length < 2;
  btnBranchNext.disabled = siblings.length < 2;

  timelineRenderer.render(state.history);
}

// --- URL sync

function syncURL() {
  const movesAll = fullMoveSequence();
  const cursorPos = state.history.depth();
  const hash = encodeState({
    seed: state.seed,
    moves: movesAll,
    cursor: cursorPos,
  });
  history.replaceState(null, "", hash);
}

// Get the move sequence along the FORWARD-most path (cursor + following
// first children), so sharing a rewound state preserves the full played game.
function fullMoveSequence() {
  // Walk from root following first children all the way forward
  const moves = [];
  let node = state.history.get(state.history.root);
  while (node.children.size > 0) {
    const childId = node.children.values().next().value;
    const child = state.history.get(childId);
    moves.push(child.dir);
    node = child;
  }
  return moves;
}

// --- AI

function ensureWorker() {
  if (aiWorker) return aiWorker;
  aiWorker = new Worker(new URL("./ai/worker.js", import.meta.url), { type: "module" });
  return aiWorker;
}

function requestAIMove() {
  return new Promise((resolve) => {
    const worker = ensureWorker();
    const id = ++aiRequestId;
    const cur = state.history.current();
    const depthVal = depthSelect.value;
    const depth = depthVal === "auto" ? "auto" : parseInt(depthVal, 10);

    const onMessage = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener("message", onMessage);
      resolve(e.data);
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, board: cur.board.buffer.slice(0), depth });
  });
}

async function aiStep() {
  const cur = state.history.current();
  if (!canMove(cur.board)) {
    stopAI();
    return;
  }
  const { dir } = await requestAIMove();
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) {
    stopAI();
    return;
  }
  if (!aiRunning) return;
  applyMove(dir);
}

function startAI() {
  if (aiRunning) return;
  aiRunning = true;
  btnPlayPause.textContent = "Pause";
  const loop = async () => {
    if (!aiRunning) return;
    await aiStep();
    if (!aiRunning) return;
    aiTimer = setTimeout(loop, speedMs());
  };
  void loop();
}

function stopAI() {
  aiRunning = false;
  btnPlayPause.textContent = "AI Play";
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
}

// --- Input handlers

window.addEventListener("keydown", (e) => {
  const k = e.key;
  if (e.shiftKey && (k === "ArrowLeft" || k === "ArrowRight")) {
    e.preventDefault();
    if (k === "ArrowLeft") {
      state.history.stepBack();
    } else {
      state.history.stepForward();
    }
    renderAll();
    syncURL();
    return;
  }
  if (k === "ArrowUp" || k === "ArrowRight" || k === "ArrowDown" || k === "ArrowLeft") {
    e.preventDefault();
    if (aiRunning) return;
    const dir = {
      ArrowUp: DIR.UP,
      ArrowRight: DIR.RIGHT,
      ArrowDown: DIR.DOWN,
      ArrowLeft: DIR.LEFT,
    }[k];
    applyMove(dir);
    return;
  }
  if (k === " ") {
    e.preventDefault();
    if (aiRunning) stopAI();
    else startAI();
  } else if (k === "n" || k === "N") {
    newGame(randomSeed());
  }
});

btnNew.addEventListener("click", () => {
  const raw = seedInput.value.trim();
  let seed;
  if (raw === "") {
    seed = randomSeed();
  } else {
    // Validate parse BEFORE `>>> 0` — otherwise "abc" parses to NaN and
    // `NaN >>> 0 === 0`, silently accepting garbage as seed 0.
    const parsed = parseInt(raw, 10);
    seed = Number.isFinite(parsed) ? parsed >>> 0 : randomSeed();
  }
  newGame(seed);
});

btnUndo.addEventListener("click", () => {
  stopAI();
  state.history.stepBack();
  renderAll();
  syncURL();
});
btnRedo.addEventListener("click", () => {
  state.history.stepForward();
  renderAll();
  syncURL();
});

btnPlayPause.addEventListener("click", () => {
  if (aiRunning) stopAI();
  else startAI();
});
btnStop.addEventListener("click", stopAI);

btnShare.addEventListener("click", async () => {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    btnShare.textContent = "Copied!";
    setTimeout(() => {
      btnShare.textContent = "Copy Share Link";
    }, 1200);
  } catch {
    // Fallback: select-and-prompt
    prompt("Copy this link:", url);
  }
});

btnBranchPrev.addEventListener("click", () => cycleBranch(-1));
btnBranchNext.addEventListener("click", () => cycleBranch(1));

function cycleBranch(delta) {
  const sibs = state.history.siblings();
  if (sibs.length < 2) return;
  const idx = sibs.indexOf(state.history.cursor);
  const next = sibs[(idx + delta + sibs.length) % sibs.length];
  if (!state.history.jumpTo(next)) return;
  renderAll();
  syncURL();
}

speedInput.addEventListener("input", updateSpeedLabel);

// --- Init

function init() {
  updateSpeedLabel();
  const hashState = decodeState(window.location.hash);
  if (hashState) {
    newGame(hashState.seed, hashState.moves, hashState.cursor);
  } else {
    newGame(randomSeed());
  }
}

init();
