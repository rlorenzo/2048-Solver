// Move inspector renderer: detail popover for any timeline tick.
// Shows board thumbnail, AI scores, grade, and coaching note.
// Factory pattern matching createBoardRenderer / createTimelineRenderer.

import { DIR_LABELS, GRADE_TEXT } from "../game/constants.js";

const GRADE_CLASS = {
  best: "inspector-grade-perfect",
  good: "inspector-grade-green",
  ok: "inspector-grade-yellow",
  mistake: "inspector-grade-orange",
  blunder: "inspector-grade-red",
};

export function createInspectorRenderer(container) {
  container.innerHTML = "";
  container.className = "inspector hidden";
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Move inspector");
  container.tabIndex = -1;

  // Header with close button
  const header = document.createElement("div");
  header.className = "inspector-header";

  const title = document.createElement("span");
  title.className = "inspector-title";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn inspector-close";
  closeBtn.textContent = "\u00d7";
  closeBtn.setAttribute("aria-label", "Close inspector");
  closeBtn.type = "button";
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Board thumbnail
  const boardThumb = document.createElement("div");
  boardThumb.className = "inspector-board";
  boardThumb.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 16; i++) {
    const cell = document.createElement("div");
    cell.className = "inspector-cell";
    boardThumb.appendChild(cell);
  }
  container.appendChild(boardThumb);

  // Grade row
  const gradeRow = document.createElement("div");
  gradeRow.className = "inspector-grade-row hidden";
  container.appendChild(gradeRow);

  // Score summary
  const scoreSummary = document.createElement("div");
  scoreSummary.className = "inspector-scores hidden";
  container.appendChild(scoreSummary);

  // Coach note
  const noteEl = document.createElement("div");
  noteEl.className = "inspector-note hidden";
  container.appendChild(noteEl);

  let currentNodeId = null;
  let triggerElement = null;

  function renderBoard(board) {
    const cells = boardThumb.children;
    for (let i = 0; i < 16; i++) {
      const exp = board[i];
      const cell = cells[i];
      if (exp === 0) {
        cell.className = "inspector-cell inspector-cell-empty";
        cell.textContent = "";
      } else {
        const v = 2 ** exp;
        const sizeClass = v >= 4096 ? "inspector-cell-super" : `inspector-cell-${v}`;
        cell.className = `inspector-cell ${sizeClass}`;
        cell.textContent = String(v);
      }
    }
  }

  function show(nodeId, node, grade, aiResult, trigger) {
    currentNodeId = nodeId;
    triggerElement = trigger || null;

    // Title
    const moveLabel = node.dir !== null ? `Move ${node.depth}: ${DIR_LABELS[node.dir]}` : "Start";
    title.textContent = moveLabel;

    // Board thumbnail
    renderBoard(node.board);

    // Grade
    if (grade) {
      gradeRow.className = `inspector-grade-row ${GRADE_CLASS[grade.grade] || ""}`;
      gradeRow.textContent = GRADE_TEXT[grade.grade] || grade.grade;
      gradeRow.classList.remove("hidden");
    } else {
      gradeRow.className = "inspector-grade-row hidden";
    }

    // AI scores
    if (aiResult) {
      const bestScore = Math.max(...aiResult.scores);
      const bestDir = aiResult.scores.indexOf(bestScore);
      const lines = aiResult.scores.map((s, i) => {
        const marker = i === bestDir ? " *" : "";
        return `${DIR_LABELS[i]}: ${Math.round(s).toLocaleString()}${marker}`;
      });
      scoreSummary.textContent = lines.join("  ");
      scoreSummary.classList.remove("hidden");
    } else {
      scoreSummary.className = "inspector-scores hidden";
    }

    // Coach note
    if (grade?.coachNote) {
      noteEl.textContent = grade.coachNote;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.className = "inspector-note hidden";
    }

    container.classList.remove("hidden");
    container.focus();
  }

  function hide() {
    container.classList.add("hidden");
    currentNodeId = null;
    if (triggerElement && typeof triggerElement.focus === "function") {
      triggerElement.focus();
    }
    triggerElement = null;
  }

  function isOpen() {
    return !container.classList.contains("hidden");
  }

  function getCurrentNodeId() {
    return currentNodeId;
  }

  function reset() {
    hide();
    triggerElement = null;
  }

  // Close on Escape
  container.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  });

  closeBtn.addEventListener("click", () => hide());

  return { show, hide, isOpen, getCurrentNodeId, reset };
}
