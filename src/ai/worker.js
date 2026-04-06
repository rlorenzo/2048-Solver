// AI Web Worker — receives a Uint8Array(16) board from the UI, converts to
// the bitboard representation, runs expectimax, returns the best move.
// Wrapped in try/catch so a conversion or search failure always sends a
// response rather than silently terminating the worker.
import { bestMove } from "./expectimax.js";
import { fromBytes } from "./bitboard.js";

self.addEventListener("message", (e) => {
  const id = e?.data?.id;
  try {
    const { board, depth } = e.data;
    const bytes = new Uint8Array(board);
    const bits = fromBytes(bytes);
    const t0 = performance.now();
    const result = bestMove(bits, depth);
    const ms = performance.now() - t0;
    self.postMessage({ id, ...result, ms });
  } catch (err) {
    self.postMessage({
      id,
      dir: -1,
      scores: [0, 0, 0, 0],
      depth: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
