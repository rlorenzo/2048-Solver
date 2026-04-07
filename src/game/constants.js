// Direction constants shared by the UI, game logic, and AI. Centralised here
// to avoid silent coupling if any file changes the order.

export const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
export const DIR_NAMES = ["U", "R", "D", "L"];
export const DIR_LABELS = ["Up", "Right", "Down", "Left"];
export const DIR_ARROWS = ["\u2191", "\u2192", "\u2193", "\u2190"];

export const GRADE_TEXT = {
  best: "Perfect",
  good: "Good",
  ok: "OK",
  mistake: "Mistake",
  blunder: "Blunder",
};
