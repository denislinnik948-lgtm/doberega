/**
 * The dragon of the last water: now and then, very rarely, it flies over the
 * ruined tower and away, by day or at dusk. Drawn in glyphs only, after the
 * prototype shown to the user: a horned head with an ember of an eye, a long
 * neck, spikes down its back and tail, a blade at the tail's end, and two bat
 * wings, each on four long finger bones from the wrist, the far one darker.
 *
 * `DragonSky` decides when it comes (`update`) and where it is (`visible`);
 * `dragonCells` lays one wingbeat's frame out in glyphs, cached.
 */

/** About once in four and a half hours at the water, never twice within half an hour. */
export const DRAGON = { perHour: 1 / 4.5, cooldown: 1800, flight: 10, from: 6, to: 21 };

const hash = (a, b, seed) => {
  const h = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

const inPolygon = (points, x, y) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const segmentDistance = (x, y, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};

/** A cubic curve as a polyline. */
const bezier = (a, b, c, d, steps = 14) => {
  const line = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const m = 1 - t;
    line.push([0, 1].map((k) => m * m * m * a[k] + 3 * m * m * t * b[k] + 3 * m * t * t * c[k] + t * t * t * d[k]));
  }
  return line;
};

const mixHex = (a, b, t) => {
  const k = Math.max(0, Math.min(1, t));
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [from, to] = [rgb(a), rgb(b)];
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(",")})`;
};

// Dark and lit ends of each material.
const PALETTE = {
  scale: ["#16130f", "#6e6152"],
  belly: ["#2a2116", "#a08a68"],
  wing: ["#1e110c", "#7a4a36"],
  bone: ["#120e0b", "#4a3c30"],
  horn: ["#3a3226", "#c8bca0"],
};

/** The dragon's shapes at one point of its wingbeat (`phase` in radians), facing right, in units about its body. */
function dragonShapes(phase) {
  const up = Math.cos(phase);
  const shapes = [];
  const tube = (line, w0, w1, mat) => shapes.push({ kind: "tube", line, w0, w1, mat });
  const poly = (points, mat, extra = {}) => shapes.push({ kind: "poly", points, mat, ...extra });
  const rad = Math.PI / 180;
  const wing = (far) => {
    const k = far ? 0.78 : 1;
    const shoulder = far ? [22, -20] : [8, -14];
    // The arm swings from raised high to swept down; the fingers fan out from the wrist.
    const arm = (-100 + ((1 - up) / 2) * 150) * rad;
    const wrist = [shoulder[0] + Math.cos(arm) * 58 * k, shoulder[1] + Math.sin(arm) * 58 * k];
    const sign = Math.sin(arm) < 0.25 ? -1 : 1;
    const tips = [150, 186, 168, 124].map((length, i) => {
      const a = arm + sign * (22 + i * 30) * rad;
      return [wrist[0] + Math.cos(a) * length * k, wrist[1] + Math.sin(a) * length * k];
    });
    const back = [shoulder[0] - 58 * k, shoulder[1] + 8];
    // The membrane scalloped in between the fingers.
    const membrane = [shoulder, wrist, tips[0]];
    const pull = (a, b) => {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      return [m[0] + (wrist[0] - m[0]) * 0.38, m[1] + (wrist[1] - m[1]) * 0.38];
    };
    for (let i = 0; i < 3; i += 1) membrane.push(pull(tips[i], tips[i + 1]), tips[i + 1]);
    membrane.push(pull(tips[3], back), back);
    poly(membrane, "wing", { far });
    shapes.push({ kind: "bones", segments: [[shoulder, wrist], ...tips.map((tip) => [wrist, tip])], mat: "bone", far });
    shapes.push({ kind: "claw", at: wrist, mat: "horn" });
  };
  wing(true);
  const tail = bezier([-48, 4], [-110, 34], [-160, -24], [-238, 6]);
  tube(tail, 17, 5, "scale");
  poly([[-232, 6], [-256, -8], [-248, 8], [-258, 22]], "horn");
  poly([[-56, -6], [-30, -22], [20, -24], [56, -14], [64, 2], [40, 18], [-10, 20], [-50, 12]], "scale");
  poly([[-46, 10], [-10, 18], [40, 16], [60, 4], [50, 12], [0, 24], [-40, 18]], "belly");
  tube([[40, 10], [46, 24], [42, 32]], 7, 4, "scale");
  tube([[-30, 14], [-36, 26], [-30, 34]], 7, 4, "scale");
  const neck = bezier([50, -10], [80, -20], [96, -46], [124, -52]);
  tube(neck, 16, 10, "scale");
  poly([[114, -62], [134, -64], [152, -58], [172, -54], [168, -46], [150, -45], [162, -40], [146, -37], [126, -40], [112, -48]], "scale");
  poly([[120, -60], [104, -72], [92, -74], [100, -68], [116, -56]], "horn");
  poly([[128, -62], [118, -78], [110, -82], [114, -74], [124, -58]], "horn");
  const spine = [...bezier([-40, -14], [-10, -24], [30, -24], [52, -16], 6), ...neck.slice(2, 12)];
  spine.forEach(([x, y], i) => {
    const h = i < 7 ? 7 : 6;
    const top = i < 7 ? y - 3 : y - 7;
    poly([[x - 3, top + 3], [x, top - h], [x + 3, top + 3]], "horn");
  });
  tail.slice(1, 10).forEach(([x, y], i) => poly([[x - 3, y - 6], [x, y - 12 + i * 0.5], [x + 3, y - 6]], "horn"));
  wing(false);
  return shapes;
}

function hit(shape, x, y) {
  if (shape.kind === "poly") return inPolygon(shape.points, x, y);
  if (shape.kind === "tube") {
    for (let i = 1; i < shape.line.length; i += 1) {
      const t = i / (shape.line.length - 1);
      if (segmentDistance(x, y, shape.line[i - 1], shape.line[i]) <= (shape.w0 + (shape.w1 - shape.w0) * t) / 2) return true;
    }
    return false;
  }
  if (shape.kind === "bones") return shape.segments.some(([a, b]) => segmentDistance(x, y, a, b) <= 2.8);
  return Math.hypot(x - shape.at[0], y - shape.at[1]) < 4;
}

const FRAMES = 24;
const cache = new Map();

/**
 * One frame of the wingbeat laid out in glyphs on a grid of `cellWidth` by
 * `lineHeight` pixels, the body `scale` pixels to a unit: a list of
 * { dx, dy, glyph, color } from the dragon's centre, facing right.
 */
export function dragonCells(phase, scale, cellWidth, lineHeight) {
  const frame = ((Math.round((phase / (Math.PI * 2)) * FRAMES) % FRAMES) + FRAMES) % FRAMES;
  const key = `${frame}:${scale.toFixed(3)}:${cellWidth.toFixed(2)}:${lineHeight.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size > FRAMES * 2) cache.clear();
  const shapes = dragonShapes((frame / FRAMES) * Math.PI * 2);
  const cells = [];
  for (let row = Math.floor((-150 * scale) / lineHeight); row * lineHeight < 90 * scale; row += 1) {
    for (let column = Math.floor((-265 * scale) / cellWidth); column * cellWidth < 195 * scale; column += 1) {
      const dx = (column + 0.5) * cellWidth;
      const dy = (row + 0.5) * lineHeight;
      const [x, y] = [dx / scale, dy / scale];
      let shape = null;
      for (let i = shapes.length - 1; i >= 0; i -= 1) {
        if (hit(shapes[i], x, y)) {
          shape = shapes[i];
          break;
        }
      }
      if (!shape) continue;
      const n = hash(column, row, 5);
      // Lit along its upper edges.
      const edge = !hit(shape, x - cellWidth / scale, y - lineHeight / scale);
      let glyph;
      let t;
      switch (shape.mat) {
        case "scale":
          glyph = "%&#@$"[Math.floor(n * 5)];
          t = 0.35 + (n - 0.5) * 0.3 + (edge ? 0.4 : 0) - Math.max(0, y) / 60;
          break;
        case "belly":
          glyph = row % 2 ? "=" : "-";
          t = 0.6 + (n - 0.5) * 0.2;
          break;
        case "wing":
          glyph = "%&#;"[Math.floor(n * 4)];
          t = (shape.far ? 0.12 : 0.4) + (n - 0.5) * 0.2 + (edge ? 0.3 : 0);
          break;
        case "bone":
          glyph = n > 0.5 ? "/" : "\\";
          t = shape.far ? 0.2 : 0.55;
          break;
        default:
          glyph = "^";
          t = 0.75;
      }
      const [dark, lit] = PALETTE[shape.mat];
      cells.push({ dx, dy, glyph, color: mixHex(dark, lit, t) });
    }
  }
  // The eye, an ember.
  cells.push({ dx: 148 * scale, dy: -50 * scale, glyph: "*", color: "#e8603a" });
  cache.set(key, cells);
  return cells;
}

/** When the dragon comes and where it is on its way across. */
export class DragonSky {
  constructor({ random = Math.random, onEvent = () => {}, soon = false } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.flight = null;
    // With `?dragon` it comes a few seconds after reaching the water, for testing.
    this.cooldown = soon ? -1 : 0;
    this.soon = soon;
  }

  /** Advance by `dt` seconds; `here` while fishing at the last water, `hour` 0..24. */
  update(dt, time, { here, hour }) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.flight && time - this.flight.start > this.flight.life) this.flight = null;
    if (this.flight || !here || this.cooldown > 0) return;
    if (hour < DRAGON.from || hour >= DRAGON.to) return;
    const due = this.soon ? (this.soonAt ??= time + 4) <= time : this.random() < (dt * DRAGON.perHour) / 3600;
    if (!due) return;
    this.soon = false;
    this.flight = { start: time, life: DRAGON.flight, dir: this.random() < 0.5 ? 1 : -1, height: 0.17 + this.random() * 0.04 };
    this.cooldown = DRAGON.cooldown;
    this.onEvent("dragon", this.flight);
  }

  /** Where it is this frame: `x` 0..1 across the view (it starts and ends off screen), `y` a fraction of the height, its wingbeat. */
  visible(time) {
    const flight = this.flight;
    if (!flight) return null;
    const progress = (time - flight.start) / flight.life;
    const across = -0.2 + progress * 1.4;
    return {
      x: flight.dir > 0 ? across : 1 - across,
      // A long shallow swoop, lowest about the middle of the view, over the tower.
      y: flight.height + Math.sin(progress * Math.PI) * 0.04 + Math.sin(time * 1.3) * 0.006,
      dir: flight.dir,
      phase: time * 5,
    };
  }

  /** Gone at once (leaving the water). */
  reset() {
    this.flight = null;
  }
}
