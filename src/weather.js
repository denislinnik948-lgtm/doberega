import { hash2 } from "./noise.js";

/**
 * Weather: dry spells, showers and now and then a thunderstorm. Rain fades in
 * and out smoothly; `intensity` (0..1) drives the visuals and makes fish bite
 * more eagerly.
 *
 * The rain follows real time, like the clock: time is cut into 12-minute
 * slots and a hash of the slot decides whether it brings a shower, when, how
 * long, how heavy and whether it thunders. Every angler sees the same rain
 * and the same lightning at the same moment, with nothing to fetch from a server.
 */
const SLOT = 720;
// Two slots in five bring a shower: it rains about 7% of the time.
const SHOWER_ODDS = 0.4;
// About a third of the showers are thunderstorms.
const STORM_ODDS = 0.35;
// About 12 seconds to build up or clear.
const FADE = 12;
// How long a strike lights the sky, in seconds.
const FLASH = 0.9;

/** The shower in a slot, if any: start and end in seconds since the epoch, its peak, and its lightning. */
function shower(slot) {
  if (hash2(slot, 0, 9100) >= SHOWER_ODDS) return null;
  const storm = hash2(slot, 4, 9100) < STORM_ODDS;
  // Showers last 1–2.5 minutes (storms 1.5–2.5, and heavier) and stay inside their slot.
  const length = storm ? 90 + hash2(slot, 1, 9100) * 60 : 60 + hash2(slot, 1, 9100) * 90;
  const start = slot * SLOT + 120 + hash2(slot, 2, 9100) * (SLOT - 240 - length);
  const peak = storm ? 0.75 + hash2(slot, 3, 9100) * 0.25 : 0.5 + hash2(slot, 3, 9100) * 0.5;
  // A strike every 6–20 seconds once the storm has built up.
  const strikes = [];
  if (storm) {
    for (let at = start + FADE * 0.6, i = 0; ; i += 1) {
      at += 6 + hash2(slot, 10 + i, 9101) * 14;
      if (at > start + length) break;
      strikes.push({ at, x: 0.08 + hash2(slot, 10 + i, 9102) * 0.84, seed: slot * 100 + i, near: hash2(slot, 10 + i, 9103) });
    }
  }
  return { start, end: start + length, peak, storm, strikes };
}

const slotOf = (seconds) => Math.floor(seconds / SLOT);

/** Rain intensity at a moment (seconds since the epoch). */
export function rainAt(seconds) {
  const rain = shower(slotOf(seconds));
  if (!rain) return 0;
  const rise = Math.min(1, Math.max(0, (seconds - rain.start) / FADE));
  const fall = Math.min(1, Math.max(0, 1 - (seconds - rain.end) / FADE));
  return rain.peak * Math.min(rise, fall);
}

/** The latest strike at or before a moment, if it is still lighting the sky or rolling: { ...strike, age }. */
function strikeAt(seconds) {
  const rain = shower(slotOf(seconds));
  if (!rain?.storm) return null;
  let last = null;
  for (const strike of rain.strikes) if (strike.at <= seconds) last = strike;
  return last ? { ...last, age: seconds - last.at } : null;
}

/** How bright a strike lights the sky `age` seconds after it: a flash, a dip, a second flicker, then fading. */
function flashCurve(age) {
  if (age < 0 || age > FLASH) return 0;
  if (age < 0.07) return 1;
  if (age < 0.15) return 0.25;
  if (age < 0.24) return 0.8;
  return 0.8 * (1 - (age - 0.24) / (FLASH - 0.24)) ** 2;
}

export class Weather {
  /**
   * `forced`: a fixed rain (the `?rain=` switch); `storm` forces lightning with
   * it. `onThunder({ delay, near })` hears each strike as it happens.
   */
  constructor({ forced = null, storm = false, now = () => Date.now() / 1000, onThunder = null } = {}) {
    this.forced = forced;
    this.forcedStorm = storm;
    this.now = now;
    this.onThunder = onThunder;
    this.intensity = forced ?? rainAt(now());
    this.flash = 0;
    this.storm = 0;
    this.bolt = null;
    this.lastStrike = null;
    this.update();
  }

  update() {
    const now = this.now();
    this.intensity = this.forced ?? rainAt(now);
    // How stormy it is (0..1): a storm's sky is darker than a shower's.
    this.storm = this.forcedStorm ? this.intensity : this.forced === null && shower(slotOf(now))?.storm ? this.intensity : 0;
    const strike = this.forcedStorm ? forcedStrike(now) : this.forced === null ? strikeAt(now) : null;
    this.flash = strike ? flashCurve(strike.age) : 0;
    // The bolt itself shows only for the first instant of the flash.
    this.bolt = strike && strike.age < 0.3 ? strike : null;
    if (strike && strike.seed !== this.lastStrike) {
      const fresh = this.lastStrike !== null && strike.age < 1;
      this.lastStrike = strike.seed;
      // Sound covers about a kilometre in three seconds: near strikes crack at once, far ones rumble later.
      if (fresh) this.onThunder?.({ delay: 0.3 + (1 - strike.near) * 3.5, near: strike.near });
    }
  }

  /** How much rain speeds up the bite (1 = no effect). */
  get biteBoost() {
    return 1 + 1.15 * this.intensity;
  }
}

/** With `?storm=1`, a strike every 8 seconds, for testing. */
function forcedStrike(seconds) {
  const index = Math.floor(seconds / 8);
  return { at: index * 8, x: 0.1 + hash2(index, 1, 9102) * 0.8, seed: index, near: hash2(index, 2, 9103), age: seconds - index * 8 };
}
