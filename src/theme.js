/**
 * The look of the scene: a soft, cool evening colour grade baked into the
 * scene's own colours, and the season (spring, summer, autumn or winter).
 */

const listeners = new Set();

/*
 * The season changes only the look of the place, except for one fish (the
 * burbot bites on autumn nights). "auto" follows the calendar: spring from
 * March, summer from June, autumn from September, winter from December.
 */
const SEASON_KEY = "stillwater.season";
export const SEASONS = ["auto", "spring", "summer", "autumn", "winter"];
const BY_MONTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];

let seasonChoice = (() => {
  try {
    const stored = localStorage.getItem(SEASON_KEY);
    return SEASONS.includes(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
})();

/** The choice in Settings: "auto" or a season. */
export function season() {
  return seasonChoice;
}

/** The season the scene is in now: spring, summer, autumn or winter. */
export function currentSeason() {
  return seasonChoice === "auto" ? BY_MONTH[new Date().getMonth()] : seasonChoice;
}

export const isAutumn = () => currentSeason() === "autumn";
export const isWinter = () => currentSeason() === "winter";
export const isSpring = () => currentSeason() === "spring";

export function setSeason(id) {
  seasonChoice = SEASONS.includes(id) ? id : "auto";
  try {
    localStorage.setItem(SEASON_KEY, seasonChoice);
  } catch {
    // Without storage the choice lasts for this visit.
  }
  for (const listener of listeners) listener(seasonChoice);
}

/*
 * Snow for winter, laid over painted land: pale where the light falls, a cool
 * blue-grey in the shade. Lamplight and the deepest darks are left alone, and
 * bluish colours (water, sky) are never touched.
 */
const SNOW_LIT = [226, 233, 238];
const SNOW_SHADE = [128, 142, 156];
export function snowRgb([r, g, b], amount = 0.7) {
  if (r > 170 && g > 120 && b < 110 && r > b * 1.7) return [r, g, b];
  if (b > g + 12 && b > r + 12) return [r, g, b];
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  // Green and grey ground takes the snow; warm walls, logs and bark only a little frost.
  const k = amount * Math.min(1, Math.max(0, (lum - 22) / 70)) * (r > g + 6 ? 0.35 : 1)
    // Pale stone (cliffs, walls, bridges) keeps its own detail, and plain grey stone takes only a dusting.
    * (1 - 0.85 * Math.min(1, Math.max(0, (lum - 85) / 60)))
    * (Math.max(r, g, b) - Math.min(r, g, b) < 12 ? 0.35 : 1);
  const light = Math.min(1, lum / 150);
  return [0, 1, 2].map((i) => {
    const snow = SNOW_SHADE[i] + (SNOW_LIT[i] - SNOW_SHADE[i]) * light;
    return [r, g, b][i] + (snow - [r, g, b][i]) * k;
  });
}

/** Snow over a canvas's pixels (RGBA), in place: the sums of snowRgb, unrolled for a screen-sized layer. */
export function snowImageData(data, amount = 0.7) {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 170 && g > 120 && b < 110 && r > b * 1.7) continue;
    if (b > g + 12 && b > r + 12) continue;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const k = amount * Math.min(1, Math.max(0, (lum - 22) / 70)) * (r > g + 6 ? 0.35 : 1) * (1 - 0.85 * Math.min(1, Math.max(0, (lum - 85) / 60)))
      * (Math.max(r, g, b) - Math.min(r, g, b) < 12 ? 0.35 : 1);
    if (!k) continue;
    const light = Math.min(1, lum / 150);
    data[i] = r + (SNOW_SHADE[0] + (SNOW_LIT[0] - SNOW_SHADE[0]) * light - r) * k;
    data[i + 1] = g + (SNOW_SHADE[1] + (SNOW_LIT[1] - SNOW_SHADE[1]) * light - g) * k;
    data[i + 2] = b + (SNOW_SHADE[2] + (SNOW_LIT[2] - SNOW_SHADE[2]) * light - b) * k;
  }
}

/** A "#rrggbb" colour under snow. */
export function snowHex(hex, amount = 0.7) {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = snowRgb([(value >> 16) & 255, (value >> 8) & 255, value & 255], amount);
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}

/*
 * Winter water: cold and dark under a low sky. Every lake keeps a hint of
 * its own tint (the castle lake stays a little green), but most of it goes
 * to a steel grey-blue, and the depths to near black.
 */
const WINTER_WATER = [96, 120, 134];
const WINTER_DEEP = [20, 32, 42];
function coldHex(hex, [r, g, b], amount) {
  const n = parseInt(hex.slice(1), 16);
  const own = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `#${own.map((c, i) => Math.round(c + ([r, g, b][i] - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}
/** A water tint in the season: colder and greyer in winter, as it is otherwise. */
export const seasonWater = (hex) => (isWinter() ? coldHex(hex, WINTER_WATER, 0.72) : hex);
/** The dark of deep water in the season. */
export const seasonDeep = (hex) => (isWinter() ? coldHex(hex, WINTER_DEEP, 0.6) : hex);

/** Called when the season changes. */
export function onSeasonChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/*
 * The colour grade: a little colour drains toward a cool slate cast, then
 * everything is lifted a touch. A pure function of a colour, so it can grade
 * cells, layers and the sky alike.
 */
const GRADE = { keep: 0.78, gain: 1.15, cast: [0.9, 0.99, 1.12] };

export function gradeRgb([r, g, b]) {
  const { keep, gain, cast } = GRADE;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  return [r, g, b].map((c, i) => Math.max(0, Math.min(255, (c * keep + lum * cast[i] * (1 - keep)) * gain)));
}

/**
 * Grade every opaque pixel of RGBA image data in place: the same sums as
 * gradeRgb, unrolled, so a whole screen-sized layer (millions of pixels)
 * grades in milliseconds without making an array per pixel.
 */
export function gradeImageData(data) {
  const { keep, gain, cast } = GRADE;
  const rest = 1 - keep;
  const [castR, castG, castB] = cast;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    data[i] = Math.max(0, Math.min(255, (r * keep + lum * castR * rest) * gain));
    data[i + 1] = Math.max(0, Math.min(255, (g * keep + lum * castG * rest) * gain));
    data[i + 2] = Math.max(0, Math.min(255, (b * keep + lum * castB * rest) * gain));
  }
}

/** The sky with the grade applied; the lit side of clouds keeps some of its warmth. */
export function gradeSky(sky) {
  // A winter sky is paler and colder: a good part of its colour drains to a blue-grey.
  const winter = isWinter();
  const cold = ([r, g, b]) => {
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    return [r, g, b].map((c, i) => c * 0.6 + lum * [0.94, 1, 1.1][i] * 0.4);
  };
  return {
    ...sky,
    sky: sky.sky.map((stop) => gradeRgb(winter ? cold(stop) : stop)),
    cloudShade: gradeRgb(sky.cloudShade),
    cloudLit: gradeRgb(sky.cloudLit).map((c, i) => c * 0.6 + sky.cloudLit[i] * 0.4),
  };
}

export function gradeHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = gradeRgb([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
}

export const gradeInt = (value) => parseInt(gradeHex(`#${value.toString(16).padStart(6, "0")}`).slice(1), 16);
