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
const speedCaption = document.getElementById("speed-caption");
const speedLabel = document.getElementById("speed-label");
const depthSelect = document.getElementById("depth");
const timelineEl = document.getElementById("timeline");
const timelinePositionEl = document.getElementById("timeline-position");
const branchLabelEl = document.getElementById("branch-label");
const winOverlayEl = document.getElementById("win-overlay");

const btnNew = document.getElementById("btn-new");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const btnPlayPause = document.getElementById("btn-playpause");
const btnStop = document.getElementById("btn-stop");
const btnShare = document.getElementById("btn-share");
const btnBranchPrev = document.getElementById("btn-branch-prev");
const btnBranchNext = document.getElementById("btn-branch-next");
const btnSeedReplay = document.getElementById("btn-seed-replay");
const btnSeedRandom = document.getElementById("btn-seed-random");
const btnWinContinue = document.getElementById("btn-win-continue");
const btnWinNew = document.getElementById("btn-win-new");
const btnWinShare = document.getElementById("btn-win-share");

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
let nextRequestId = 0; // monotonic per-request ID for worker message routing
let gameEpoch = 0; // incremented on newGame to invalidate in-flight AI
let winAcknowledged = false;
let replayMode = false;

// Speed slider -> moves per second. Slider values 0..6 map into SPEEDS.
const SPEEDS = [1, 2, 4, 8, 16, 40, 200]; // per second

function speedIndex() {
  const v = parseInt(speedInput.value, 10);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(v, SPEEDS.length - 1));
}

function speedMs() {
  return 1000 / SPEEDS[speedIndex()];
}

function updateSpeedLabel() {
  speedLabel.textContent = `${SPEEDS[speedIndex()]}/s`;
}

function setStatusMessage(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind ? `status ${kind}` : "status";
}

function parseSeedInput() {
  const raw = seedInput.value.trim();
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10) >>> 0;
}

function randomizeSeedInput() {
  const seed = randomSeed();
  seedInput.value = String(seed);
  return seed;
}

function showWinOverlay() {
  winOverlayEl.classList.remove("hidden");
  btnWinNew.focus();
}

function hideWinOverlay() {
  winOverlayEl.classList.add("hidden");
}

function isWinOverlayOpen() {
  return !winOverlayEl.classList.contains("hidden");
}

function setShareButtonFeedback(label) {
  btnShare.textContent = label;
  btnWinShare.textContent = label;
}

function resetShareButtonFeedback() {
  btnShare.textContent = "Copy Share Link";
  btnWinShare.textContent = "Share Game";
}

function updatePlayButtonLabel() {
  btnPlayPause.textContent = aiRunning ? "Pause" : replayMode ? "Play" : "AI Play";
}

function updateSpeedCaption() {
  speedCaption.textContent = replayMode ? "Playback Speed:" : "AI Speed:";
}

function buildShareURL() {
  const moves = fullMoveSequence();
  const hash = encodeState({
    seed: state.seed,
    moves,
    cursor: moves.length > 0 ? 0 : state.history.depth(),
    replay: moves.length > 0,
  });
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

async function copyShareLink() {
  const url = buildShareURL();
  try {
    await navigator.clipboard.writeText(url);
    setShareButtonFeedback("Copied!");
  } catch {
    prompt("Copy this link:", url);
  }
}

// --- Game setup

function newGame(seed, replayMoves = [], replayCursor = null) {
  if (aiRunning) stopAI();
  // Invalidate any in-flight AI requests: increment the game epoch and
  // resolve pending promises with a sentinel so awaiting code completes
  // (the epoch check in aiStep will discard the result).
  gameEpoch++;
  for (const resolve of pendingAI.values()) {
    resolve({ dir: -1, scores: [0, 0, 0, 0], depth: 0 });
  }
  pendingAI.clear();
  const actualSeed = seed >>> 0;
  const rng = mulberry32(actualSeed);
  const { board } = initialBoard(rng);
  const history = new History(board);
  state = { seed: actualSeed, history };
  winAcknowledged = false;
  replayMode = false;
  hideWinOverlay();
  resetShareButtonFeedback();
  updatePlayButtonLabel();
  updateSpeedCaption();
  invalidateForwardDepthCache();
  seedInput.value = String(actualSeed);

  // Replay moves if provided
  if (replayMoves.length > 0) {
    let appliedMoves = 0;
    for (const dir of replayMoves) {
      if (!applyMove(dir, { silent: true })) break;
      appliedMoves++;
    }
    if (replayCursor !== null && replayCursor < appliedMoves) {
      // Walk cursor back
      const steps = appliedMoves - replayCursor;
      for (let i = 0; i < steps; i++) state.history.stepBack();
    }
  }

  boardRenderer.reset();
  timelineRenderer.reset();
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
  invalidateForwardDepthCache();

  if (!opts.silent) {
    renderAll();
    syncURL();
  }
  return true;
}

// Single step of the FNV-1a–like hash used by applyMove. Kept separate from
// the full-path version so applyMove can call it incrementally.
function stepHash(h, dir) {
  h = (Math.imul(h, 0x9e3779b1) + dir) >>> 0; // Knuth multiplicative hash step
  h ^= h >>> 16;
  return h >>> 0;
}

// --- Cached forward-depth: walk the preferred (first-child) branch from
// cursor to leaf. Cached on the cursor node id; invalidated when a new
// child is added (applyMove) or cursor moves (stepBack/forward/jumpTo).
let _fwdDepthCache = { cursorId: -1, value: 0 };

function cachedForwardDepth() {
  const cursorId = state.history.cursor;
  if (_fwdDepthCache.cursorId === cursorId) return _fwdDepthCache.value;
  const depth = state.history.depth();
  let fwd = depth;
  let node = state.history.current();
  while (node.children.size > 0) {
    node = state.history.get(node.children.values().next().value);
    fwd++;
  }
  _fwdDepthCache = { cursorId, value: fwd };
  return fwd;
}

function invalidateForwardDepthCache() {
  _fwdDepthCache.cursorId = -1;
}

// --- Rendering

function renderAll() {
  const cur = state.history.current();
  boardRenderer.render(cur.board, { spawnPos: cur.spawn?.pos });
  scoreEl.textContent = String(cur.score);
  const bestTile = maxTile(cur.board);
  bestTileEl.textContent = String(bestTile);

  const depth = state.history.depth();
  moveCountEl.textContent = String(depth);
  timelinePositionEl.textContent = `${depth} / ${cachedForwardDepth()}`;

  // Status
  if (!canMove(cur.board)) {
    if (bestTile >= 2048) {
      setStatusMessage(`Game won! Best tile: ${bestTile}`, "win");
    } else {
      setStatusMessage("Game over. Rewind and try a different path!", "lose");
    }
  } else if (bestTile >= 2048) {
    setStatusMessage("2048 reached! Keep going…", "win");
  } else {
    setStatusMessage("");
  }

  if (bestTile >= 2048 && !winAcknowledged) {
    if (aiRunning) stopAI();
    showWinOverlay();
  } else {
    hideWinOverlay();
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
// During AI autoplay, syncURL is called on every move which triggers
// fullMoveSequence (O(n) path walk) + replaceState. We debounce via
// requestAnimationFrame so at most one URL update happens per frame.
// Manual actions (human moves, scrub, share) call syncURLNow() directly.

let _syncURLPending = false;

function syncURL() {
  if (aiRunning) {
    // Batch during autoplay — at most once per animation frame.
    if (!_syncURLPending) {
      _syncURLPending = true;
      requestAnimationFrame(() => {
        _syncURLPending = false;
        syncURLNow();
      });
    }
  } else {
    syncURLNow();
  }
}

function syncURLNow() {
  const movesAll = fullMoveSequence();
  const cursorPos = state.history.depth();
  const hash = encodeState({
    seed: state.seed,
    moves: movesAll,
    cursor: cursorPos,
  });
  history.replaceState(null, "", hash);
}

// Build the move sequence for the URL: root → cursor (the actual branch the
// user is viewing), then continue following first-children forward from the
// cursor so sharing a rewound state preserves the rest of the played game on
// that branch.
function fullMoveSequence() {
  // Root → cursor: use the history path (guaranteed to follow the right branch)
  const path = state.history.pathToCursor();
  const moves = path.filter((n) => n.dir !== null).map((n) => n.dir);

  // Cursor → end of preferred branch
  let node = state.history.current();
  while (node.children.size > 0) {
    const childId = node.children.values().next().value;
    const child = state.history.get(childId);
    moves.push(child.dir);
    node = child;
  }
  return moves;
}

// --- AI

// Pending AI request resolvers, keyed by request id. The shared worker
// message handler routes responses by id and removes the matching entry.
// On newGame, pending entries are resolved with a sentinel so the awaiting
// code in aiStep completes and the epoch check discards the stale result.
const pendingAI = new Map();

function ensureWorker() {
  if (aiWorker) return aiWorker;
  aiWorker = new Worker(new URL("./ai/worker.js", import.meta.url), { type: "module" });
  aiWorker.addEventListener("message", (e) => {
    const resolve = pendingAI.get(e.data.id);
    if (!resolve) return; // stale / invalidated request
    pendingAI.delete(e.data.id);
    resolve(e.data);
  });
  return aiWorker;
}

function requestAIMove() {
  return new Promise((resolve) => {
    const worker = ensureWorker();
    const id = ++nextRequestId;
    const cur = state.history.current();
    const depthVal = depthSelect.value;
    const depth = depthVal === "auto" ? "auto" : parseInt(depthVal, 10);

    pendingAI.set(id, resolve);
    worker.postMessage({ id, board: cur.board.slice(), depth });
  });
}

async function aiStep() {
  const cur = state.history.current();
  if (!canMove(cur.board)) {
    stopAI();
    return;
  }
  // Capture the game epoch so we can detect if newGame was called while
  // we were awaiting the worker. (gameEpoch is separate from the per-
  // request nextRequestId used for worker message routing.)
  const epoch = gameEpoch;
  const { dir } = await requestAIMove();
  if (gameEpoch !== epoch) return; // stale — game was reset
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) {
    stopAI();
    return;
  }
  if (!aiRunning) return;
  applyMove(dir);
}

function startAI() {
  if (isWinOverlayOpen()) return;
  if (aiRunning) return;
  aiRunning = true;
  updatePlayButtonLabel();
  const loop = async () => {
    if (!aiRunning) return;
    await aiStep();
    if (!aiRunning) return;
    aiTimer = setTimeout(loop, speedMs());
  };
  void loop();
}

function stopAI() {
  // End the current AI epoch so any in-flight worker response from a prior
  // run is ignored if the user restarts AI before it arrives.
  gameEpoch++;
  aiRunning = false;
  updatePlayButtonLabel();
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
  // Flush any debounced URL update so the final AI state is captured.
  if (_syncURLPending) {
    _syncURLPending = false;
    syncURLNow();
  }
}

// --- Input handlers

window.addEventListener("keydown", (e) => {
  if (!state) return;
  // Don't intercept keys when focus is inside interactive controls — let
  // them handle their own keyboard interaction (e.g. Space on a button
  // should click it, not toggle AI).
  const tag = e.target?.tagName;
  if (
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    tag === "BUTTON" ||
    tag === "A" ||
    e.target?.isContentEditable
  )
    return;
  const k = e.key;
  if (isWinOverlayOpen()) {
    if (k === "Escape") {
      winAcknowledged = true;
      hideWinOverlay();
    }
    return;
  }
  if (e.shiftKey && (k === "ArrowLeft" || k === "ArrowRight")) {
    e.preventDefault();
    if (aiRunning) stopAI();
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

// --- Touch / swipe input (mobile)
// Track touch start position on the board; on touchend compute the dominant
// axis and apply the corresponding move if the swipe exceeds a threshold.
const SWIPE_THRESHOLD = 30; // minimum px to count as a swipe
let touchStartX = 0;
let touchStartY = 0;

boardEl.addEventListener(
  "touchstart",
  (e) => {
    if (!state || e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  },
  { passive: true },
);

boardEl.addEventListener(
  "touchend",
  (e) => {
    if (!state || aiRunning || isWinOverlayOpen()) return;
    if (e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < SWIPE_THRESHOLD) return;
    let dir;
    if (absDx > absDy) {
      dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
    } else {
      dir = dy > 0 ? DIR.DOWN : DIR.UP;
    }
    applyMove(dir);
  },
  { passive: true },
);

btnNew.addEventListener("click", () => {
  newGame(randomizeSeedInput());
});

btnSeedRandom.addEventListener("click", () => {
  randomizeSeedInput();
  setStatusMessage("Random seed ready. Start a new game or replay it.");
});

btnSeedReplay.addEventListener("click", () => {
  const seed = parseSeedInput();
  if (seed === null) {
    setStatusMessage("Enter digits only to replay a specific seed.", "lose");
    seedInput.focus();
    seedInput.select();
    return;
  }
  newGame(seed);
});

seedInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  btnSeedReplay.click();
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

btnShare.addEventListener("click", copyShareLink);
btnWinShare.addEventListener("click", copyShareLink);
btnWinContinue.addEventListener("click", () => {
  winAcknowledged = true;
  hideWinOverlay();
});
btnWinNew.addEventListener("click", () => {
  newGame(randomizeSeedInput());
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
    if (hashState.replay && hashState.moves.length > 0) {
      replayMode = true;
      updatePlayButtonLabel();
      updateSpeedCaption();
      winAcknowledged = true;
      hideWinOverlay();
      setStatusMessage("Watching a shared replay. Press Play or step through the game.");
    }
  } else {
    newGame(randomSeed());
  }
}

init();
