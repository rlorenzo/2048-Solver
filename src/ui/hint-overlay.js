// Hint overlay renderer: directional arrow overlay on the board with edge-glow.
// Positioned absolute within .board-shell.

import { DIR_ARROWS, DIR_LABELS } from "../game/constants.js";

// Edge-glow box-shadow directions: top, right, bottom, left
const EDGE_GLOW = [
  "inset 0 6px 18px -4px rgba(237, 194, 46, 0.45)",
  "inset -6px 0 18px -4px rgba(237, 194, 46, 0.45)",
  "inset 0 -6px 18px -4px rgba(237, 194, 46, 0.45)",
  "inset 6px 0 18px -4px rgba(237, 194, 46, 0.45)",
];

export function createHintOverlayRenderer(boardShellEl) {
  const overlay = document.createElement("div");
  overlay.className = "hint-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");
  boardShellEl.appendChild(overlay);

  const arrow = document.createElement("span");
  arrow.className = "hint-arrow";
  overlay.appendChild(arrow);

  function show(dir) {
    arrow.textContent = DIR_ARROWS[dir];
    arrow.className = `hint-arrow hint-arrow-${DIR_LABELS[dir].toLowerCase()}`;
    overlay.classList.remove("hidden");

    // Edge glow on the board container
    boardShellEl.style.boxShadow = EDGE_GLOW[dir];
    boardShellEl.classList.add("hint-glow");
  }

  function hide() {
    overlay.classList.add("hidden");
    boardShellEl.style.boxShadow = "";
    boardShellEl.classList.remove("hint-glow");
  }

  function reset() {
    hide();
  }

  return { show, hide, reset };
}
