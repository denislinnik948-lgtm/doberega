import { P } from "./fishing/palette.js";

/**
 * Visual style: the classic lake or dark fantasy. Dark fantasy swaps the UI
 * palette for cold ash and blood-red accents, grades the scene colder and
 * darker, thickens the mist and lets strange things happen at night.
 */

const KEY = "stillwater.theme";

const CLASSIC = { ...P };

// Cold ash and slate, tarnished gold, blood-red instead of warm ember.
const DARK_FANTASY = {
  ink: "#07080b",
  deep: "#0f1016",
  dark: "#1d1c26",
  mid: "#3b3848",
  soft: "#6c6578",
  light: "#a9a1b3",
  bone: "#d8d1c4",
  gold: "#b39556",
  goldDark: "#5c4624",
  ember: "#a3262a",
};

export const THEMES = ["classic", "dark"];

let current = (() => {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "classic";
  } catch {
    return "classic";
  }
})();

const listeners = new Set();

export function theme() {
  return current;
}

export function isDarkFantasy() {
  return current === "dark";
}

/** Put the current style's palette and page class in place (before anything is painted). */
export function applyTheme() {
  Object.assign(P, current === "dark" ? DARK_FANTASY : CLASSIC);
  document.body.classList.toggle("theme-dark", current === "dark");
}

export function setTheme(id) {
  current = id === "dark" ? "dark" : "classic";
  try {
    localStorage.setItem(KEY, current);
  } catch {
    // Without storage the choice lasts for this visit.
  }
  applyTheme();
  for (const listener of listeners) listener(current);
}

export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
