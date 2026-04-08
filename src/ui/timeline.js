// Timeline renderer: one tick per move along the visible branch from root to
// leaf, following each node's preferred child. This lets replay links show
// the full recorded path immediately while keeping future ticks clickable.
// Highlights direction-changes (vs previous move) and branch points (nodes
// whose parent has multiple children).
// Ticks are rendered as <button> elements for keyboard/screen-reader access.
//
// Performance: instead of clearing innerHTML and recreating all ticks on
// every render, we diff the path against the previous render and only
// create/remove/update ticks that changed. scrollIntoView is only called
// when the cursor position actually moved.

import { DIR_ARROWS } from "../game/constants.js";

const DIR_CLASSES = ["tick-up", "tick-right", "tick-down", "tick-left"];

const GRADE_TICK_CLASS = {
  best: "tick-grade-best",
  good: "tick-grade-good",
  ok: "tick-grade-ok",
  mistake: "tick-grade-mistake",
  blunder: "tick-grade-blunder",
};

export function createTimelineRenderer(container, onTickClick, onTickHover) {
  container.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const target = e.target.closest("[data-node-id]");
    if (!target) return;
    const id = parseInt(target.dataset.nodeId, 10);
    if (!Number.isFinite(id)) return;
    onTickClick(id, target);
  });

  if (onTickHover) {
    // Use pointerover/pointerout instead of pointerenter/pointerleave —
    // the latter don't bubble, so container-level delegation never fires
    // for individual tick elements.
    container.addEventListener("pointerover", (e) => {
      if (!(e.target instanceof Element)) return;
      const target = e.target.closest("[data-node-id]");
      if (!target) return;
      const id = parseInt(target.dataset.nodeId, 10);
      if (!Number.isFinite(id)) return;
      onTickHover(id, target);
    });

    container.addEventListener("pointerout", (e) => {
      if (!(e.target instanceof Element)) return;
      const target = e.target.closest("[data-node-id]");
      if (!target) return;
      // Only dismiss when the pointer leaves a tick entirely (not moving
      // to a child element within the same tick).
      const related =
        e.relatedTarget instanceof Element ? e.relatedTarget.closest("[data-node-id]") : null;
      if (related === target) return;
      onTickHover(null, null);
    });
  }

  // State from the previous render for incremental updates.
  let prevPathIds = []; // node ids in order
  let prevCursorId = -1;
  let prevCursorIdx = -1; // index into tickElements of the current tick
  let tickElements = []; // parallel array of DOM <button> elements

  function render(history, moveGrades) {
    const path = history.preferredPathFromRoot();
    const cursorId = history.cursor;

    // Determine the common prefix length (ticks that haven't changed).
    let commonLen = 0;
    while (
      commonLen < prevPathIds.length &&
      commonLen < path.length &&
      prevPathIds[commonLen] === path[commonLen].id
    ) {
      commonLen++;
    }

    // Remove ticks past the common prefix.
    while (tickElements.length > commonLen) {
      container.removeChild(tickElements.pop());
    }

    // Update retained ticks so derived styling/ARIA stays in sync even when
    // node ids are unchanged but grade state changes.
    for (let i = 0; i < commonLen; i++) {
      configureTick(tickElements[i], path[i], i, moveGrades);
    }

    // Create/update ticks from commonLen onward.
    for (let i = commonLen; i < path.length; i++) {
      const node = path[i];
      const tick = document.createElement("button");
      tick.type = "button";
      tick.dataset.nodeId = String(node.id);
      configureTick(tick, node, i, moveGrades);
      container.appendChild(tick);
      tickElements.push(tick);
    }

    // Update the "current" highlight — touch only the old and new tick by
    // index rather than looping all elements.
    const cursorChanged = cursorId !== prevCursorId;
    if (cursorChanged) {
      if (prevCursorIdx >= 0 && prevCursorIdx < tickElements.length) {
        tickElements[prevCursorIdx].classList.remove("current");
        tickElements[prevCursorIdx].removeAttribute("aria-current");
      }
      const newIdx = history.depth();
      if (newIdx >= 0 && newIdx < tickElements.length) {
        tickElements[newIdx].classList.add("current");
        tickElements[newIdx].setAttribute("aria-current", "step");
      }
      prevCursorIdx = newIdx;
    }
    if (prevCursorIdx >= 0 && prevCursorIdx < tickElements.length) {
      tickElements[prevCursorIdx].classList.add("current");
      tickElements[prevCursorIdx].setAttribute("aria-current", "step");
    }

    // Cache state for next render.
    prevPathIds = path.map((n) => n.id);
    prevCursorId = cursorId;

    // Only scroll when the cursor actually moved (avoids forced layout on
    // every render during autoplay when cursor advances by one tick).
    if (cursorChanged) {
      const el = prevCursorIdx >= 0 ? tickElements[prevCursorIdx] : null;
      if (el) {
        // Scroll within the timeline container only — avoid scrollIntoView
        // which also scrolls ancestor elements (pushes the board off-screen
        // on mobile during autoplay).
        const left = el.offsetLeft - container.offsetWidth / 2 + el.offsetWidth / 2;
        container.scrollLeft = Math.max(0, left);
      }
    }
  }

  function reset() {
    prevPathIds = [];
    prevCursorId = -1;
    prevCursorIdx = -1;
    tickElements = [];
    container.innerHTML = "";
  }

  return { render, reset };
}

function configureTick(tick, node, index, moveGrades) {
  tick.dataset.nodeId = String(node.id);
  tick.removeAttribute("aria-current");
  if (node.dir === null) {
    tick.className = "tick";
    tick.style.background = "var(--accent)";
    tick.textContent = "\u25CF";
    tick.setAttribute("aria-label", "Start");
    return;
  }

  tick.className = `tick ${DIR_CLASSES[node.dir]}`;
  tick.style.background = "";
  tick.textContent = DIR_ARROWS[node.dir];

  // Apply grade coloring if available
  const grade = moveGrades?.get(node.id);
  if (grade) {
    const gradeClass = GRADE_TICK_CLASS[grade.grade];
    if (gradeClass) tick.classList.add(gradeClass);
  }

  tick.setAttribute("aria-label", describeTick(index, node.dir, grade));
}

function describeTick(index, dir, grade) {
  const names = ["Up", "Right", "Down", "Left"];
  const parts = [`Move ${index}: ${names[dir]}`];
  if (grade) parts.push(`[${grade.grade}]`);
  return parts.join(" ");
}
