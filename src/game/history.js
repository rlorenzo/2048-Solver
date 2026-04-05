// History as a tree of nodes. Each node captures the board state AFTER a move
// (or the initial board). Branching happens when the user rewinds and plays
// a different direction; the old branch is retained as a sibling.
//
// Node shape:
//   id: number
//   parent: id | null
//   dir: 0-3 | null (null for root)
//   spawn: { pos, exp } | null  (tile spawned AFTER the move)
//   board: Uint8Array
//   score: total score at this node
//   children: Map<dir, id>

import { cloneBoard } from "./board.js";

export class History {
  constructor(rootBoard, initialSpawns) {
    this.nodes = new Map();
    this.nextId = 0;
    this.root = this._add(null, null, null, cloneBoard(rootBoard), 0);
    // Attach initial spawns to the root for replay purposes
    this.nodes.get(this.root).initialSpawns = initialSpawns;
    this.cursor = this.root;
  }

  _add(parent, dir, spawn, board, score) {
    const id = this.nextId++;
    this.nodes.get(parent)?.children.set(dir, id);
    this.nodes.set(id, {
      id,
      parent,
      dir,
      spawn,
      board,
      score,
      children: new Map(),
    });
    return id;
  }

  current() {
    return this.nodes.get(this.cursor);
  }

  get(id) {
    return this.nodes.get(id);
  }

  // Record a move + spawn as a child of cursor. If that exact (dir) child
  // already exists and its spawn matches, reuse it; otherwise create a new
  // branch. Advances the cursor.
  record(dir, newBoard, score, spawn) {
    const cur = this.current();
    const existingId = cur.children.get(dir);
    if (existingId !== undefined) {
      // Spawns are path-deterministic in our flow (the RNG for each move is
      // derived from seed + directions-from-root), so the same (parent, dir)
      // always produces the same spawn. Reuse the existing child rather than
      // replacing — replacing would orphan the entire subtree under it.
      this.cursor = existingId;
      return existingId;
    }
    const id = this._add(cur.id, dir, spawn, newBoard, score);
    this.cursor = id;
    return id;
  }

  // Move cursor back one step. Returns true if moved.
  stepBack() {
    const cur = this.current();
    if (cur.parent === null) return false;
    this.cursor = cur.parent;
    return true;
  }

  // Step forward along the first child (preferred branch).
  stepForward() {
    const cur = this.current();
    if (cur.children.size === 0) return false;
    const firstChild = cur.children.values().next().value;
    this.cursor = firstChild;
    return true;
  }

  // Jump the cursor to any node id
  jumpTo(id) {
    if (!this.nodes.has(id)) return false;
    this.cursor = id;
    return true;
  }

  // Walk back from cursor to root, returning nodes in order root -> cursor.
  pathToCursor() {
    const path = [];
    let id = this.cursor;
    while (id !== null && id !== undefined) {
      const node = this.nodes.get(id);
      path.push(node);
      id = node.parent;
    }
    path.reverse();
    return path;
  }

  // Get the sequence of moves from root to cursor
  movesFromRoot() {
    return this.pathToCursor()
      .filter((n) => n.dir !== null)
      .map((n) => n.dir);
  }

  depth() {
    return this.pathToCursor().length - 1;
  }

  // Return sibling alternatives at the current cursor's parent
  siblings() {
    const cur = this.current();
    if (cur.parent === null) return [];
    const parent = this.nodes.get(cur.parent);
    return [...parent.children.values()];
  }

  // Find all branch points along the current path (nodes where the parent
  // has >1 child, i.e. where an alternative exists).
  branchPointsOnPath() {
    const path = this.pathToCursor();
    const result = [];
    for (let i = 1; i < path.length; i++) {
      const parent = this.nodes.get(path[i].parent);
      if (parent.children.size > 1) result.push(path[i].id);
    }
    return result;
  }
}
