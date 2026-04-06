// Timeline renderer: one tick per move along the path from root to cursor.
// Highlights direction-changes (vs previous move) and branch points (nodes
// whose parent has multiple children).
// Ticks are rendered as <button> elements for keyboard/screen-reader access.
//
// Performance: instead of clearing innerHTML and recreating all ticks on
// every render, we diff the path against the previous render and only
// create/remove/update ticks that changed. scrollIntoView is only called
// when the cursor position actually moved.

const DIR_CLASSES = ["tick-up", "tick-right", "tick-down", "tick-left"];

export function createTimelineRenderer(container, onTickClick) {
  container.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const target = e.target.closest("[data-node-id]");
    if (!target) return;
    const id = parseInt(target.dataset.nodeId, 10);
    if (!Number.isFinite(id)) return;
    onTickClick(id);
  });

  // State from the previous render for incremental updates.
  let prevPathIds = []; // node ids in order
  let prevCursorId = -1;
  let tickElements = []; // parallel array of DOM <button> elements

  function render(history) {
    const path = history.pathToCursor();
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

    // Create/update ticks from commonLen onward.
    let prevDir = commonLen > 0 ? path[commonLen - 1].dir : null;
    for (let i = commonLen; i < path.length; i++) {
      const node = path[i];
      const tick = document.createElement("button");
      tick.type = "button";
      tick.dataset.nodeId = String(node.id);

      if (node.dir === null) {
        tick.className = "tick";
        tick.style.background = "var(--accent)";
        tick.setAttribute("aria-label", "Start");
      } else {
        const isTurn = prevDir !== null && node.dir !== prevDir;
        const parent = history.get(node.parent);
        const isBranch = parent.children.size > 1;
        tick.className = `tick ${DIR_CLASSES[node.dir]}`;
        if (isTurn) tick.classList.add("turn");
        if (isBranch) tick.classList.add("branch");
        tick.setAttribute("aria-label", describeTick(i, node.dir, isTurn, isBranch));
        prevDir = node.dir;
      }
      container.appendChild(tick);
      tickElements.push(tick);
    }

    // Update the "current" highlight — only touch the two affected ticks.
    if (cursorId !== prevCursorId) {
      for (const el of tickElements) {
        const id = parseInt(el.dataset.nodeId, 10);
        if (id === prevCursorId) {
          el.classList.remove("current");
          el.removeAttribute("aria-current");
        }
        if (id === cursorId) {
          el.classList.add("current");
          el.setAttribute("aria-current", "step");
        }
      }
    }

    // Cache state for next render.
    prevPathIds = path.map((n) => n.id);
    const cursorChanged = cursorId !== prevCursorId;
    prevCursorId = cursorId;

    // Only scroll when the cursor actually moved (avoids forced layout on
    // every render during autoplay when cursor advances by one tick).
    if (cursorChanged) {
      const current = container.querySelector(".tick.current");
      if (current) current.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }

  function reset() {
    prevPathIds = [];
    prevCursorId = -1;
    tickElements = [];
    container.innerHTML = "";
  }

  return { render, reset };
}

function describeTick(index, dir, isTurn, isBranch) {
  const names = ["Up", "Right", "Down", "Left"];
  const parts = [`Move ${index}: ${names[dir]}`];
  if (isTurn) parts.push("(direction change)");
  if (isBranch) parts.push("(branch point)");
  return parts.join(" ");
}
