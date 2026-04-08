// Grade badge renderer: move quality label with streak counter.
// Factory pattern matching createBoardRenderer / createTimelineRenderer.

import { GRADE_TEXT } from "../game/constants.js";

const GRADE_CLASS = {
  best: "grade-perfect",
  good: "grade-green",
  ok: "grade-yellow",
  mistake: "grade-orange",
  blunder: "grade-red",
};

export function createGradeBadgeRenderer(container) {
  container.innerHTML = "";
  container.className = "grade-badge-region";
  container.setAttribute("aria-live", "polite");

  const badge = document.createElement("div");
  badge.className = "grade-badge hidden";
  container.appendChild(badge);

  const gradeLabel = document.createElement("span");
  gradeLabel.className = "grade-label";
  badge.appendChild(gradeLabel);

  const coachNote = document.createElement("div");
  coachNote.className = "grade-coach-note";
  container.appendChild(coachNote);

  const streakEl = document.createElement("div");
  streakEl.className = "grade-streak hidden";
  container.appendChild(streakEl);

  function show(grade) {
    container.classList.remove("grade-badge-loading");

    // Grade label
    const cls = GRADE_CLASS[grade.grade] || "grade-yellow";
    gradeLabel.textContent = GRADE_TEXT[grade.grade] || grade.grade;
    badge.className = `grade-badge ${cls}`;

    // Trigger fade-in by removing then re-adding the animation class
    badge.classList.remove("grade-fade-in");
    // Force reflow to restart animation
    void badge.offsetWidth;
    badge.classList.add("grade-fade-in");

    // Coaching note
    if (grade.coachNote) {
      coachNote.textContent = grade.coachNote;
      coachNote.classList.remove("hidden");
    } else {
      coachNote.textContent = "";
      coachNote.classList.add("hidden");
    }
  }

  function showLoading() {
    badge.className = "grade-badge hidden";
    coachNote.textContent = "";
    coachNote.classList.add("hidden");
    streakEl.classList.add("hidden");
    streakEl.textContent = "";
    container.classList.add("grade-badge-loading");
  }

  function hide() {
    badge.className = "grade-badge hidden";
    coachNote.textContent = "";
    coachNote.classList.add("hidden");
    streakEl.classList.add("hidden");
    streakEl.textContent = "";
    container.classList.remove("grade-badge-loading");
  }

  function updateStreak(count) {
    if (count <= 1) {
      streakEl.classList.add("hidden");
      streakEl.textContent = "";
      return;
    }
    streakEl.textContent = `\u00d7${count}`;
    streakEl.classList.remove("hidden");

    // Trigger bounce animation
    streakEl.classList.remove("streak-bounce");
    void streakEl.offsetWidth;
    streakEl.classList.add("streak-bounce");
  }

  function reset() {
    hide();
    streakEl.classList.add("hidden");
    streakEl.textContent = "";
  }

  return { show, showLoading, hide, updateStreak, reset };
}
