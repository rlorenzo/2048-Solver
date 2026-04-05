// AI Web Worker — receives a board, returns the best move.
import { bestMove } from "./expectimax.js";

self.addEventListener("message", (e) => {
  const { id, board, depth } = e.data;
  const buf = new Uint8Array(board);
  const t0 = performance.now();
  const result = bestMove(buf, depth);
  const ms = performance.now() - t0;
  self.postMessage({ id, ...result, ms });
});
