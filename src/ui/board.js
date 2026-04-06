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

  let prevExps = new Uint8Array(CELLS);

  function render(board, opts = {}) {
    const { spawnPos } = opts;
    for (let i = 0; i < CELLS; i++) {
      const exp = board[i];
      const cell = cells[i];
      const newClass = exp === 0 ? "cell empty" : `cell ${tileClass(exp)}`;
      if (cell.className.split(" ").slice(0, 2).join(" ") !== newClass) {
        cell.className = newClass;
      }
      cell.textContent = exp === 0 ? "" : String(2 ** exp);

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

  function reset() {
    prevExps = new Uint8Array(CELLS);
  }

  return { render, reset };
}

function tileClass(exp) {
  const v = 2 ** exp;
  if (v >= 4096) return "v-super";
  return `v-${v}`;
}
