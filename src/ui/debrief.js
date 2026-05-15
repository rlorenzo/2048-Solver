// End-of-game debrief renderer: summary card shown on game over.
// Displays worst mistake, best streak, and a "Retry this seed" button.
// Factory pattern matching createBoardRenderer / createTimelineRenderer.

const GRADE_RANK = { best: 0, good: 1, ok: 2, mistake: 3, blunder: 4 };

export function createDebriefRenderer(container, onRetrySeed) {
  container.innerHTML = "";
  container.className = "debrief hidden";
  container.setAttribute("aria-live", "polite");

  const card = document.createElement("div");
  card.className = "debrief-card";
  container.appendChild(card);

  const heading = document.createElement("h3");
  heading.className = "debrief-heading";
  heading.textContent = "Game Review";
  card.appendChild(heading);

  const statsEl = document.createElement("div");
  statsEl.className = "debrief-stats";
  card.appendChild(statsEl);

  const retryBtn = document.createElement("button");
  retryBtn.className = "btn primary debrief-retry";
  retryBtn.textContent = "Retry this seed";
  retryBtn.type = "button";
  card.appendChild(retryBtn);

  retryBtn.addEventListener("click", () => {
    if (typeof onRetrySeed === "function") onRetrySeed();
  });

  function show(pathGrades, totalMoves) {
    // Compute stats from path-filtered grade array
    let worstGrade = null;
    let worstDelta = 0;
    let bestStreakLen = 0;
    let currentStreakLen = 0;
    let mistakeCount = 0;
    let blunderCount = 0;
    let bestCount = 0;

    for (const grade of pathGrades) {
      if (grade.grade === "mistake") mistakeCount++;
      if (grade.grade === "blunder") blunderCount++;
      if (grade.grade === "best") bestCount++;

      // Track worst
      const rank = GRADE_RANK[grade.grade] ?? 2;
      const worstRank = worstGrade ? (GRADE_RANK[worstGrade.grade] ?? 2) : -1;
      if (rank > worstRank || (rank === worstRank && grade.scoreDelta > worstDelta)) {
        worstGrade = grade;
        worstDelta = grade.scoreDelta;
      }

      // Track best streak
      if (grade.grade === "best" || grade.grade === "good") {
        currentStreakLen++;
        if (currentStreakLen > bestStreakLen) bestStreakLen = currentStreakLen;
      } else {
        currentStreakLen = 0;
      }
    }

    // Build stats content
    statsEl.innerHTML = "";

    const items = [];

    if (worstGrade && (worstGrade.grade === "mistake" || worstGrade.grade === "blunder")) {
      const label = worstGrade.grade === "blunder" ? "Worst blunder" : "Worst mistake";
      const note = worstGrade.coachNote || `AI preferred a different move`;
      items.push({ label, value: note, cls: "debrief-stat-bad" });
    }

    if (bestStreakLen > 0) {
      items.push({
        label: "Best streak",
        value: `${bestStreakLen} good moves in a row`,
        cls: "debrief-stat-good",
      });
    }

    const gradedMoves = pathGrades.length;
    if (gradedMoves > 0) {
      const accuracy = Math.round((bestCount / gradedMoves) * 100);
      items.push({
        label: "Accuracy",
        value: `${accuracy}% best moves (${bestCount}/${gradedMoves})`,
        cls: "debrief-stat-neutral",
      });
    }

    if (mistakeCount + blunderCount > 0) {
      items.push({
        label: "Errors",
        value: `${mistakeCount} mistake${mistakeCount !== 1 ? "s" : ""}, ${blunderCount} blunder${blunderCount !== 1 ? "s" : ""}`,
        cls: "debrief-stat-neutral",
      });
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = `debrief-stat ${item.cls}`;

      const labelEl = document.createElement("span");
      labelEl.className = "debrief-stat-label";
      labelEl.textContent = item.label;
      row.appendChild(labelEl);

      const valueEl = document.createElement("span");
      valueEl.className = "debrief-stat-value";
      valueEl.textContent = item.value;
      row.appendChild(valueEl);

      statsEl.appendChild(row);
    }

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "debrief-stat debrief-stat-neutral";
      empty.textContent = totalMoves > 0 ? "No graded moves recorded." : "No moves played.";
      statsEl.appendChild(empty);
    }

    container.classList.remove("hidden");
  }

  function hide() {
    container.classList.add("hidden");
  }

  function reset() {
    hide();
    statsEl.innerHTML = "";
  }

  return { show, hide, reset };
}
