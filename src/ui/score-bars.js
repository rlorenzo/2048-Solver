// Score bars renderer: four horizontal bars showing AI evaluation per direction.
// Factory pattern matching createBoardRenderer / createTimelineRenderer.

import { DIR_ARROWS, DIR_LABELS, GRADE_TEXT } from "../game/constants.js";
import { gradeScore } from "../coaching/diagnose.js";

const GRADE_PCT = { best: 100, good: 75, ok: 50, mistake: 25, blunder: 0 };

export function createScoreBarsRenderer(container) {
  container.innerHTML = "";
  container.className = "score-bars hidden";
  container.setAttribute("role", "img");
  container.setAttribute("aria-label", "AI direction scores");

  // Build DOM structure
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = document.createElement("div");
    row.className = "score-bar-row";

    const label = document.createElement("span");
    label.className = "score-bar-label";
    label.textContent = `${DIR_ARROWS[i]} ${DIR_LABELS[i]}`;

    const track = document.createElement("div");
    track.className = "score-bar-track";

    const fill = document.createElement("div");
    fill.className = "score-bar-fill";

    const value = document.createElement("span");
    value.className = "score-bar-value";

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);
    container.appendChild(row);
    rows.push({ row, label, track, fill, value });
  }

  const caption = document.createElement("div");
  caption.className = "score-bars-caption";
  container.appendChild(caption);

  function render(aiResult) {
    const { scores, depth, ms } = aiResult;
    container.classList.remove("hidden", "score-bars-loading", "score-bars-error");

    const max = Math.max(...scores);
    const bestDir = scores.indexOf(max);

    // Grade each direction and build aria-label
    const grades = scores.map((s) => gradeScore(s, max));
    const ranked = scores
      .map((s, i) => ({ s, i, grade: grades[i] }))
      .filter((r) => r.grade !== null)
      .sort((a, b) => b.s - a.s);
    const ariaItems = ranked.map((r) => `${DIR_LABELS[r.i]}: ${GRADE_TEXT[r.grade]}`);
    container.setAttribute("aria-label", `${DIR_LABELS[bestDir]} is best: ${ariaItems.join(", ")}`);

    for (let i = 0; i < 4; i++) {
      const { row, fill, value } = rows[i];
      const grade = grades[i];

      if (grade === null) {
        fill.style.width = "0%";
        value.textContent = "N/A";
        row.classList.remove("score-bar-best", "score-bar-disabled");
        row.classList.add("score-bar-disabled");
      } else {
        const pct = GRADE_PCT[grade];
        fill.style.width = `${pct}%`;
        value.textContent = GRADE_TEXT[grade];
        row.classList.toggle("score-bar-best", i === bestDir);
        row.classList.remove("score-bar-disabled");
      }
    }

    // Caption with depth and timing
    const msLabel = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
    caption.textContent = `depth ${depth} \u00b7 ${msLabel}`;
  }

  function showLoading() {
    container.classList.remove("hidden", "score-bars-error");
    container.classList.add("score-bars-loading");
    for (const { fill, value, row } of rows) {
      fill.style.width = "0%";
      value.textContent = "";
      row.classList.remove("score-bar-best", "score-bar-disabled");
    }
    caption.textContent = "";
    container.setAttribute("aria-label", "Loading AI scores\u2026");
  }

  function showError() {
    container.classList.remove("hidden", "score-bars-loading");
    container.classList.add("score-bars-error");
    for (const { fill, value, row } of rows) {
      fill.style.width = "0%";
      value.textContent = "\u2014";
      row.classList.remove("score-bar-best", "score-bar-disabled");
    }
    caption.textContent = "";
    container.setAttribute("aria-label", "AI scores unavailable");
  }

  function hide() {
    container.classList.add("hidden");
  }

  function reset() {
    hide();
    container.classList.remove("score-bars-loading", "score-bars-error");
    for (const { fill, value, row } of rows) {
      fill.style.width = "0%";
      value.textContent = "";
      row.classList.remove("score-bar-best", "score-bar-disabled");
    }
    caption.textContent = "";
    container.setAttribute("aria-label", "AI direction scores");
  }

  return { render, showLoading, showError, hide, reset };
}
