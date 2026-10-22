/**
 * Mystic nights: will-o'-the-wisps drifting over the far water, an
 * apparition by the far shore now and then, two red eyes surfacing near the
 * bank. Only deep in the night. Every event goes
 * through `onEvent(type)`, the hook for sounds later.
 *
 * The apparition is one of four, picked at random each time:
 * - boat: a boat with no oars and a lantern on its bow drifts along the far
 *   water and sinks away into the mist;
 * - angler: a ghostly angler sits on the far bank, makes one cast, and
 *   dissolves with his rod;
 * - mavka: a pale girl with long hair stands at the water's edge, walks into
 *   the water and is gone, leaving rings;
 * - lantern: just a lantern's light walking along the far shore; it stops,
 *   sways and goes out.
 */

const WISPS = 4;
const APPARITIONS = {
  boat: { life: [30, 40] },
  angler: { life: [18, 24] },
  mavka: { life: [16, 20] },
  lantern: { life: [20, 28] },
};

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
      const kinds = Object.keys(APPARITIONS);
      const kind = kinds[Math.floor(random() * kinds.length)];
      const [shortest, longest] = APPARITIONS[kind].life;
      this.figure = { kind, start: time, life: shortest + random() * (longest - shortest), x: 0.15 + random() * 0.7, dir: random() < 0.5 ? -1 : 1, sank: false };
      this.next.figure = 120 + random() * 180;
      this.onEvent("figure", this.figure);
    }
    const figure = this.figure;
    if (figure && figure.kind === "mavka" && !figure.sank && time - figure.start > figure.life * 0.6) {
      figure.sank = true;
      this.onEvent("mavkaSink", { x: figure.x });
    }
    if (figure && time - figure.start > figure.life) this.figure = null;

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

  /** Where the apparition is and how it looks this frame: `progress` runs 0..1 over its life. */
  apparition(time, alpha) {
    const { kind, start, life, x, dir } = this.figure;
    const progress = (time - start) / life;
    if (kind === "boat") {
      // Drifts a quarter of the view, settling lower as it goes into the mist.
      return { kind, x: x + dir * 0.22 * progress, alpha, progress, sink: Math.max(0, (progress - 0.7) / 0.3) };
    }
    if (kind === "lantern") {
      // Walks along the shore for the first half, then stops and sways; it gutters before it goes out.
      const walked = Math.min(progress, 0.5) * 2;
      const gutter = progress > 0.85 ? 0.5 + 0.5 * Math.sin(time * 23) * Math.sin(time * 7.3) : 1;
      return { kind, x: x + dir * 0.12 * walked, alpha: alpha * Math.max(0, gutter), progress, sway: progress > 0.5 ? Math.sin(time * 2.2) : Math.sin(time * 6) * 0.3 };
    }
    return { kind, x, alpha, progress, dir };
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
      figure: this.figure && this.apparition(time, fade(this.figure)),
      eyes: this.eyes && { x: this.eyes.x, y: this.eyes.y, alpha: Math.min(1, fade(this.eyes) * 1.6) },
    };
  }
}
