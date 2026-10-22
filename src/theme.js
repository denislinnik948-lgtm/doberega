/**
 * The look of the scene: a soft, cool evening colour grade baked into the
 * scene's own colours, and the season (summer greens or autumn crowns).
 */

const listeners = new Set();

/*
 * The season: summer greens or autumn crowns in red, rust and gold. "auto"
 * follows the calendar (September to November is autumn).
 */
const SEASON_KEY = "stillwater.season";
export const SEASONS = ["auto", "summer", "autumn"];

let seasonChoice = (() => {
  try {
    const stored = localStorage.getItem(SEASON_KEY);
    return SEASONS.includes(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
})();

export function season() {
  return seasonChoice;
}

export function isAutumn() {
  if (seasonChoice === "auto") return [8, 9, 10].includes(new Date().getMonth());
  return seasonChoice === "autumn";
}

export function setSeason(id) {
  seasonChoice = SEASONS.includes(id) ? id : "auto";
  try {
    localStorage.setItem(SEASON_KEY, seasonChoice);
  } catch {
    // Without storage the choice lasts for this visit.
  }
  for (const listener of listeners) listener(seasonChoice);
}

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
  return {
    ...sky,
    sky: sky.sky.map((stop) => gradeRgb(stop)),
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
