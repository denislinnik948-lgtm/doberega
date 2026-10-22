import { hash2 } from "./noise.js";

/**
 * Weather: dry spells and showers. Rain fades in and out smoothly; `intensity`
 * (0..1) drives the visuals and makes fish bite more eagerly.
 *
 * The rain follows real time, like the clock: time is cut into 12-minute
 * slots and a hash of the slot decides whether it brings a shower, when, how
 * long and how heavy. Every angler sees the same rain at the same moment,
 * with nothing to fetch from a server.
 */
const SLOT = 720;
const SHOWER_ODDS = 0.75;
// About 12 seconds to build up or clear.
const FADE = 12;

/** The shower in a slot, if any: start and end in seconds since the epoch, and its peak. */
function shower(slot) {
  if (hash2(slot, 0, 9100) >= SHOWER_ODDS) return null;
  // Showers last 1–2.5 minutes and stay inside their slot, so dry spells between them run 0–18 minutes.
  const length = 60 + hash2(slot, 1, 9100) * 90;
  const start = slot * SLOT + 120 + hash2(slot, 2, 9100) * (SLOT - 240 - length);
  return { start, end: start + length, peak: 0.5 + hash2(slot, 3, 9100) * 0.5 };
}

/** Rain intensity at a moment (seconds since the epoch). */
export function rainAt(seconds) {
  const rain = shower(Math.floor(seconds / SLOT));
  if (!rain) return 0;
  const rise = Math.min(1, Math.max(0, (seconds - rain.start) / FADE));
  const fall = Math.min(1, Math.max(0, 1 - (seconds - rain.end) / FADE));
  return rain.peak * Math.min(rise, fall);
}

export class Weather {
  constructor({ forced = null, now = () => Date.now() / 1000 } = {}) {
    this.forced = forced;
    this.now = now;
    this.intensity = forced ?? rainAt(now());
  }

  update() {
    this.intensity = this.forced ?? rainAt(this.now());
  }

  /** How much rain speeds up the bite (1 = no effect). */
  get biteBoost() {
    return 1 + 0.7 * this.intensity;
  }
}
