// AI Web Worker — receives a Uint8Array(16) board from the UI, converts to
// the bitboard representation, runs expectimax, returns the best move.
import { bestMove } from "./expectimax.js";
import { fromBytes } from "./bitboard.js";

self.addEventListener("message", (e) => {
  const { id, board, depth } = e.data;
  const bytes = new Uint8Array(board);
  const bits = fromBytes(bytes);
  const t0 = performance.now();
  const result = bestMove(bits, depth);
  const ms = performance.now() - t0;
  self.postMessage({ id, ...result, ms });
});
