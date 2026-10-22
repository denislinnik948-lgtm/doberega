/**
 * Mystic nights: will-o'-the-wisps drifting over the far water, a pale figure
 * that stands on the far shore and fades, two red eyes surfacing near the
 * bank. Only deep in the night. Every event goes
 * through `onEvent(type)`, the hook for sounds later.
 */

const WISPS = 4;

/** How deep into the night it is (0 by day, 1 in the dead of night), with soft edges. */
export function nightDepth(dayTime) {
  const t = dayTime < 0.5 ? dayTime + 1 : dayTime;
  // Night runs from about 21:30 to 04:30 (0.9 .. 1.19 on this wrapped clock).
  const rise = Math.min(1, Math.max(0, (t - 0.88) / 0.04));
  const fall = Math.min(1, Math.max(0, (1.2 - t) / 0.04));
  return Math.min(rise, fall);
}

export class NightEvents {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.figure = null;
    this.eyes = null;
    // Seconds until the next of each rare event.
    this.next = { figure: 40 + random() * 80, eyes: 25 + random() * 60 };
    this.wisps = Array.from({ length: WISPS }, (_, i) => ({ phase: random() * 100, lane: (i + 0.5) / WISPS, speed: 0.02 + random() * 0.03 }));
  }

  reset() {
    this.figure = null;
    this.eyes = null;
  }

  /** Advance the night by `dt` seconds. */
  update(dt, time, dayTime) {
    const depth = nightDepth(dayTime);
    this.depth = depth;
    if (depth < 0.5) {
      this.figure = null;
      return;
    }
    const random = this.random;
    for (const key of Object.keys(this.next)) this.next[key] -= dt;

    if (!this.figure && this.next.figure <= 0) {
      this.figure = { start: time, life: 14 + random() * 8, x: 0.15 + random() * 0.7 };
      this.next.figure = 120 + random() * 180;
      this.onEvent("figure");
    }
    if (this.figure && time - this.figure.start > this.figure.life) this.figure = null;

    if (!this.eyes && this.next.eyes <= 0) {
      this.eyes = { start: time, life: 3 + random() * 1.5, x: 0.2 + random() * 0.6, y: 0.62 + random() * 0.18, sank: false };
      this.next.eyes = 90 + random() * 150;
      this.onEvent("eyes");
    }
    if (this.eyes && time - this.eyes.start > this.eyes.life) {
      if (!this.eyes.sank) this.onEvent("eyesSink", this.eyes);
      this.eyes = null;
    }
  }

  /** What to draw this frame, in fractions of the visible view. */
  visible(time) {
    if (!this.depth) return null;
    const wisps = this.wisps.map((wisp) => {
      const t = time * wisp.speed + wisp.phase;
      return {
        x: (wisp.lane + Math.sin(t * 1.7) * 0.08 + 1) % 1,
        rise: Math.sin(t * 2.3) * 0.5 + 0.5,
        flicker: 0.6 + 0.4 * Math.sin(time * 3.1 + wisp.phase * 7),
      };
    });
    const fade = (event) => {
      if (!event) return 0;
      const age = time - event.start;
      return Math.max(0, Math.min(1, age / 2.5, (event.life - age) / 2.5));
    };
    return {
      depth: this.depth,
      wisps,
      figure: this.figure && { x: this.figure.x, alpha: fade(this.figure) },
      eyes: this.eyes && { x: this.eyes.x, y: this.eyes.y, alpha: Math.min(1, fade(this.eyes) * 1.6) },
    };
  }
}
