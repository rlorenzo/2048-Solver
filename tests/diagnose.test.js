import { describe, it, expect } from "vite-plus/test";
import { diagnose, coachLog, gradeScore } from "../src/coaching/diagnose.js";

function board(arr) {
  return new Uint8Array(arr);
}

// Helper to create a mock aiResult
function aiResult(scores) {
  return { scores };
}

// ---- Anchor detection ----

describe("anchor detection", () => {
  it("detects max tile held in corner", () => {
    // 2048 (exp 11) in top-left corner
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.anchor.corner).toBe("top-left");
    expect(d.anchor.held).toBe(true);
  });

  it("detects max tile in bottom-right corner", () => {
    const b = board([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11]);
    const d = diagnose(b, aiResult([10, 10, 10, 10]));
    expect(d.anchor.corner).toBe("bottom-right");
    expect(d.anchor.held).toBe(true);
  });

  it("detects max tile NOT in corner", () => {
    // Max tile (exp 11) at center position (row 1, col 1)
    const b = board([5, 4, 3, 2, 4, 11, 3, 1, 3, 2, 1, 0, 2, 1, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.anchor.held).toBe(false);
  });
});

// ---- Monotonicity ----

describe("monotonicity", () => {
  it("detects strong monotonicity (all rows/cols monotonic)", () => {
    // Perfect snake pattern: each row and col is monotonic
    const b = board([11, 10, 9, 8, 5, 6, 7, 7, 4, 3, 2, 1, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.monotonicity.status).toBe("strong");
    expect(d.monotonicity.direction).toBeNull();
  });

  it("detects broken monotonicity", () => {
    // Chaotic board: many non-monotonic rows and columns
    const b = board([1, 8, 2, 7, 6, 3, 9, 1, 2, 7, 1, 5, 8, 1, 6, 3]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.monotonicity.status).toBe("broken");
    expect(d.monotonicity.direction).not.toBeNull();
  });

  it("detects mixed monotonicity", () => {
    // Some rows monotonic, some not — aim for 4-7 total
    const b = board([
      11,
      10,
      9,
      8, // row monotonic (non-increasing)
      7,
      6,
      5,
      4, // row monotonic (non-increasing)
      3,
      2,
      1,
      0, // row monotonic (non-increasing)
      1,
      5,
      2,
      3, // row NOT monotonic
    ]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    // Rows: 3 monotonic + row3 broken. Cols: check each.
    // Col0: 11,7,3,1 non-increasing = mono. Col1: 10,6,2,5 broken.
    // Col2: 9,5,1,2 broken. Col3: 8,4,0,3 broken.
    // Total: 3 rows + 1 col = 4 => mixed (4 <= mono < 8)
    expect(d.monotonicity.status).toBe("mixed");
  });
});

// ---- Space ----

describe("space", () => {
  it("detects healthy space (>= 6 empties)", () => {
    const b = board([11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.space.empties).toBe(15);
    expect(d.space.tier).toBe("healthy");
  });

  it("detects tight space (3-5 empties)", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.space.empties).toBe(4);
    expect(d.space.tier).toBe("tight");
  });

  it("detects critical space (<= 2 empties, near-death)", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.space.empties).toBe(1);
    expect(d.space.tier).toBe("critical");
  });

  it("detects zero empties as critical", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 2, 3, 4]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.space.empties).toBe(0);
    expect(d.space.tier).toBe("critical");
  });
});

// ---- Merge chain ----

describe("merge chain", () => {
  it("detects ready chain (>= 4 descending adjacent)", () => {
    // Snake: 11, 10, 9, 8 across top row
    const b = board([11, 10, 9, 8, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.mergeChain.longestRun).toBe(5); // 11->10->9->8->7
    expect(d.mergeChain.status).toBe("ready");
  });

  it("detects weak chain (2-3)", () => {
    // Only 11 and 10 adjacent
    const b = board([11, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.mergeChain.longestRun).toBe(2); // 11->10
    expect(d.mergeChain.status).toBe("weak");
  });

  it("detects no chain (isolated max tile)", () => {
    const b = board([11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.mergeChain.longestRun).toBe(1);
    expect(d.mergeChain.status).toBe("none");
  });

  it("follows chain around a corner", () => {
    // Chain bends: 11 at (0,0), 10 at (1,0), 9 at (1,1), 8 at (1,2)
    const b = board([11, 0, 0, 0, 10, 9, 8, 0, 0, 0, 7, 0, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.mergeChain.longestRun).toBe(5); // 11->10->9->8->7
    expect(d.mergeChain.status).toBe("ready");
  });
});

// ---- Move quality grading ----

describe("move quality", () => {
  it("grades 'best' when chosen dir matches AI best", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    const scores = [1600000, 1500000, 1400000, 1300000]; // UP is best
    const d = diagnose(b, aiResult(scores), { chosenDir: 0, childBoard: child });
    expect(d.moveQuality.grade).toBe("best");
    expect(d.moveQuality.scoreDelta).toBe(0);
    expect(d.moveQuality.bestDir).toBe(0);
  });

  it("grades 'best' when delta is tiny (ratio < 0.5% AND absolute < 200)", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // delta = 100, ratio = 0.006% — both thresholds pass
    const scores = [1600000, 1599900, 1400000, 1300000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 1, childBoard: child });
    expect(d.moveQuality.grade).toBe("best");
  });

  it("grades 'good' when small gap (ratio < 1% AND delta < 1000)", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // delta = 500, ratio = 0.03%
    const scores = [1600000, 1599500, 1400000, 1300000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 1, childBoard: child });
    expect(d.moveQuality.grade).toBe("good");
    expect(d.moveQuality.coachNote).toBeNull();
  });

  it("grades 'ok' when moderate gap (ratio < 4% AND delta < 5000)", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // delta = 3000, ratio = 0.19%
    const scores = [1600000, 1597000, 1400000, 1300000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 1, childBoard: child });
    expect(d.moveQuality.grade).toBe("ok");
    expect(d.moveQuality.coachNote).not.toBeNull();
  });

  it("grades 'mistake' when significant gap", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // delta = 10000, ratio = 0.6% — ratio is small but absolute delta > 5000
    const scores = [1600000, 1590000, 1400000, 1300000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 1, childBoard: child });
    expect(d.moveQuality.grade).toBe("mistake");
    expect(d.moveQuality.coachNote).not.toBeNull();
  });

  it("grades 'blunder' when large gap (ratio >= 12% AND delta >= 20000)", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // delta = 300000, ratio = 18.75%
    const scores = [1600000, 1400000, 1300000, 1300000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 1, childBoard: child });
    expect(d.moveQuality.grade).toBe("blunder");
    expect(d.moveQuality.coachNote).not.toBeNull();
  });

  it("absolute delta matters: small ratio but large absolute gap is not 'best'", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // ratio = 0.12% (tiny!) but delta = 2000 (absolute > 1000) => not good, it's ok
    const scores = [1600000, 1598000, 1400000, 1300000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 1, childBoard: child });
    expect(d.moveQuality.grade).toBe("ok");
  });

  it("handles -Infinity scores for invalid moves", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    const scores = [1600000, -Infinity, -Infinity, 1400000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 0, childBoard: child });
    expect(d.moveQuality.grade).toBe("best");
  });

  it("handles all-zero scores gracefully", () => {
    const b = board([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2, 3, 4, 5]);
    const child = board([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2, 3, 4, 5]);
    const scores = [0, 0, 0, 0];
    const d = diagnose(b, aiResult(scores), { chosenDir: 0, childBoard: child });
    expect(d.moveQuality.grade).toBe("best");
  });
});

// ---- Coaching note triggers ----

describe("coaching notes", () => {
  it("detects corner-lost when max tile leaves corner", () => {
    // Pre-move: max tile (11) in top-left corner
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    // Post-move: max tile drifted to row 1
    const child = board([0, 10, 9, 8, 11, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // Make it a mistake-level delta so coaching note fires
    const scores = [1600000, 1200000, 1000000, 800000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 3, childBoard: child });
    expect(d.moveQuality.grade).toBe("blunder");
    expect(d.moveQuality.coachNote).toContain("Corner lost");
  });

  it("detects monotonicity-broken transition", () => {
    // Pre-move: strong monotonicity
    const b = board([11, 10, 9, 8, 5, 6, 7, 7, 4, 3, 2, 1, 0, 0, 0, 0]);
    // Post-move: broken monotonicity (chaotic)
    const child = board([11, 10, 9, 8, 1, 8, 2, 7, 6, 3, 9, 1, 2, 7, 1, 5]);
    // Must be mistake+ for note to trigger
    const scores = [1600000, 1200000, 1000000, 800000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 3, childBoard: child });
    expect(d.moveQuality.coachNote).toContain("Monotonicity broken");
  });

  it("detects space-critical transition", () => {
    // Pre-move: tight but not critical (3 empties)
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 0, 0, 1, 2, 3, 0]);
    // Post-move: critical (1 empty)
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 3, 1, 2, 3, 0]);
    // Must be mistake+ for note to trigger
    const scores = [1600000, 1200000, 1000000, 800000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 3, childBoard: child });
    expect(d.moveQuality.coachNote).toContain("cells left");
  });

  it("falls back to generic note when no specific trigger fires", () => {
    // Both boards roughly similar, no specific trigger
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    // Child is similar — corner still held, monotonicity same, space healthy
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    // Blunder-level delta to trigger note generation
    const scores = [1600000, 1200000, 1000000, 800000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 3, childBoard: child });
    expect(d.moveQuality.coachNote).toContain("Best move was");
  });

  it("does not generate note for best/good grades", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const child = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 1]);
    const scores = [1600000, 1600000, 1400000, 1300000];
    const d = diagnose(b, aiResult(scores), { chosenDir: 1, childBoard: child });
    expect(d.moveQuality.grade).toBe("best");
    expect(d.moveQuality.coachNote).toBeNull();
  });
});

// ---- Position-only analysis (no transition) ----

describe("position-only analysis", () => {
  it("returns no moveQuality when transition is omitted", () => {
    const b = board([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.moveQuality).toBeUndefined();
    expect(d.anchor).toBeDefined();
    expect(d.monotonicity).toBeDefined();
    expect(d.space).toBeDefined();
    expect(d.mergeChain).toBeDefined();
  });

  it("handles healthy mid-game board", () => {
    const b = board([7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([100, 50, 30, 20]));
    expect(d.anchor.corner).toBe("top-left");
    expect(d.anchor.held).toBe(true);
    expect(d.space.tier).toBe("healthy");
    expect(d.mergeChain.status).toBe("ready"); // 7->6->5->4->3->2->1
  });

  it("handles empty board", () => {
    const b = board([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const d = diagnose(b, aiResult([0, 0, 0, 0]));
    expect(d.space.empties).toBe(16);
    expect(d.space.tier).toBe("healthy");
    expect(d.mergeChain.status).toBe("none");
  });
});

// ---- gradeScore ----

describe("gradeScore", () => {
  it("returns null for non-finite scores", () => {
    expect(gradeScore(-Infinity, 1000)).toBeNull();
    expect(gradeScore(Infinity, 1000)).toBeNull();
    expect(gradeScore(NaN, 1000)).toBeNull();
  });

  it("returns 'best' when bestScore <= 0", () => {
    expect(gradeScore(0, 0)).toBe("best");
    expect(gradeScore(-10, -10)).toBe("best");
  });

  it("returns 'best' when score equals bestScore", () => {
    expect(gradeScore(1600000, 1600000)).toBe("best");
  });

  it("returns 'best' for tiny gap (ratio < 0.5% and delta < 200)", () => {
    expect(gradeScore(1599900, 1600000)).toBe("best");
  });

  it("returns 'good' for small gap", () => {
    expect(gradeScore(1599500, 1600000)).toBe("good");
  });

  it("returns 'blunder' for large gap", () => {
    expect(gradeScore(1300000, 1600000)).toBe("blunder");
  });
});

// ---- coachLog ----

describe("coachLog", () => {
  it("is a callable function that does not throw", () => {
    expect(() => coachLog("test message")).not.toThrow();
  });
});
