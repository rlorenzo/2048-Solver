// Timeline renderer: one tick per move along the path from root to cursor.
// Highlights direction-changes (vs previous move) and branch points (nodes
// whose parent has multiple children).

const DIR_CLASSES = ["tick-up", "tick-right", "tick-down", "tick-left"];

export function createTimelineRenderer(container, onTickClick) {
  container.addEventListener("click", (e) => {
    const target = e.target.closest("[data-node-id]");
    if (!target) return;
    const id = parseInt(target.dataset.nodeId, 10);
    onTickClick(id);
  });

  function render(history) {
    const path = history.pathToCursor();
    container.innerHTML = "";

    let prevDir = null;
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      const tick = document.createElement("div");
      tick.dataset.nodeId = String(node.id);

      if (node.dir === null) {
        // Root: just a neutral marker
        tick.className = "tick";
        tick.style.background = "var(--accent)";
        tick.title = "Start";
      } else {
        const isTurn = prevDir !== null && node.dir !== prevDir;
        const parent = history.get(node.parent);
        const isBranch = parent.children.size > 1;
        tick.className = `tick ${DIR_CLASSES[node.dir]}`;
        if (isTurn) tick.classList.add("turn");
        if (isBranch) tick.classList.add("branch");
        tick.title = describeTick(i, node.dir, isTurn, isBranch);
        prevDir = node.dir;
      }
      if (node.id === history.cursor) tick.classList.add("current");
      container.appendChild(tick);
    }

    // Auto-scroll to keep cursor tick visible
    const current = container.querySelector(".tick.current");
    if (current) current.scrollIntoView({ block: "nearest", inline: "center" });
  }

  return { render };
}

function describeTick(index, dir, isTurn, isBranch) {
  const names = ["Up", "Right", "Down", "Left"];
  const parts = [`Move ${index}: ${names[dir]}`];
  if (isTurn) parts.push("(direction change)");
  if (isBranch) parts.push("(branch point)");
  return parts.join(" ");
}
