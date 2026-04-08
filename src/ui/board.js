// Render the 4x4 board grid into a container element.
import { CELLS } from "../game/board.js";

export function createBoardRenderer(container) {
  const cells = [];
  container.innerHTML = "";
  for (let i = 0; i < CELLS; i++) {
    const el = document.createElement("div");
    el.className = "cell empty";
    container.appendChild(el);
    cells.push(el);
  }

  // ── Tile overlay layer ──────────────────────────────────────────
  const shell = container.closest(".board-shell");
  const tileLayer = document.createElement("div");
  tileLayer.className = "tile-layer";
  tileLayer.setAttribute("aria-hidden", "true");
  // Insert before the win overlay (z-index: 2) so tile-layer is between board and overlay
  const winOverlay = shell.querySelector(".win-overlay");
  if (winOverlay) {
    shell.insertBefore(tileLayer, winOverlay);
  } else {
    shell.appendChild(tileLayer);
  }

  // ── Cell position caching ───────────────────────────────────────
  const cellPositions = Array.from({ length: CELLS });

  function cacheCellPositions() {
    for (let i = 0; i < CELLS; i++) {
      cellPositions[i] = {
        x: cells[i].offsetLeft,
        y: cells[i].offsetTop,
        size: cells[i].offsetWidth,
      };
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    cacheCellPositions();
    // If an animation is in progress, cancel it — positions changed
    if (cancelCleanup) {
      cancelCurrentAnimation();
      // Re-render without animation to snap to correct state
      if (lastBoard) instantRender(lastBoard, undefined);
    }
  });
  resizeObserver.observe(container);
  cacheCellPositions();

  // ── Reduced-motion gate ─────────────────────────────────────────
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  motionQuery.addEventListener("change", (e) => {
    reducedMotion = e.matches;
  });

  // ── State ───────────────────────────────────────────────────────
  let prevExps = new Uint8Array(CELLS);
  let lastBoard = null;
  let currentAnimId = 0;
  let cancelCleanup = null; // function to clean up current animation

  // ── Cancel running animation ────────────────────────────────────
  function cancelCurrentAnimation() {
    currentAnimId++;
    if (cancelCleanup) {
      cancelCleanup();
      cancelCleanup = null;
    }
  }

  // ── Instant render (existing behavior) ──────────────────────────
  function instantRender(board, spawnPos) {
    lastBoard = board;
    for (let i = 0; i < CELLS; i++) {
      const exp = board[i];
      const cell = cells[i];
      const newClass = exp === 0 ? "cell empty" : `cell ${tileClass(exp)}`;
      if (cell.className.split(" ").slice(0, 2).join(" ") !== newClass) {
        cell.className = newClass;
      }
      cell.textContent = exp === 0 ? "" : String(2 ** exp);
      cell.style.visibility = "";

      // Animation classes
      cell.classList.remove("new", "merged");
      if (exp !== 0 && prevExps[i] === 0 && i === spawnPos) {
        cell.classList.add("new");
      } else if (exp !== 0 && prevExps[i] !== 0 && exp > prevExps[i]) {
        cell.classList.add("merged");
      }
    }
    prevExps = new Uint8Array(board);
  }

  // ── Animated move ───────────────────────────────────────────────
  function animateMove(trajectories, board, mergedCells, spawnPos) {
    lastBoard = board;
    const animId = ++currentAnimId;

    // Build set of destination indices to suppress
    const suppressSet = new Set();
    for (const t of trajectories) suppressSet.add(t.to);
    if (spawnPos != null) suppressSet.add(spawnPos);

    // 1. Render post-move board, suppressing destinations and spawn
    for (let i = 0; i < CELLS; i++) {
      const exp = board[i];
      const cell = cells[i];
      cell.className = exp === 0 ? "cell empty" : `cell ${tileClass(exp)}`;
      cell.textContent = exp === 0 ? "" : String(2 ** exp);
      cell.classList.remove("new", "merged");
      cell.style.visibility = suppressSet.has(i) ? "hidden" : "";
    }

    // 2. Create .tile-anim divs at source positions
    const animEls = [];
    for (const t of trajectories) {
      const div = document.createElement("div");
      const val = 2 ** t.exp;
      div.className = `tile-anim ${tileClass(t.exp)}`;
      div.textContent = String(val);
      const src = cellPositions[t.from];
      div.style.left = src.x + "px";
      div.style.top = src.y + "px";
      div.style.width = src.size + "px";
      div.style.height = src.size + "px";
      tileLayer.appendChild(div);
      animEls.push({ div, from: t.from, to: t.to });
    }

    return new Promise((resolve) => {
      let settled = false;

      function cleanup() {
        if (settled) return;
        settled = true;
        // Remove overlay tiles
        for (const a of animEls) {
          if (a.div.parentNode) a.div.parentNode.removeChild(a.div);
        }
      }

      // Register cancellation cleanup
      cancelCleanup = () => {
        cleanup();
        // Unsuppress all cells
        for (let i = 0; i < CELLS; i++) cells[i].style.visibility = "";
        resolve();
      };

      // 3. Next frame: apply transforms to trigger CSS transition
      requestAnimationFrame(() => {
        if (animId !== currentAnimId) return;

        for (const a of animEls) {
          const dx = cellPositions[a.to].x - cellPositions[a.from].x;
          const dy = cellPositions[a.to].y - cellPositions[a.from].y;
          a.div.style.transform = `translate(${dx}px, ${dy}px)`;
        }

        // 4. Wait for transitions to end (120ms + 20ms safety fallback)
        let transitionDone = false;

        function onSlideEnd() {
          if (transitionDone || animId !== currentAnimId) return;
          transitionDone = true;

          // 5. Remove overlays
          cleanup();

          // Unsuppress trajectory destination cells
          for (const t of trajectories) {
            cells[t.to].style.visibility = "";
          }

          // Apply .merged class
          if (mergedCells) {
            for (const idx of mergedCells) {
              cells[idx].classList.add("merged");
            }
          }

          // After 50ms: unsuppress spawn and apply .new
          if (spawnPos != null) {
            setTimeout(() => {
              if (animId !== currentAnimId) {
                resolve();
                return;
              }
              cells[spawnPos].style.visibility = "";
              cells[spawnPos].classList.add("new");
              prevExps = new Uint8Array(board);
              cancelCleanup = null;
              resolve();
            }, 50);
          } else {
            prevExps = new Uint8Array(board);
            cancelCleanup = null;
            resolve();
          }
        }

        // Listen for transitionend on first overlay tile
        if (animEls.length > 0) {
          animEls[0].div.addEventListener("transitionend", onSlideEnd, {
            once: true,
          });
        }
        // Fallback timeout in case transitionend doesn't fire
        setTimeout(onSlideEnd, 140);
      });
    });
  }

  // ── Public render ───────────────────────────────────────────────
  function render(board, opts = {}) {
    const { spawnPos, trajectories, mergedCells } = opts;
    cancelCurrentAnimation();

    if (reducedMotion || !trajectories || trajectories.length === 0) {
      instantRender(board, spawnPos);
      return Promise.resolve();
    }
    return animateMove(trajectories, board, mergedCells, spawnPos);
  }

  function reset() {
    cancelCurrentAnimation();
    prevExps = new Uint8Array(CELLS);
    lastBoard = null;
    // Clear any leftover overlay tiles
    tileLayer.innerHTML = "";
    for (let i = 0; i < CELLS; i++) cells[i].style.visibility = "";
  }

  return { render, reset };
}

function tileClass(exp) {
  const v = 2 ** exp;
  if (v >= 4096) return "v-super";
  return `v-${v}`;
}
