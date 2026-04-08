# CLAUDE.md

## Build System: Vite+ (vp)

This project uses **Vite+** (`vp`) as its CLI. All commands go through `vp`:

```bash
vp dev          # Start dev server
vp build        # Production build
vp test run     # Run all tests (Vitest)
vp check        # Lint + format check + type check
vp lint         # Oxlint (type-aware)
vp fmt          # Oxfmt
vp check --fix  # Auto-fix lint/format issues
```

Package manager: **pnpm@10.33.0** (enforced via `packageManager` field).

Linting and formatting use Vite+ built-ins (Oxlint, Oxfmt) — no separate ESLint/Prettier configs. Config lives in `vite.config.ts`. Pre-commit hook runs `vp staged` (which runs `vp check --fix` on staged files).

## Project Structure

```
src/
├── main.js              # Controller: input, UI wiring, AI loop, URL sync
├── style.css            # All styles, CSS custom properties, responsive
├── game/
│   ├── constants.js     # DIR enum (UP=0, RIGHT=1, DOWN=2, LEFT=3), labels
│   ├── board.js         # Core game logic (pure functions)
│   ├── history.js       # Branching move tree with cursor
│   └── rng.js           # mulberry32 seeded PRNG
├── ai/
│   ├── bitboard.js      # 4×uint16 bitboard, precomputed slide tables
│   ├── heuristics.js    # 65536-entry row score lookup
│   ├── expectimax.js    # Depth-limited search with transposition cache
│   └── worker.js        # Web Worker wrapper
├── ui/                  # Factory-function renderers (no framework)
│   ├── board.js         # Grid + tile overlay animations
│   ├── timeline.js      # Scrubbable timeline with branch markers
│   └── ...              # score-bars, grade-badge, hint-overlay, etc.
├── coaching/
│   └── diagnose.js      # Move grading and board analysis (pure, no DOM)
└── share/
    └── url.js           # URL encode/decode (seed + packed moves)

tests/                   # Vitest: *.test.js pattern
public/                  # Static assets: strategy.html, icons, fonts
```

## Key Architecture

### Board representation

`Uint8Array[16]`, row-major, storing **exponents**: 0=empty, 1→2, 2→4, ..., 11→2048. All game functions are pure (no input mutation).

### AI

Runs in a **Web Worker**. Converts board to bitboard (4×uint16, 4 bits per cell) for fast expectimax search with precomputed 65536-entry row-slide tables. Depth 6-8, adaptive.

### History

A **tree**, not a linear stack. Rewinding and playing a different direction creates a sibling branch. Nodes store board, score, spawn info, and children.

### Deterministic spawns

Seeded RNG (`mulberry32`). Same (seed, move-path) always produces the same spawn. This makes games shareable and replayable via URL.

### URL state

`#s=<seed>&m=<base64url-moves>&p=<cursor>`. Moves packed 2 bits each (U=0, R=1, D=2, L=3).

### UI pattern

All renderers are factory functions: `createXxxRenderer(container)` returns `{ render, reset, ... }`. Vanilla JS, no framework.

### Tile slide animations

Overlay-based: temporary `.tile-anim` divs slide via CSS `transform: translate()` (120ms), then are removed. Suppressed base grid cells are revealed after slide completes. Animation skipped when: `prefers-reduced-motion`, AI speed > ~3/s, undo/redo, timeline scrub.

## Code Conventions

- ES modules, `"type": "module"`
- No classes except `History` — prefer factory functions
- Pure functions in `game/` and `coaching/` (no DOM, no side effects)
- CSS custom properties for theming (`--bg`, `--text`, `--tile-*`, etc.)
- Import test utilities from `"vite-plus/test"` (not `vitest`)

## CI/CD

GitHub Actions (`.github/workflows/ci-deploy.yml`): install → check → test → build → deploy to GitHub Pages at `/2048-Solver/`.
