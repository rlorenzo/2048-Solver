# 2048 Solver

A local 2048 web app with human play, AI auto-play, timeline scrubbing with
branching rollback, and shareable seed-based replays.

## Features

- **Play** with arrow keys or swipe. Seeded RNG (`mulberry32`) means every
  game is reproducible.
- **Watch the AI play** at configurable speed (1–200 moves/sec) and depth.
- **Scrub the timeline** forward and backward through any game. Ticks are
  color-coded by direction; a highlighted outline marks direction changes
  and a small dot marks branch points.
- **Branching rollback**: rewind to any point and play a different move —
  the old branch is preserved as a sibling you can jump back to.
- **Shareable URLs**: the game state (seed + move list + cursor) is encoded
  in the URL hash. Paste a link and the recipient replays the exact game
  with the exact tile spawns.

## Quick start

Requires [Vite+](https://viteplus.dev) (one-time install):

```bash
curl -fsSL https://vite.plus | bash
```

Then:

```bash
vp install          # install dependencies (wraps pnpm)
vp dev              # start dev server
vp test run         # run tests
vp check            # lint + format check
vp build            # production build
vp preview          # serve built output
```

## Controls

| Key                   | Action                      |
| --------------------- | --------------------------- |
| `←` `↑` `→` `↓`       | Play a move                 |
| `Shift + ←` / `→`     | Scrub timeline back/forward |
| `Space`               | Start/pause AI              |
| `N`                   | New game with random seed   |
| Click a timeline tick | Jump cursor to that move    |

## Architecture

```
src/
├── main.js            Controller: input, UI wiring, AI loop, URL sync
├── game/
│   ├── board.js       Board model (Uint8Array(16) of log2 values)
│   ├── rng.js         mulberry32 seeded PRNG
│   └── history.js     Branching move tree (cursor + siblings)
├── ai/
│   ├── bitboard.js    Fast bitboard repr (4×uint16 rows) + move tables
│   ├── heuristics.js  Row-lookup evaluate() (65536-entry table)
│   ├── expectimax.js  Depth-limited expectimax with transposition cache
│   └── worker.js      Web Worker wrapper (non-blocking AI)
├── ui/
│   ├── board.js       Grid renderer with spawn/merge animations
│   └── timeline.js    Scrubbable timeline with turn/branch markers
└── share/
    └── url.js         Hash encode/decode (seed + packed moves)
```

### How the AI works

Expectimax search on a bitboard representation:

- **Board**: 4 × 16-bit rows, each packing 4 cells × 4 bits (cell value is
  `log2(tile)`). Moves become per-row lookups via two precomputed 65536-entry
  tables (left-slide and right-slide). Up/down transpose to column-shifts.
- **Evaluation**: line-based heuristic adapted from
  [nneonneo/2048-ai](https://github.com/nneonneo/2048-ai) — empty cells,
  possible merges, monotonicity (to rank<sup>4</sup>), and a penalty on the
  sum (to rank<sup>3.5</sup>), applied to all 4 rows + 4 columns via an 8-
  lookup `evaluate()`.
- **Search depth**: auto-adaptive (6 → 8 as the board fills up). Users can
  pick a fixed depth 3–7 from the dropdown.
- **Transposition cache**: memoizes `(board, depth)` within a single search.
- **Runs in a Web Worker** so UI scrubbing and animation stay smooth during
  AI play.

Is 2048 deterministically solvable? No — tile spawns are random, so no
algorithm can guarantee a win on every RNG draw. But with depth ≥ 6 this
solver reaches 2048 on essentially every seed (and 4096 on most) in our
testing.

### URL format

```
#s=<seed>&m=<packed-moves>&p=<cursor>
```

- `s`: unsigned 32-bit seed (decimal)
- `m`: base64-ish packed move list (2 bits per move) followed by `.<length>`
  (base-36)
- `p`: cursor position (omitted when cursor is at end)

### Branching history

Each move appends a new node to a tree. When you rewind the cursor and play
a different direction, a new sibling is created; the old branch stays alive.
The timeline renders the current root→cursor path and marks any node whose
parent has >1 child with a small blue dot. The share-link captures the
forward-most path from the root, not just the current cursor.

## Tests

```bash
vp test run
```

Covers:

- Move logic + score calculation
- Differential parity between the Uint8Array and bitboard move
  implementations (2000 random positions × 4 directions)
- History tree: cursor, branching, sibling detection, move-path reconstruction
- URL encoding round-trip on random move sequences up to 1000 moves
- Heuristic ordering + best-move sanity

## Attribution

AI heuristic design follows [Robert Xiao's nneonneo/2048-ai](https://github.com/nneonneo/2048-ai)
(MIT). The original 2048 game is by [Gabriele Cirulli](https://github.com/gabrielecirulli/2048)
(MIT).

## License

MIT.
