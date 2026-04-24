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
//   depth: number  (distance from root)
//   children: Map<dir, id>
//   preferredChild: id | null  (last-visited child for deterministic redo)

import { cloneBoard } from "./board.js";

export class History {
  constructor(rootBoard) {
    this.nodes = new Map();
    this.nextId = 0;
    this.root = this._add(null, null, null, cloneBoard(rootBoard), 0);
    this.cursor = this.root;
  }

  _add(parent, dir, spawn, board, score) {
    const id = this.nextId++;
    const parentNode = this.nodes.get(parent);
    parentNode?.children.set(dir, id);
    this.nodes.set(id, {
      id,
      parent,
      dir,
      spawn,
      board,
      score,
      depth: parentNode ? parentNode.depth + 1 : 0,
      children: new Map(),
      preferredChild: null,
    });
    return id;
  }

  current() {
    return this.nodes.get(this.cursor);
  }

  // fallow-ignore-next-line unused-class-member
  get(id) {
    return this.nodes.get(id);
  }

  // Record a move as a child of the current cursor and advance the cursor.
  //
  // Invariant: spawns are path-deterministic in our flow (each move's RNG is
  // seeded from the root seed + directions-from-root), so calling record()
  // twice for the same (cursor, dir) is guaranteed to yield the same board,
  // score, and spawn. We therefore reuse an existing (cursor, dir) child
  // unconditionally — validating the passed newBoard/score/spawn here would
  // only be able to catch caller bugs elsewhere. `dir` is the sole key.
  record(dir, newBoard, score, spawn) {
    const cur = this.current();
    const existingId = cur.children.get(dir);
    if (existingId !== undefined) {
      // Spawns are path-deterministic in our flow (the RNG for each move is
      // derived from seed + directions-from-root), so the same (parent, dir)
      // always produces the same spawn. Reuse the existing child rather than
      // replacing — replacing would orphan the entire subtree under it.
      cur.preferredChild = existingId;
      this.cursor = existingId;
      return existingId;
    }
    const id = this._add(cur.id, dir, spawn, newBoard, score);
    cur.preferredChild = id;
    this.cursor = id;
    return id;
  }

  // Move cursor back one step. Returns true if moved.
  stepBack() {
    const cur = this.current();
    if (cur.parent === null) return false;
    const parent = this.nodes.get(cur.parent);
    parent.preferredChild = cur.id;
    this.cursor = parent.id;
    return true;
  }

  // Step forward along the preferred child (falling back to first child).
  stepForward() {
    const cur = this.current();
    const nextChild = this.preferredChildId(cur);
    if (nextChild === null) return false;
    cur.preferredChild = nextChild;
    this.cursor = nextChild;
    return true;
  }

  preferredChildId(nodeOrId) {
    const node = typeof nodeOrId === "number" ? this.nodes.get(nodeOrId) : nodeOrId;
    if (!node || node.children.size === 0) return null;
    const preferred = node.preferredChild !== null ? this.nodes.get(node.preferredChild) : null;
    return preferred?.parent === node.id
      ? node.preferredChild
      : node.children.values().next().value;
  }

  // Jump the cursor to any node id
  jumpTo(id) {
    if (!this.nodes.has(id)) return false;
    let childId = id;
    let node = this.nodes.get(id);
    while (node.parent !== null) {
      const parent = this.nodes.get(node.parent);
      parent.preferredChild = childId;
      childId = parent.id;
      node = parent;
    }
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

  // Walk forward from the root along each node's preferred child (falling
  // back to the first child) so the UI can render the full visible branch,
  // including future nodes beyond the current cursor.
  preferredPathFromRoot() {
    const path = [];
    let node = this.nodes.get(this.root);
    while (node) {
      path.push(node);
      const nextId = this.preferredChildId(node);
      if (nextId === null) break;
      node = this.nodes.get(nextId);
    }
    return path;
  }

  // Get the sequence of moves from root to cursor
  movesFromRoot() {
    return this.pathToCursor()
      .filter((n) => n.dir !== null)
      .map((n) => n.dir);
  }

  depth() {
    return this.current().depth;
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
