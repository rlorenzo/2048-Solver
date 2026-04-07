import "./style.css";
import { DIR, initialBoard, move as boardMove, spawn, canMove, maxTile } from "./game/board.js";
import { mulberry32, randomSeed } from "./game/rng.js";
import { History } from "./game/history.js";
import { createBoardRenderer } from "./ui/board.js";
import { createTimelineRenderer } from "./ui/timeline.js";
import { createScoreBarsRenderer } from "./ui/score-bars.js";
import { createHintOverlayRenderer } from "./ui/hint-overlay.js";
import { createGradeBadgeRenderer } from "./ui/grade-badge.js";
import { createInspectorRenderer } from "./ui/inspector.js";
import { createDebriefRenderer } from "./ui/debrief.js";
import { diagnose } from "./coaching/diagnose.js";
import { encodeState, decodeState } from "./share/url.js";

// --- DOM handles
const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const bestTileEl = document.getElementById("best-tile");
const moveCountEl = document.getElementById("move-count");
const statusEl = document.getElementById("status");
const seedInput = document.getElementById("seed");
const speedInput = document.getElementById("speed");
const speedInputM = document.getElementById("speed-m");
const speedCaption = document.getElementById("speed-caption");
const speedLabel = document.getElementById("speed-label");
const speedLabelM = document.getElementById("speed-label-m");
const depthSelect = document.getElementById("depth");
const timelineEl = document.getElementById("timeline");
const timelinePositionEl = document.getElementById("timeline-position");
const winOverlayEl = document.getElementById("win-overlay");

const scoreBarsEl = document.getElementById("score-bars");
const gradeBadgeEl = document.getElementById("grade-badge");
const inspectorEl = document.getElementById("inspector");
const debriefEl = document.getElementById("debrief");
const boardShellEl = boardEl.closest(".board-shell");

const btnNew = document.getElementById("btn-new");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const btnHint = document.getElementById("btn-hint");
const btnPlayPause = document.getElementById("btn-playpause");
const btnShare = document.getElementById("btn-share");
const alwaysHintCheckbox = document.getElementById("always-hint");
const btnSeedReplay = document.getElementById("btn-seed-replay");
const btnSeedRandom = document.getElementById("btn-seed-random");
const btnWinContinue = document.getElementById("btn-win-continue");
const btnWinNew = document.getElementById("btn-win-new");
const btnWinShare = document.getElementById("btn-win-share");

// Mobile-specific action buttons (mirrors of desktop buttons)
const btnUndoM = document.getElementById("btn-undo-m");
const btnRedoM = document.getElementById("btn-redo-m");
const btnHintM = document.getElementById("btn-hint-m");
const btnPlayPauseM = document.getElementById("btn-playpause-m");

// --- Game state
const boardRenderer = createBoardRenderer(boardEl);
const timelineRenderer = createTimelineRenderer(
  timelineEl,
  (nodeId) => {
    if (!state.history.jumpTo(nodeId)) return;
    cancelHint();
    cancelGrade();
    syncHintModeForCurrentNode();
    restoreGradeFromCache();
    renderAll();
    syncURL();
  },
  (nodeId, triggerEl) => {
    if (nodeId === null) {
      inspectorRenderer.hide();
    } else {
      showInspectorForNode(nodeId, triggerEl);
    }
  },
);
const scoreBarsRenderer = createScoreBarsRenderer(scoreBarsEl);
const hintOverlayRenderer = createHintOverlayRenderer(boardShellEl);
const gradeBadgeRenderer = createGradeBadgeRenderer(gradeBadgeEl);
const inspectorRenderer = createInspectorRenderer(inspectorEl);
const debriefRenderer = createDebriefRenderer(debriefEl, () => {
  // "Retry this seed" callback — start a new game with the same seed
  newGame(state.seed);
});

// Coaching state — ephemeral, never serialized into URLs
const aiResults = new Map(); // nodeId → { scores, depth, ms }
const moveGrades = new Map(); // childNodeId → { grade, scoreDelta, bestDir, coachNote }
const uiState = { hintPending: false, pendingGrades: new Set() };
// Compute the consecutive trailing best/good streak for a node by walking its
// root-to-node path.  This is branch-local: rewinding or switching branches
// always gives the correct streak for that line of play.
function streakForNode(nodeId) {
  let streak = 0;
  let node = state?.history.get(nodeId);
  while (node?.parent !== null) {
    const grade = moveGrades.get(node.id);
    if (!grade || (grade.grade !== "best" && grade.grade !== "good")) break;
    streak++;
    node = state.history.get(node.parent);
  }
  return streak;
}

let state = null; // { seed, history }
let aiRunning = false;
let aiTimer = null;
let hintWorker = null;
let gradeWorker = null;
let nextRequestId = 0; // monotonic per-request ID for worker message routing
let gameEpoch = 0; // incremented on newGame to invalidate in-flight AI
let hintEpoch = 0; // per-type epoch for stale hint response detection
let gradeEpoch = 0; // per-type epoch for stale grade response detection
let winAcknowledged = false;
let replayMode = false;
let lastFocusedBeforeWinOverlay = null;
let shareFeedbackTimer = null;

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
  const label = `${SPEEDS[speedIndex()]}/s`;
  speedLabel.textContent = label;
  if (speedLabelM) speedLabelM.textContent = label;
}

function setStatusMessage(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind ? `status ${kind}` : "status";
}

function parseSeedInput() {
  const raw = seedInput.value.trim();
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed > 0xffffffff) return null;
  return parsed >>> 0;
}

function randomizeSeedInput() {
  const seed = randomSeed();
  seedInput.value = String(seed);
  return seed;
}

function getWinOverlayFocusableElements() {
  return [...winOverlayEl.querySelectorAll("button:not([disabled])")].filter(
    (el) => el instanceof HTMLElement && !el.hidden && el.getAttribute("aria-hidden") !== "true",
  );
}

function handleWinOverlayKeydown(e) {
  if (e.key !== "Tab" || !isWinOverlayOpen()) return;
  const focusable = getWinOverlayFocusableElements();
  if (focusable.length === 0) {
    e.preventDefault();
    if (winOverlayEl instanceof HTMLElement) winOverlayEl.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !winOverlayEl.contains(active)) {
      e.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last || !winOverlayEl.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

function showWinOverlay() {
  if (isWinOverlayOpen()) return;
  lastFocusedBeforeWinOverlay =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  winOverlayEl.classList.remove("hidden");
  winOverlayEl.addEventListener("keydown", handleWinOverlayKeydown);
  btnWinNew.focus();
}

function hideWinOverlay() {
  winOverlayEl.classList.add("hidden");
  winOverlayEl.removeEventListener("keydown", handleWinOverlayKeydown);
  if (
    lastFocusedBeforeWinOverlay &&
    document.contains(lastFocusedBeforeWinOverlay) &&
    typeof lastFocusedBeforeWinOverlay.focus === "function"
  ) {
    lastFocusedBeforeWinOverlay.focus();
  }
  lastFocusedBeforeWinOverlay = null;
}

function isWinOverlayOpen() {
  return !winOverlayEl.classList.contains("hidden");
}

function setShareButtonFeedback(label) {
  btnShare.textContent = label;
  btnWinShare.textContent = label;
}

function resetShareButtonFeedback() {
  if (shareFeedbackTimer !== null) {
    clearTimeout(shareFeedbackTimer);
    shareFeedbackTimer = null;
  }
  btnShare.textContent = "Copy Share Link";
  btnWinShare.textContent = "Share Game";
}

function scheduleShareButtonFeedbackReset() {
  if (shareFeedbackTimer !== null) clearTimeout(shareFeedbackTimer);
  shareFeedbackTimer = setTimeout(() => {
    shareFeedbackTimer = null;
    resetShareButtonFeedback();
  }, 1500);
}

function updatePlayButtonLabel() {
  const label = aiRunning ? "Pause AI Play" : replayMode ? "Play" : "AI Play";
  btnPlayPause.textContent = label;
  if (btnPlayPauseM) btnPlayPauseM.textContent = label;
}

function updateSpeedCaption() {
  speedCaption.textContent = replayMode ? "Playback Speed:" : "AI Speed:";
}

function currentURLHash() {
  const moves = fullMoveSequence();
  return encodeState({
    seed: state.seed,
    moves,
    cursor: state.history.depth(),
    replay: replayMode && moves.length > 0,
  });
}

function buildShareURL() {
  const hash = currentURLHash();
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

async function copyShareLink() {
  const url = buildShareURL();
  try {
    await navigator.clipboard.writeText(url);
    setShareButtonFeedback("Copied!");
    scheduleShareButtonFeedbackReset();
  } catch {
    prompt("Copy this link:", url);
    scheduleShareButtonFeedbackReset();
  }
}

// --- Game setup

function newGame(seed, replayMoves = [], replayCursor = null) {
  if (aiRunning) stopAI();
  // Invalidate any in-flight AI requests: increment the game epoch and
  // resolve pending promises with a sentinel so awaiting code completes
  // (the epoch check in aiStep will discard the result).
  gameEpoch++;
  hintEpoch++;
  gradeEpoch++;
  invalidatePendingAIRequests();
  // Terminate the grade worker across games — it will be lazily respawned.
  if (gradeWorker) {
    gradeWorker.terminate();
    gradeWorker = null;
  }
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

  aiResults.clear();
  moveGrades.clear();
  clearCoachingUI();

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

  const isHumanMove = !opts.silent && !aiRunning;

  // On human moves, clear coaching overlays before applying the move.
  // Don't cancel in-flight grades — let them complete so fast play still
  // records grades for earlier moves (badge display is cursor-gated).
  if (isHumanMove) {
    cancelHint();
    gradeBadgeRenderer.hide();
  }

  // Capture pre-move board for grading before mutation
  const preMoveBoard = isHumanMove ? cur.board.slice() : null;

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

  // Fire grade request for human moves (async, don't block)
  if (isHumanMove) {
    void gradeHumanMove(preMoveBoard, dir, childId, newBoard, cur.id);
    if (alwaysHintCheckbox?.checked) {
      void requestHint();
    }
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
  while (node) {
    const nextId = state.history.preferredChildId(node);
    if (nextId === null) break;
    node = state.history.get(nextId);
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

  // Buttons
  const undoDisabled = cur.parent === null;
  const redoDisabled = cur.children.size === 0;
  btnUndo.disabled = undoDisabled;
  btnRedo.disabled = redoDisabled;
  if (btnUndoM) btnUndoM.disabled = undoDisabled;
  if (btnRedoM) btnRedoM.disabled = redoDisabled;

  timelineRenderer.render(state.history, moveGrades);

  // Show debrief on game over (no moves possible), hide otherwise
  checkDebrief();
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
  const hash = currentURLHash();
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
  while (node) {
    const childId = state.history.preferredChildId(node);
    if (childId === null) break;
    const child = state.history.get(childId);
    moves.push(child.dir);
    node = child;
  }
  return moves;
}

// --- AI

// Pending AI request resolvers, keyed by request id. The shared worker
// message handler routes responses by id and removes the matching entry.
// On reset/stop, pending entries are resolved with a sentinel so awaiting
// code in aiStep completes and the epoch check discards the stale result.
const pendingAI = new Map();

function invalidatePendingAIRequests() {
  for (const pending of pendingAI.values()) {
    pending.resolve({ dir: -1, scores: [0, 0, 0, 0], depth: 0 });
  }
  pendingAI.clear();
}

function failPendingAIRequests(error, workerType = null) {
  for (const [id, pending] of pendingAI.entries()) {
    if (workerType && pending.workerType !== workerType) continue;
    pending.reject(error);
    pendingAI.delete(id);
  }
  if (!workerType) pendingAI.clear();
}

function handleWorkerFailure(message, workerType) {
  failPendingAIRequests(new Error(message), workerType);
  if (workerType === "grade") {
    if (gradeWorker) {
      gradeWorker.terminate();
      gradeWorker = null;
    }
  } else {
    if (hintWorker) {
      hintWorker.terminate();
      hintWorker = null;
    }
    setStatusMessage(message, "lose");
    stopAI();
  }
}

function createWorker(workerType) {
  const worker = new Worker(new URL("./ai/worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", (e) => {
    const data = e.data;
    const pending = pendingAI.get(data.id);
    if (!pending) return; // stale / invalidated request
    pendingAI.delete(data.id);
    // Stale-response guard: resolve with sentinel when epoch has moved on
    if (data.type === "hint" && data.epoch !== hintEpoch) {
      pending.resolve({ stale: true });
      return;
    }
    if (data.type === "grade" && data.epoch !== gradeEpoch) {
      pending.resolve({ stale: true });
      return;
    }
    pending.resolve(data);
  });
  worker.addEventListener("error", (e) => {
    const detail = e?.message ? `: ${e.message}` : ".";
    handleWorkerFailure(`AI worker failed${detail}`, workerType);
  });
  worker.addEventListener("messageerror", () => {
    handleWorkerFailure("AI worker sent an unreadable response.", workerType);
  });
  return worker;
}

function ensureHintWorker() {
  if (hintWorker) return hintWorker;
  hintWorker = createWorker("hint");
  return hintWorker;
}

function ensureGradeWorker() {
  if (gradeWorker) return gradeWorker;
  gradeWorker = createWorker("grade");
  return gradeWorker;
}

function requestAIMove() {
  hintEpoch++;
  const currentEpoch = hintEpoch;
  return new Promise((resolve, reject) => {
    const worker = ensureHintWorker();
    const id = ++nextRequestId;
    const cur = state.history.current();
    const depthVal = depthSelect.value;
    const depth = depthVal === "auto" ? "auto" : parseInt(depthVal, 10);

    pendingAI.set(id, { resolve, reject, workerType: "hint" });
    try {
      worker.postMessage({
        id,
        board: cur.board.slice(),
        depth,
        type: "hint",
        epoch: currentEpoch,
      });
    } catch (error) {
      pendingAI.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function requestGrade(board, depth = 3) {
  // Don't bump gradeEpoch here — allow concurrent grade requests so fast
  // play doesn't discard earlier grades. Epoch is still bumped by
  // cancelGrade() and newGame() for game-level invalidation.
  const currentEpoch = gradeEpoch;
  return new Promise((resolve, reject) => {
    const worker = ensureGradeWorker();
    const id = ++nextRequestId;

    pendingAI.set(id, { resolve, reject, workerType: "grade" });
    try {
      worker.postMessage({ id, board: board.slice(), depth, type: "grade", epoch: currentEpoch });
    } catch (error) {
      pendingAI.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

// --- Hint flow

function cancelHint() {
  if (uiState.hintPending) {
    hintEpoch++;
    uiState.hintPending = false;
    btnHint.disabled = false;
    if (btnHintM) btnHintM.disabled = false;
  }
  hintOverlayRenderer.hide();
  if (!alwaysHintCheckbox?.checked) {
    scoreBarsRenderer.hide();
  }
}

function cancelGrade() {
  if (uiState.pendingGrades.size > 0) {
    gradeEpoch++;
    uiState.pendingGrades.clear();
  }
  gradeBadgeRenderer.hide();
}

function clearCoachingUI() {
  cancelHint();
  cancelGrade();
  scoreBarsRenderer.reset();
  gradeBadgeRenderer.reset();
  inspectorRenderer.reset();
  debriefRenderer.reset();
}

async function requestHint() {
  if (uiState.hintPending) return; // debounce
  if (aiRunning) return;
  if (!state) return;
  const cur = state.history.current();
  if (!canMove(cur.board)) return;

  // Check cache first
  const nodeId = state.history.cursor;
  const cached = aiResults.get(nodeId);
  if (cached) {
    const bestDir = cached.scores.indexOf(Math.max(...cached.scores));
    scoreBarsRenderer.render(cached);
    hintOverlayRenderer.show(bestDir);
    return;
  }

  uiState.hintPending = true;
  btnHint.disabled = true;
  if (btnHintM) btnHintM.disabled = true;
  scoreBarsRenderer.showLoading();

  const epoch = gameEpoch;
  let result;
  try {
    result = await requestAIMove();
  } catch (error) {
    uiState.hintPending = false;
    btnHint.disabled = false;
    if (btnHintM) btnHintM.disabled = false;
    scoreBarsRenderer.showError();
    console.error("Hint request failed:", error);
    return;
  }

  // Stale check — game was reset or navigation happened
  if (gameEpoch !== epoch || !uiState.hintPending) {
    return;
  }

  uiState.hintPending = false;
  btnHint.disabled = false;
  if (btnHintM) btnHintM.disabled = false;

  if (result?.error) {
    scoreBarsRenderer.showError();
    console.error("Hint worker error:", result.error);
    return;
  }

  // Store in cache
  const currentNodeId = state.history.cursor;
  aiResults.set(currentNodeId, {
    scores: result.scores,
    depth: result.depth,
    ms: result.ms,
  });

  scoreBarsRenderer.render(result);
  const bestDir = result.scores.indexOf(Math.max(...result.scores));
  if (bestDir >= 0 && bestDir <= 3) {
    hintOverlayRenderer.show(bestDir);
  }
}

// Apply a computed grade result: store in moveGrades, update streak, show badge.
function applyGradeResult(childNodeId, mq) {
  moveGrades.set(childNodeId, {
    grade: mq.grade,
    scoreDelta: mq.scoreDelta,
    bestDir: mq.bestDir,
    coachNote: mq.coachNote,
  });

  const gradeStreak = streakForNode(childNodeId);

  if (state.history.cursor === childNodeId) {
    gradeBadgeRenderer.show(mq);
    gradeBadgeRenderer.updateStreak(gradeStreak);
  }

  timelineRenderer.render(state.history, moveGrades);
}

// Grade a human move: use cached hint result if available (same depth the hint
// used), otherwise fire a low-depth evaluation. This ensures that following a
// hint always grades as "Perfect" rather than disagreeing due to depth mismatch.
async function gradeHumanMove(preMoveBoard, chosenDir, childNodeId, childBoard, sourceNodeId) {
  const cached = aiResults.get(sourceNodeId);
  if (cached) {
    // Use the higher-depth hint result directly — no worker round-trip needed
    const aiResult = { scores: cached.scores, depth: cached.depth, ms: cached.ms };
    const transition = { chosenDir, childBoard };
    const diagnosis = diagnose(preMoveBoard, aiResult, transition);
    const mq = diagnosis.moveQuality;
    applyGradeResult(childNodeId, mq);
    return;
  }

  uiState.pendingGrades.add(childNodeId);
  gradeBadgeRenderer.showLoading();

  const epoch = gameEpoch;
  let result;
  try {
    const depthVal = depthSelect.value;
    const gradeDepth = depthVal === "auto" ? "auto" : parseInt(depthVal, 10);
    result = await requestGrade(preMoveBoard, gradeDepth);
  } catch {
    // Worker error — don't show badge, don't break streak (optimistic)
    uiState.pendingGrades.delete(childNodeId);
    gradeBadgeRenderer.hide();
    return;
  }

  // Stale check — game reset or grade cancelled
  if (gameEpoch !== epoch || !uiState.pendingGrades.has(childNodeId)) {
    return;
  }
  uiState.pendingGrades.delete(childNodeId);

  if (result?.error) {
    gradeBadgeRenderer.hide();
    console.error("Grade worker error:", result.error);
    return;
  }

  const aiResult = { scores: result.scores, depth: result.depth, ms: result.ms };
  const transition = { chosenDir, childBoard };
  const diagnosis = diagnose(preMoveBoard, aiResult, transition);
  const mq = diagnosis.moveQuality;
  applyGradeResult(childNodeId, mq);
}

// Restore grade badge from cache for a given node, or hide
function restoreGradeFromCache() {
  cancelGrade();
  const cached = moveGrades.get(state.history.cursor);
  if (cached) {
    gradeBadgeRenderer.show(cached);
    gradeBadgeRenderer.updateStreak(streakForNode(state.history.cursor));
  } else {
    gradeBadgeRenderer.hide();
  }
}

// Restore score bars from cache if available for the current node, otherwise hide
function restoreScoreBarsFromCache() {
  const cached = aiResults.get(state.history.cursor);
  if (cached) {
    scoreBarsRenderer.render(cached);
  } else {
    scoreBarsRenderer.hide();
  }
  hintOverlayRenderer.hide();
}

// Restore from cache and, if "Always show hints" is on, auto-request for uncached nodes
function syncHintModeForCurrentNode() {
  restoreScoreBarsFromCache();
  if (alwaysHintCheckbox?.checked && !aiResults.has(state.history.cursor) && !aiRunning) {
    void requestHint();
  }
}

// --- Inspector

function showInspectorForNode(nodeId, triggerEl) {
  const node = state.history.get(nodeId);
  if (!node) return;
  const grade = moveGrades.get(nodeId) || null;
  const aiResult = node.parent === null ? null : aiResults.get(node.parent) || null;
  inspectorRenderer.show(nodeId, node, grade, aiResult, triggerEl);
}

// --- Debrief

function checkDebrief() {
  const cur = state.history.current();
  if (!canMove(cur.board) && !aiRunning) {
    const totalMoves = state.history.depth();
    // Only include grades from the root-to-cursor path, not abandoned branches
    const path = state.history.pathToCursor();
    const pathGrades = [];
    for (const node of path) {
      const grade = moveGrades.get(node.id);
      if (grade) pathGrades.push(grade);
    }
    debriefRenderer.show(pathGrades, totalMoves);
  } else {
    debriefRenderer.hide();
  }
}

// --- Branch comparison

// Initialize compare board thumbnails with 16 cells each
const compareBoardIds = [
  "compare-board-a3",
  "compare-board-a5",
  "compare-board-b3",
  "compare-board-b5",
];
for (const id of compareBoardIds) {
  const el = document.getElementById(id);
  if (el) {
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement("div");
      cell.className = "inspector-cell";
      el.appendChild(cell);
    }
  }
}

async function aiStep() {
  if (replayMode) {
    if (!state.history.stepForward()) {
      stopAI();
      return;
    }
    renderAll();
    syncURL();
    return;
  }
  const cur = state.history.current();
  if (!canMove(cur.board)) {
    stopAI();
    return;
  }
  // Capture the game epoch so we can detect if newGame was called while
  // we were awaiting the worker. (gameEpoch is separate from the per-
  // request nextRequestId used for worker message routing.)
  const epoch = gameEpoch;
  let result;
  try {
    result = await requestAIMove();
  } catch (error) {
    stopAI();
    setStatusMessage(error instanceof Error ? error.message : String(error), "lose");
    return;
  }
  if (gameEpoch !== epoch) return; // stale — game was reset
  if (result?.stale) return; // stale epoch — retry on next loop iteration
  if (result?.error) {
    stopAI();
    setStatusMessage(result.error, "lose");
    return;
  }
  // Cache AI result and update score bars during autoplay
  const sourceNodeId = state.history.cursor;
  aiResults.set(sourceNodeId, {
    scores: result.scores,
    depth: result.depth,
    ms: result.ms,
  });
  scoreBarsRenderer.render(result);

  const { dir } = result;
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
  cancelHint();
  cancelGrade();
  gradeBadgeRenderer.hide();
  // Terminate grade worker during autoplay — not needed since grading is skipped
  if (gradeWorker) {
    gradeWorker.terminate();
    gradeWorker = null;
  }
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
  hintEpoch++;
  invalidatePendingAIRequests();
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
  const k = e.key;
  if (isWinOverlayOpen()) {
    if (k === "Escape") {
      e.preventDefault();
      winAcknowledged = true;
      hideWinOverlay();
    }
    return;
  }
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
  if (e.shiftKey && (k === "ArrowLeft" || k === "ArrowRight")) {
    e.preventDefault();
    if (aiRunning) stopAI();
    cancelHint();
    cancelGrade();
    if (k === "ArrowLeft") {
      state.history.stepBack();
    } else {
      state.history.stepForward();
    }
    syncHintModeForCurrentNode();
    restoreGradeFromCache();
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
    toggleAI();
  } else if (k === "u" || k === "U") {
    handleUndo();
  } else if (k === "h" || k === "H") {
    void requestHint();
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
const btnNewM = document.getElementById("btn-new-m");
if (btnNewM) {
  btnNewM.addEventListener("click", () => {
    newGame(randomizeSeedInput());
  });
}

if (alwaysHintCheckbox) {
  alwaysHintCheckbox.addEventListener("change", () => {
    if (!alwaysHintCheckbox.checked) {
      cancelHint();
      return;
    }
    if (!aiRunning) syncHintModeForCurrentNode();
  });
}

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

function handleUndo() {
  stopAI();
  cancelHint();
  cancelGrade();
  state.history.stepBack();
  syncHintModeForCurrentNode();
  restoreGradeFromCache();
  renderAll();
  syncURL();
}

function handleRedo() {
  cancelHint();
  cancelGrade();
  state.history.stepForward();
  syncHintModeForCurrentNode();
  restoreGradeFromCache();
  renderAll();
  syncURL();
}

function toggleAI() {
  if (aiRunning) stopAI();
  else startAI();
}

btnUndo.addEventListener("click", handleUndo);
btnRedo.addEventListener("click", handleRedo);

btnHint.addEventListener("click", () => void requestHint());

btnPlayPause.addEventListener("click", toggleAI);

btnShare.addEventListener("click", copyShareLink);
btnWinShare.addEventListener("click", copyShareLink);
btnWinContinue.addEventListener("click", () => {
  winAcknowledged = true;
  hideWinOverlay();
});
btnWinNew.addEventListener("click", () => {
  newGame(randomizeSeedInput());
});

speedInput.addEventListener("input", () => {
  if (speedInputM) speedInputM.value = speedInput.value;
  updateSpeedLabel();
});
if (speedInputM) {
  speedInputM.addEventListener("input", () => {
    speedInput.value = speedInputM.value;
    updateSpeedLabel();
  });
}

// --- Mobile action buttons (mirror desktop handlers)
if (btnUndoM) btnUndoM.addEventListener("click", handleUndo);
if (btnRedoM) btnRedoM.addEventListener("click", handleRedo);
if (btnHintM) btnHintM.addEventListener("click", () => void requestHint());
if (btnPlayPauseM) btnPlayPauseM.addEventListener("click", toggleAI);

// Return focus to the document after any button click so arrow keys
// immediately work for game input instead of being captured by the button.
document.addEventListener("click", (e) => {
  if (e.target instanceof HTMLButtonElement) {
    e.target.blur();
  }
});

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
