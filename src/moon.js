import { DAY_SECONDS } from "./daycycle.js";

/*
 * The moon's phase. It runs off the real clock like the time of day, so every
 * angler sees the same moon: a lunar month lasts MOON_DAYS game days (about
 * 2 h 50 min of real time), from new moon through the full moon and back.
 * `?moon=full` (or new, firstQuarter...) pins a phase for testing.
 */
export const MOON_DAYS = 8;

export const MOON_PHASES = ["new", "waxingCrescent", "firstQuarter", "waxingGibbous", "full", "waningGibbous", "lastQuarter", "waningCrescent"];

const pinned = (() => {
  try {
    const id = new URLSearchParams(globalThis.location?.search ?? "").get("moon");
    return MOON_PHASES.includes(id) ? MOON_PHASES.indexOf(id) / MOON_PHASES.length : null;
  } catch {
    return null;
  }
})();

/**
 * The moon at a moment (seconds since the epoch): `phase` 0 new .. 0.5 full ..
 * 1 new again, `light` how much of the disc is lit (0..1), `waxing`, and the
 * phase's `id` (one of MOON_PHASES).
 */
export function moonAt(seconds) {
  const phase = pinned ?? (((seconds / (DAY_SECONDS * MOON_DAYS)) % 1) + 1) % 1;
  return {
    phase,
    light: (1 - Math.cos(2 * Math.PI * phase)) / 2,
    waxing: phase < 0.5,
    id: MOON_PHASES[Math.round(phase * MOON_PHASES.length) % MOON_PHASES.length],
  };
}

/**
 * How the moon moves the bite: under a full moon the nights are lively and
 * the days a little slower; at the new moon the nights go quiet and the days
 * pick up. Over a whole month it evens out (about 1.02 on average).
 */
export function moonBite(seconds, hour) {
  const { light } = moonAt(seconds);
  const night = hour < 5 || hour >= 21.5;
  return night ? 0.85 + 0.4 * light : 1.08 - 0.14 * light;
}
