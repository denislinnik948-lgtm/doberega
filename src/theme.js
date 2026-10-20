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

/*
 * The dark fantasy grade, baked into the scene's own colours: life drains out
 * of greens and warm tones toward cold slate and moss, and everything sinks a
 * little darker. Pure function of a colour, so it can grade cells, layers and
 * the sky alike.
 */
export function gradeRgb([r, g, b]) {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  // Keep a little of the hue, push the rest toward a cold grey.
  const keep = 0.38;
  const cold = [lum * 0.92, lum * 0.97, lum * 1.12];
  return [0, 1, 2].map((i) => Math.max(0, Math.min(255, ([r, g, b][i] * keep + cold[i] * (1 - keep)) * 0.8)));
}

export function gradeHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = gradeRgb([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
}

export const gradeInt = (value) => parseInt(gradeHex(`#${value.toString(16).padStart(6, "0")}`).slice(1), 16);

/**
 * A dark fantasy sky: overcast and leaden by day, a blood-red glow where the
 * sun goes down or comes up, a deeper, colder night under a pale moon.
 */
export function darkSky(sky) {
  const [gr, gg, gb, ga] = sky.glow;
  // How much of a sunrise or sunset is in the sky right now.
  const warmth = Math.max(0, Math.min(1, (gr - gb) / 110)) * Math.min(1, ga * 2.2) * (sky.light.kind === "sun" ? 1 : 0.3);
  const blood = [150, 26, 30];
  const stops = sky.sky.map((stop, index) => {
    const graded = gradeRgb(stop);
    const pull = warmth * [0.05, 0.2, 0.5, 0.65][index];
    return graded.map((c, i) => c + (blood[i] - c) * pull);
  });
  return {
    ...sky,
    sky: stops,
    glow: [Math.min(255, gr * 0.9 + 40 * warmth), gg * (0.55 - 0.15 * warmth), gb * (0.6 - 0.2 * warmth), ga * (0.8 + 0.5 * warmth)],
    land: sky.land.map((value) => value * 0.82),
    water: sky.water.map((value) => value * 0.82),
    shade: Math.min(0.75, sky.shade + 0.12),
    cloudShade: gradeRgb(sky.cloudShade).map((c) => c * 0.85),
    cloudLit: gradeRgb(sky.cloudLit).map((c, i) => c + (blood[i] - c) * warmth * 0.45),
    glint: sky.glint.map((color) => gradeRgb(color).map((c, i) => c + (blood[i] - c) * warmth * 0.4)),
  };
}
