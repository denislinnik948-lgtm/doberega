/**
 * Weather: dry spells and showers. Rain fades in and out smoothly; `intensity`
 * (0..1) drives the visuals and makes fish bite more eagerly.
 */
export class Weather {
  constructor({ random = Math.random, forced = null } = {}) {
    this.random = random;
    this.forced = forced;
    this.intensity = forced ?? 0;
    this.raining = false;
    // The first shower comes after a while, not right at the start.
    this.timer = 180 + random() * 240;
    this.peak = 0;
  }

  update(dt) {
    if (this.forced !== null) {
      this.intensity = this.forced;
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.raining = !this.raining;
      // Showers last 1–2.5 minutes; dry spells 6–14 minutes.
      this.timer = this.raining ? 60 + this.random() * 90 : 360 + this.random() * 480;
      if (this.raining) this.peak = 0.5 + this.random() * 0.5;
    }
    const target = this.raining ? this.peak : 0;
    // About 12 seconds to build up or clear.
    const step = dt / 12;
    this.intensity += Math.max(-step, Math.min(step, target - this.intensity));
  }

  /** How much rain speeds up the bite (1 = no effect). */
  get biteBoost() {
    return 1 + 0.7 * this.intensity;
  }
}
