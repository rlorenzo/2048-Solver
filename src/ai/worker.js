// AI Web Worker — receives a Uint8Array(16) board from the UI, converts to
// the bitboard representation, runs expectimax, returns the best move.
// Wrapped in try/catch so a conversion or search failure always sends a
// response rather than silently terminating the worker.
import { bestMove } from "./expectimax.js";
import { fromBytes } from "./bitboard.js";

const MAX_SEARCH_DEPTH = 8;

function sanitizeDepth(depth) {
  if (depth === "auto") return depth;
  if (typeof depth !== "number" || !Number.isFinite(depth)) return 0;
  return Math.max(0, Math.min(Math.trunc(depth), MAX_SEARCH_DEPTH));
}

self.addEventListener("message", (e) => {
  const id = e?.data?.id;
  // Pass through type and epoch fields unchanged for caller routing.
  const type = e?.data?.type;
  const epoch = e?.data?.epoch;
  try {
    const { board, depth } = e.data;
    const bytes = new Uint8Array(board);
    const bits = fromBytes(bytes);
    const safeDepth = sanitizeDepth(depth);
    const t0 = performance.now();
    const result = bestMove(bits, safeDepth);
    const ms = performance.now() - t0;
    self.postMessage({ id, ...result, ms, type, epoch });
  } catch (err) {
    self.postMessage({
      id,
      dir: -1,
      scores: [0, 0, 0, 0],
      depth: 0,
      error: err instanceof Error ? err.message : String(err),
      type,
      epoch,
    });
  }
});
