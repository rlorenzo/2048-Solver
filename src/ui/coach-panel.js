// Coach panel renderer: composite region containing score bars, grade badge,
// and coaching note. Delegates to individual renderers; provides a unified
// reset/hide API for the coach region.

import { createScoreBarsRenderer } from "./score-bars.js";
import { createGradeBadgeRenderer } from "./grade-badge.js";

export function createCoachPanelRenderer(coachEl) {
  const scoreBarsEl = coachEl.querySelector("#score-bars");
  const gradeBadgeEl = coachEl.querySelector("#grade-badge");

  const scoreBars = createScoreBarsRenderer(scoreBarsEl);
  const gradeBadge = createGradeBadgeRenderer(gradeBadgeEl);

  function reset() {
    scoreBars.reset();
    gradeBadge.reset();
  }

  function hide() {
    scoreBars.hide();
    gradeBadge.hide();
  }

  return {
    scoreBars,
    gradeBadge,
    reset,
    hide,
  };
}
