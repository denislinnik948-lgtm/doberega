/**
 * Time of day. `t` runs 0..1 around the clock (0 = midnight, 0.5 = noon).
 * Keyframes hold sky colours, lighting multipliers for land and water, cloud
 * colours, star visibility and glint colours; values between keyframes are
 * blended smoothly, so the whole scene drifts from one mood to the next.
 */

const hex = (value) => {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const KEYFRAMES = [
  {
    t: 0, name: "night",
    sky: ["#050a12", "#0b1624", "#142235", "#1d2c3a"], glow: [170, 190, 210, 0.12],
    land: [0.34, 0.4, 0.52], water: [0.5, 0.55, 0.68], shade: 0.58,
    cloudShade: "#0f1820", cloudLit: "#34404e", stars: 1, glint: ["#8aa2b0", "#e6eef0"],
  },
  {
    t: 0.2, name: "predawn",
    sky: ["#0b1422", "#1a2638", "#3a3f52", "#6a5a62"], glow: [220, 160, 150, 0.12],
    land: [0.46, 0.48, 0.58], water: [0.58, 0.6, 0.7], shade: 0.45,
    cloudShade: "#232c3a", cloudLit: "#6a5a66", stars: 0.55, glint: ["#7a6a72", "#c8b4b0"],
  },
  {
    t: 0.28, name: "dawn",
    sky: ["#1f3048", "#4a5670", "#b07a70", "#e8a882"], glow: [255, 190, 150, 0.5],
    land: [0.78, 0.7, 0.68], water: [0.84, 0.78, 0.78], shade: 0.22,
    cloudShade: "#5a5868", cloudLit: "#f2b294", stars: 0, glint: ["#d08a6a", "#ffd8b8"],
  },
  {
    t: 0.38, name: "morning",
    sky: ["#35628a", "#6e98b6", "#b8cfd8", "#dde6de"], glow: [255, 240, 210, 0.3],
    land: [1.08, 1.08, 1.03], water: [1.04, 1.06, 1.06], shade: 0,
    cloudShade: "#8fa2b0", cloudLit: "#f4f4ec", stars: 0, glint: ["#d8d8c8", "#ffffff"],
  },
  {
    t: 0.5, name: "noon",
    sky: ["#2c5f8e", "#5c91ba", "#a4c4d8", "#cfe0e4"], glow: [255, 255, 235, 0.25],
    land: [1.22, 1.22, 1.14], water: [1.15, 1.18, 1.18], shade: 0,
    cloudShade: "#a0b2c0", cloudLit: "#ffffff", stars: 0, glint: ["#e8ecd8", "#ffffff"],
  },
  {
    t: 0.66, name: "afternoon",
    sky: ["#2b5376", "#587e98", "#a8b6b2", "#d4c8a6"], glow: [255, 235, 190, 0.32],
    land: [1.1, 1.08, 1], water: [1.06, 1.06, 1.02], shade: 0,
    cloudShade: "#8a96a0", cloudLit: "#f2e6c8", stars: 0, glint: ["#e0c890", "#fff2cc"],
  },
  {
    t: 0.76, name: "evening",
    sky: ["#111c25", "#2a3b46", "#7c7b6f", "#a8937a"], glow: [255, 220, 160, 0.42],
    land: [1, 1, 1], water: [1, 1, 1], shade: 0,
    cloudShade: "#4d5a66", cloudLit: "#e6bd8e", stars: 0.15, glint: ["#c99a68", "#f4dca6"],
  },
  {
    t: 0.85, name: "dusk",
    sky: ["#0a121c", "#18222f", "#3e3a44", "#6e5452"], glow: [220, 120, 90, 0.22],
    land: [0.56, 0.56, 0.63], water: [0.66, 0.66, 0.74], shade: 0.36,
    cloudShade: "#1e2630", cloudLit: "#8a5a5a", stars: 0.65, glint: ["#8a5a4a", "#c08070"],
  },
  {
    t: 0.93, name: "night",
    sky: ["#050a12", "#0b1624", "#142235", "#1d2c3a"], glow: [170, 190, 210, 0.12],
    land: [0.34, 0.4, 0.52], water: [0.5, 0.55, 0.68], shade: 0.58,
    cloudShade: "#0f1820", cloudLit: "#34404e", stars: 1, glint: ["#8aa2b0", "#e6eef0"],
  },
].map((frame) => ({
  ...frame,
  sky: frame.sky.map(hex),
  cloudShade: hex(frame.cloudShade),
  cloudLit: hex(frame.cloudLit),
  glint: frame.glint.map(hex),
}));

const SUNRISE = 0.23;
const SUNSET = 0.83;
const MOONRISE = 0.86;
const MOON_SPAN = 0.38;

const lerp = (a, b, k) => a + (b - a) * k;
const lerpArray = (a, b, k) => a.map((value, i) => lerp(value, b[i], k));
const ease = (k) => k * k * (3 - 2 * k);

export function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`;
}

export const toInt = ([r, g, b]) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

const arc = (p) => {
  const s = Math.sin(Math.PI * Math.min(1.1, Math.max(-0.1, p)));
  return Math.sign(s) * Math.abs(s) ** 0.6;
};

/** Sun and moon positions as fractions of the viewport; y > 0.5 means below the hills. */
function bodies(t) {
  const p = (t - SUNRISE) / (SUNSET - SUNRISE);
  const q = (((t - MOONRISE) % 1) + 1) % 1 / MOON_SPAN;
  return {
    // A steep arc near the horizon lifts the sun clear of the hills soon after sunrise.
    sun: { x: 0.93 - 0.6 * p, y: 0.52 - arc(p) * 0.45, up: p > -0.05 && p < 1.05 },
    moon: { x: 0.82 - 0.56 * q, y: 0.52 - arc(q) * 0.38, up: q <= 1 },
  };
}

/** The blended look of the scene at time-of-day `t`. */
export function skyAt(t) {
  t = ((t % 1) + 1) % 1;
  let i = KEYFRAMES.length - 1;
  while (i > 0 && KEYFRAMES[i].t > t) i -= 1;
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[(i + 1) % KEYFRAMES.length];
  const span = (b.t > a.t ? b.t : b.t + 1) - a.t;
  const k = ease(Math.min(1, Math.max(0, (t - a.t) / span)));

  const { sun, moon } = bodies(t);
  // Glints and cloud warmth follow whichever light is up.
  const sunUp = sun.up && sun.y < 0.5;
  const light = sunUp ? { ...sun, strength: 1, kind: "sun" } : moon.up && moon.y < 0.5 ? { ...moon, strength: 0.85, kind: "moon" } : { ...sun, strength: 0, kind: "none" };

  return {
    t,
    sky: a.sky.map((color, j) => lerpArray(color, b.sky[j], k)),
    glow: lerpArray(a.glow, b.glow, k),
    land: lerpArray(a.land, b.land, k),
    water: lerpArray(a.water, b.water, k),
    shade: lerp(a.shade, b.shade, k),
    cloudShade: lerpArray(a.cloudShade, b.cloudShade, k),
    cloudLit: lerpArray(a.cloudLit, b.cloudLit, k),
    stars: lerp(a.stars, b.stars, k),
    glint: a.glint.map((color, j) => lerpArray(color, b.glint[j], k)),
    sun,
    moon,
    light,
  };
}
