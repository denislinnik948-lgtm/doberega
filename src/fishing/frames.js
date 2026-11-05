import { P } from "./palette.js";

/**
 * Pixel-art frames drawn on a canvas behind an element: thorny bone borders
 * with tangled corners, framed title tabs with a speech notch, ticked text
 * boxes, and ordered-dither fills. Frames redraw whenever the element resizes.
 */

const PIXEL = 2;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** "#rrggbb" as a pixel word for a little-endian RGBA buffer (opaque). */
const words = new Map();
function wordOf(color) {
  let word = words.get(color);
  if (word === undefined) {
    const value = parseInt(color.slice(1), 16);
    word = (0xff000000 | ((value & 0xff) << 16) | (value & 0xff00) | ((value >> 16) & 0xff)) >>> 0;
    words.set(color, word);
  }
  return word;
}

/**
 * The art pixels of one frame, written straight into a buffer and put on the
 * canvas in one go (see `flush`): a dithered window is tens of thousands of
 * pixels, far too many to draw one fillRect at a time.
 */
class Pixels {
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.image = ctx.createImageData(width, height);
    this.data = new Uint32Array(this.image.data.buffer);
  }

  set(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[(y | 0) * this.width + (x | 0)] = wordOf(color);
  }

  rect(x, y, w, h, color) {
    const x0 = Math.max(0, Math.round(x));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y));
    const y1 = Math.min(this.height, Math.round(y + h));
    if (x1 <= x0) return;
    const word = wordOf(color);
    for (let row = y0; row < y1; row += 1) this.data.fill(word, row * this.width + x0, row * this.width + x1);
  }

  flush() {
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Vertical ordered-dither blend from `top` to `bottom` colour between rows y0..y1. */
  dither(x0, y0, x1, y1, top, bottom, bias = 0) {
    for (let y = y0; y < y1; y += 1) {
      const t = (y - y0) / Math.max(1, y1 - y0 - 1) + bias;
      for (let x = x0; x < x1; x += 1) this.set(x, y, t * 16 > BAYER[y & 3][x & 3] + 0.5 ? bottom : top);
    }
  }

  outlineRect(x, y, w, h, color) {
    this.rect(x, y, w, 1, color);
    this.rect(x, y + h - 1, w, 1, color);
    this.rect(x, y, 1, h, color);
    this.rect(x + w - 1, y, 1, h, color);
  }
}

/** Walk the inside of a rectangle edge, calling fn(x, y, outwardX, outwardY). */
function alongEdges(x, y, w, h, fn) {
  for (let i = 0; i < w; i += 1) {
    fn(x + i, y, 0, -1);
    fn(x + i, y + h - 1, 0, 1);
  }
  for (let i = 1; i < h - 1; i += 1) {
    fn(x, y + i, -1, 0);
    fn(x + w - 1, y + i, 1, 0);
  }
}

/*
 * Frame lines are drawn in muted greens rather than bright bone, so a window
 * reads as a calm panel and its text and buttons stand out, not its edges.
 */
const EDGE = "#7f998c";
const EDGE_SOFT = "#58726a";
const EDGE_FAINT = "#3a5650";

/** A thorny, slightly broken line with the odd knot and spike. */
function thornyBorder(px, x, y, w, h, random) {
  px.outlineRect(x, y, w, h, EDGE);
  let next = 3;
  let index = 0;
  alongEdges(x, y, w, h, (ex, ey, ox, oy) => {
    index += 1;
    if (index < next) return;
    next = index + 6 + Math.floor(random() * 10);
    const roll = random();
    if (roll < 0.25) {
      // A short spike sticking out.
      px.set(ex + ox, ey + oy, EDGE_SOFT);
    } else if (roll < 0.45) {
      // Knot: a little bump on both sides of the line.
      px.set(ex + ox, ey + oy, EDGE_SOFT);
      px.set(ex - ox, ey - oy, EDGE_SOFT);
    } else if (roll < 0.6) {
      // Small gap in the line.
      px.set(ex, ey, EDGE_SOFT);
    }
  });
}

/** A small tangle of branches growing out of a corner. */
function cornerTangle(px, cx, cy, dx, dy, size, random) {
  for (let branch = 0; branch < 5; branch += 1) {
    let x = cx;
    let y = cy;
    const alongX = random() < 0.5;
    const steps = Math.round(size * (0.4 + random() * 0.5));
    for (let s = 0; s < steps; s += 1) {
      const r = random();
      if (alongX) {
        x += dx * (r < 0.7 ? 1 : 0);
        y += dy * (r > 0.6 ? (random() < 0.5 ? 1 : -1) : 0);
      } else {
        y += dy * (r < 0.7 ? 1 : 0);
        x += dx * (r > 0.6 ? (random() < 0.5 ? 1 : -1) : 0);
      }
      px.set(x, y, s > steps * 0.6 ? EDGE_SOFT : EDGE);
    }
  }
  // A knot right at the corner.
  for (let k = 0; k < size; k += 1) {
    const x = cx + Math.round((random() - 0.3) * 4) * dx;
    const y = cy + Math.round((random() - 0.3) * 4) * dy;
    px.set(x, y, random() < 0.6 ? EDGE : EDGE_SOFT);
  }
}

/** Short ticks on a thin line, with tiny boxes at the corners (the caption box). */
function tickedBorder(px, x, y, w, h, random, color = EDGE_SOFT) {
  px.outlineRect(x, y, w, h, color);
  let next = 4;
  let index = 0;
  alongEdges(x, y, w, h, (ex, ey, ox, oy) => {
    index += 1;
    if (index < next) return;
    next = index + 8 + Math.floor(random() * 14);
    const dir = random() < 0.5 ? 1 : -1;
    px.set(ex + ox * dir, ey + oy * dir, color);
  });
  for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) {
    px.outlineRect(cx - 1, cy - 1, 3, 3, color);
    px.set(cx, cy, P.ink);
  }
}

function pine(px, x, base, height, color) {
  for (let k = 0; k < height; k += 1) {
    const half = Math.floor((k / height) * height * 0.32);
    px.rect(x - half, base - height + k, half * 2 + 1, 1, color);
  }
}

/** Ridge silhouette from `base` up by `amp`, using a few summed sines. */
function ridge(px, x0, x1, base, amp, seed, color, floor) {
  for (let x = x0; x < x1; x += 1) {
    const top = Math.round(base - amp * (0.55 + 0.3 * Math.sin(x * 0.045 + seed) + 0.15 * Math.sin(x * 0.13 + seed * 2)));
    px.rect(x, top, 1, floor - top, color);
  }
}

/** A small, high-contrast landscape for each kind of fishing spot. */
function landscape(px, w, h, random, kind) {
  const m = 3;
  const x0 = m;
  const x1 = w - m;
  const horizon = Math.round(h * (kind === "bridge" ? 0.42 : 0.52));
  const unit = h / 100;

  // Sky: dark overhead, warm and light toward the horizon, dithered.
  px.dither(x0, m, x1, horizon, P.dark, P.soft, -0.1);
  const sx = Math.round(w * (kind === "castle" ? 0.3 : 0.34));
  const sy = horizon - Math.round(10 * unit);
  const sr = Math.max(4, Math.round(7 * unit));
  for (let y = sy - sr * 3; y < horizon; y += 1) {
    for (let x = sx - sr * 3; x <= sx + sr * 3; x += 1) {
      const d = Math.hypot(x - sx, y - sy);
      if (d <= sr) px.set(x, y, d < sr - 1 ? P.bone : P.gold);
      else if (d < sr * 2.4 && (x + y) % 2 === 0 && d / (sr * 2.4) * 16 < 8 + ((x * 3 + y) % 8)) px.set(x, y, P.light);
    }
  }

  // Water: dark, with the sun's broken reflection below it.
  px.dither(x0, horizon, x1, h - m, P.dark, P.ink, 0.1);
  for (let y = horizon + 2; y < h - m - 2; y += 2) {
    const spread = 2 + (y - horizon) * 0.35;
    if (random() < 0.8) px.rect(Math.round(sx - spread / 2 + (random() - 0.5) * spread), y, Math.max(2, Math.round(spread * random())), 1, y % 4 ? P.gold : P.light);
  }
  for (let i = 0; i < w / 4; i += 1) {
    const y = horizon + 3 + Math.floor(random() * (h - horizon - 8));
    px.rect(x0 + 2 + Math.floor(random() * (w - 2 * m - 8)), y, 2 + Math.floor(random() * 5), 1, P.mid);
  }

  if (kind === "pond") {
    // Flat farmland: a meadow band and a ploughed strip along the far bank.
    px.rect(x0, horizon - Math.round(4 * unit), w - 2 * m, Math.round(4 * unit) + 1, P.mid);
    px.rect(x0 + Math.round(w * 0.45), horizon - Math.round(2 * unit), Math.round(w * 0.3), Math.round(2 * unit), P.goldDark);
    // Scattered clumps of trees of different heights, and a few small houses.
    for (let x = x0 + 4; x < x1 - 4; x += 6 + Math.floor(random() * 14)) {
      if (random() < 0.35) continue;
      const tall = Math.round((8 + random() * 16) * unit);
      const r = Math.max(2, Math.round(tall * (random() < 0.3 ? 0.18 : 0.35)));
      for (let k = 0; k < tall; k += 1) {
        const half = k > tall * 0.25 ? Math.round(r * Math.sin(((k - tall * 0.25) / (tall * 0.75)) * Math.PI)) : 0;
        px.rect(x - half, horizon - 1 - k, half * 2 + 1, 1, k < tall * 0.25 ? P.ink : P.deep);
      }
    }
    for (const fx of [0.08, 0.33, 0.93]) {
      const hx = Math.round(w * fx);
      const top = horizon - Math.round(4 * unit);
      px.rect(hx - 3, top - 3, 7, 4, P.light);
      for (let k = 0; k < 3; k += 1) px.rect(hx - 4 + k, top - 4 - k, 9 - 2 * k, 1, fx > 0.9 ? P.ember : P.goldDark);
    }
    px.rect(x0, horizon, w - 2 * m, 1, P.dark);
    // Thick reeds and cattails crowding both near corners.
    for (let i = 0; i < w / 2.5; i += 1) {
      const side = random() < 0.5;
      const x = side ? x0 + Math.floor(random() * w * 0.3) : x1 - 1 - Math.floor(random() * w * 0.3);
      const tall = Math.round((14 + random() * 34) * unit);
      const lean = (random() - 0.5) * 0.3;
      for (let k = 0; k < tall; k += 1) px.set(x + Math.round(k * lean), h - m - 1 - k, random() < 0.3 ? P.dark : P.ink);
      if (random() < 0.3) px.rect(x + Math.round(tall * lean) - 1, h - m - tall - 3, 2, 4, P.goldDark);
    }
  } else if (kind === "lake") {
    ridge(px, x0, x1, horizon, 16 * unit, 2.2, P.dark, horizon + 1);
    for (let x = x0 + 2; x < x1; x += 2 + Math.floor(random() * 4)) pine(px, x, horizon + 1, Math.round((8 + random() * 14) * unit), P.ink);
    px.rect(x0, horizon, w - 2 * m, 1, P.ink);
  } else if (kind === "castle") {
    // Snowy peaks on the right, a wooded crag with a castle on the left.
    for (let x = x0; x < x1; x += 1) {
      const u = (x - x0) / (w - 2 * m);
      const ramp = Math.min(1, Math.max(0, (u - 0.3) / 0.4));
      const tri = (v) => 1 - Math.abs((v % 2) - 1);
      const top = Math.round(horizon - ramp * (14 + 18 * tri(x * 0.05 + 1) + 8 * tri(x * 0.13)) * unit);
      for (let y = top; y <= horizon; y += 1) px.set(x, y, y < horizon - 26 * unit ? P.bone : (x + y) % 3 ? P.soft : P.mid);
    }
    for (let x = x0; x < Math.round(w * 0.62); x += 1) {
      const u = (x - x0) / (w * 0.62);
      const lift = u < 0.55 ? 30 - Math.abs(u - 0.3) * 20 : 30 * (1 - (u - 0.55) / 0.45) ** 1.4;
      const top = Math.round(horizon - lift * unit);
      for (let y = top; y <= horizon; y += 1) {
        const cliff = u > 0.18 && u < 0.5 && y < top + 12 * unit * Math.sin(Math.PI * (u - 0.18) / 0.32);
        px.set(x, y, cliff ? (x % 3 ? P.soft : P.mid) : (x * 7 + y * 3) % 5 ? P.deep : P.dark);
      }
    }
    // Ruined castle: broken grey walls and gutted towers, no roofs.
    const ground = horizon - Math.round(30 * unit);
    for (let x = Math.round(w * 0.1); x < Math.round(w * 0.31); x += 1) {
      const broken = Math.floor((((x * 37) % 11) / 11) * 3);
      px.rect(x, ground - Math.round(4 * unit) + broken, 1, Math.round(4 * unit) - broken, P.soft);
    }
    for (const [fx, tall] of [[0.15, 14], [0.21, 9], [0.3, 11]]) {
      const x = Math.round(w * fx);
      for (let k = -3; k <= 3; k += 1) px.rect(x + k, ground - Math.round(tall * unit) + ((k * 13 + 20) % 4), 1, Math.round(tall * unit), k < 0 ? P.light : P.soft);
      px.rect(x, ground - Math.round(tall * 0.6 * unit), 1, 2, P.ink);
    }
    for (const fx of [0.82, 0.94]) {
      const hx = Math.round(w * fx);
      px.rect(hx - 4, horizon - Math.round(4 * unit), 8, Math.round(4 * unit), P.light);
      px.rect(hx - 5, horizon - Math.round(6 * unit), 10, Math.round(2 * unit), P.ember);
    }
    px.rect(x0, horizon, w - 2 * m, 1, P.ink);
  } else if (kind === "reservoir") {
    // Pripyat: the Chornobyl plant along a flat far shore, as seen across the cooling pond.
    const u = (n) => Math.max(1, Math.round(n * unit));
    const at = (f) => Math.round(w * f);
    // The cooling tower, a broad waisted cone with a dark unfinished rim.
    const towerX = at(0.13);
    const towerH = u(26);
    for (let y = 0; y < towerH; y += 1) {
      const half = Math.round(w * (0.042 + 0.024 * (1 - y / towerH) ** 1.5));
      px.rect(towerX - half, horizon - y, half * 2, 1, y >= towerH - u(1.5) ? P.mid : P.soft);
      px.rect(towerX - half, horizon - y, Math.round(half * 0.8), 1, y >= towerH - u(1.5) ? P.mid : P.light);
    }
    // Units 5 and 6 under their cranes, with rust-red panels.
    px.rect(at(0.25), horizon - u(7), at(0.13), u(7) + 1, P.soft);
    for (let x = at(0.25); x < at(0.38); x += u(4)) px.rect(x, horizon - u(7), u(2), u(2), P.ember);
    for (const [f, reach] of [[0.26, 0.05], [0.32, -0.04], [0.37, 0.05]]) {
      const x = at(f);
      const top = horizon - u(f === 0.32 ? 20 : 16);
      for (let y = top; y < horizon - u(7); y += 1) px.set(x, y, P.mid);
      const from = Math.min(x, x + at(reach));
      px.rect(from - (reach > 0 ? u(2) : 0), top + 1, Math.abs(at(reach)) + u(2), 1, P.mid);
    }
    // The lone steel gantry.
    px.rect(at(0.46), horizon - u(10), 1, u(10), P.dark);
    px.rect(at(0.51), horizon - u(10), 1, u(10), P.dark);
    px.rect(at(0.455), horizon - u(10), at(0.06), u(2), P.dark);
    // The New Safe Confinement.
    const archX = at(0.6);
    const archR = at(0.065);
    for (let dx = -archR; dx <= archR; dx += 1) {
      const top = Math.round(Math.sqrt(Math.max(0, 1 - (dx / archR) ** 2)) * archR * 0.7);
      px.rect(archX + dx, horizon - top, 1, top + 1, Math.abs(dx) % 3 === 0 ? P.soft : P.light);
    }
    // The long main block with its two red-and-white stacks.
    px.rect(at(0.67), horizon - u(6), at(0.3), u(6) + 1, P.light);
    px.rect(at(0.76), horizon - u(9), at(0.11), u(3), P.light);
    for (const [f, tall] of [[0.72, 24], [0.94, 27]]) {
      const x = at(f);
      const stackH = u(tall);
      const band = Math.max(1, u(2));
      for (let y = 0; y < stackH; y += 1) px.rect(x, horizon - y, Math.max(2, u(1.5)), 1, Math.floor(y / band) % 2 ? P.bone : P.ember);
    }
    // Willows along the far waterline, yellowing.
    for (let x = x0; x < x1; x += 1) px.rect(x, horizon - Math.round(random() * 2 * unit), 1, u(2), random() < 0.5 ? P.goldDark : P.dark);
    // A rusty wreck near the far bank, bow up.
    const wreckX = at(0.22);
    const wreckY = Math.round(horizon + (h - horizon) * 0.2);
    const wreckW = at(0.14);
    for (let dx = 0; dx < wreckW; dx += 1) {
      const rise = Math.round((dx / wreckW) ** 1.7 * 5 * unit);
      px.rect(wreckX + dx, wreckY - rise - u(1), 1, rise + u(1) + 1, dx % 4 === 0 ? P.goldDark : P.ember);
    }
    px.rect(wreckX + Math.round(wreckW * 0.15), wreckY - u(3.5), Math.round(wreckW * 0.25), u(2.5), P.goldDark);
    // Dry reeds in the near corners.
    for (const side of [0, 1]) {
      for (let k = 0; k < 9; k += 1) {
        const x = side ? x1 - 1 - Math.floor(random() * w * 0.12) : x0 + Math.floor(random() * w * 0.12);
        const tall = Math.round((h - horizon) * (0.3 + random() * 0.45));
        for (let y = 0; y < tall; y += 1) px.set(x + Math.round((y / tall) ** 2 * (side ? -2 : 2) * unit), h - 1 - y, y > tall * 0.6 ? P.gold : P.goldDark);
      }
    }
  } else if (kind === "troutfarm") {
    // Smerekove: pale rock peaks, spruce woods down to the water, a log hut, and the jetty we sit on.
    for (let x = x0; x < x1; x += 1) {
      const u = (x - x0) / (w - 2 * m);
      const tri = (v) => 1 - Math.abs((v % 2) - 1);
      // High on the left, falling away to the right.
      const lift = (0.55 + 0.45 * (1 - u)) * (12 + 16 * tri(x * 0.045 + 0.4) + 6 * tri(x * 0.15));
      const top = Math.round(horizon - lift * unit);
      for (let y = top; y <= horizon; y += 1) px.set(x, y, y < top + 3 * unit && lift > 22 ? P.bone : (x + y) % 3 ? P.soft : P.mid);
    }
    ridge(px, x0, x1, horizon, 9 * unit, 4.1, P.deep, horizon + 1);
    for (let x = x0 + 1; x < x1; x += 2 + Math.floor(random() * 3)) pine(px, x, horizon + 1, Math.round((6 + random() * 10) * unit), P.ink);
    // The log hut on the far bank.
    const hx = Math.round(w * 0.36);
    const top = horizon - Math.round(4 * unit);
    px.rect(hx - 4, top - 1, 9, Math.round(4 * unit) + 1, P.goldDark);
    for (let k = 0; k < 4; k += 1) px.rect(hx - 5 + k, top - 2 - k, 11 - 2 * k, 1, P.ember);
    px.rect(x0, horizon, w - 2 * m, 1, P.ink);
    // The jetty: boards narrowing toward the water, a mooring post on each far corner.
    const front = Math.round(h * 0.86);
    for (let y = front; y < h - m; y += 1) {
      const t = (y - front) / Math.max(1, h - m - front);
      const half = Math.round(w * (0.12 + 0.06 * t));
      const cx = Math.round(w / 2);
      for (let x = cx - half; x <= cx + half; x += 1) {
        const board = Math.floor(((x - (cx - half)) / (2 * half + 1)) * 7);
        const seam = Math.floor(((x + 1 - (cx - half)) / (2 * half + 1)) * 7) !== board;
        px.set(x, y, y === front ? P.gold : seam ? P.ink : (x + y) % 5 === 0 ? P.dark : P.goldDark);
      }
    }
    for (const side of [-1, 1]) px.rect(Math.round(w / 2 + side * w * 0.11) - 1, front - Math.round(5 * unit), 3, Math.round(5 * unit), P.goldDark);
  } else if (kind === "quarry") {
    // The granite quarry: grey walls straight up out of the water, woods on the rim, mirrored below, pale slabs in front.
    const wall = (x) => {
      const u = (x - x0) / (w - 2 * m);
      const tall = u < 0.05 ? 7 : u < 0.4 ? 20 : u < 0.46 ? 7 : u < 0.62 ? 14 : u < 0.8 ? 10 : 7;
      return Math.round(tall * unit * (0.9 + 0.2 * ((Math.floor(x / 4) * 7) % 5) / 5));
    };
    for (let x = x0; x < x1; x += 1) {
      const top = horizon - wall(x);
      for (let y = top; y <= horizon; y += 1) px.set(x, y, (x * 5 + y * 3) % 7 === 0 ? P.dark : (x + y) % 3 ? P.soft : P.mid);
      // A crack now and then down the face.
      if (x % 9 === 4) for (let y = top + 2; y < horizon - 1; y += 1) if ((y + x) % 4) px.set(x, y, P.dark);
      // The mirror below the walls.
      for (let y = horizon + 1; y <= horizon + wall(x) * 0.7 && y < h - m; y += 2) px.set(x, y, (x + y) % 3 ? P.mid : P.dark);
    }
    for (let x = x0 + 1; x < x1; x += 2 + Math.floor(random() * 3)) pine(px, x, horizon - wall(x) + 1, Math.round((6 + random() * 10) * unit), P.ink);
    px.rect(x0, horizon, w - 2 * m, 1, P.ink);
    // Pale granite slabs along the near edge.
    const front = Math.round(h * 0.88);
    for (let y = front; y < h - m; y += 1) {
      for (let x = x0; x < x1; x += 1) px.set(x, y, y === front ? P.dark : (x * 3 + y * 7) % 11 === 0 ? P.mid : P.light);
    }
  } else if (kind === "carplake") {
    // «Тиха заводь»: two green hills, a viaduct of arches high between them, a train on it.
    const hill = (x) => {
      const u = (x - x0) / (w - 2 * m);
      const bump = (c, half, tall) => (Math.abs(u - c) < half ? tall * (0.5 + 0.5 * Math.cos((Math.PI * (u - c)) / half)) : 0);
      return Math.round(Math.max(bump(0.1, 0.45, 34), bump(0.92, 0.42, 28)) * unit);
    };
    for (let x = x0; x < x1; x += 1) for (let y = horizon - hill(x); y <= horizon; y += 1) px.set(x, y, (x * 3 + y) % 5 ? P.mid : P.soft);
    const deck = horizon - Math.round(18 * unit);
    let from = Math.round(w / 2);
    while (from > x0 && hill(from) < horizon - deck) from -= 1;
    let to = Math.round(w / 2);
    while (to < x1 && hill(to) < horizon - deck) to += 1;
    const spans = 5;
    const span = (to - from) / spans;
    // The deck, the piers down to the ground, and an arch between each pair.
    px.rect(from, deck, to - from, Math.max(2, Math.round(2 * unit)), P.light);
    for (let k = 1; k < spans; k += 1) {
      const x = Math.round(from + k * span);
      px.rect(x - 1, deck, 3, horizon - hill(x) - deck, P.light);
    }
    for (let x = from; x < to; x += 1) {
      const t = ((x - from) % span) / span;
      const y = deck + Math.round(2 * unit) + Math.round((1 - Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))) * span * 0.4);
      if (y < horizon - hill(x)) px.set(x, y, P.light);
    }
    // A little train with its smoke.
    const tx = Math.round(from + (to - from) * 0.55);
    px.rect(tx - Math.round(10 * unit), deck - Math.round(3 * unit), Math.round(10 * unit), Math.round(3 * unit), P.ember);
    px.rect(tx, deck - Math.round(3 * unit), Math.round(4 * unit), Math.round(3 * unit), P.ink);
    for (let k = 0; k < 5; k += 1) px.rect(tx + Math.round((1 - k * 3) * unit), deck - Math.round((5 + k * 2) * unit), Math.round((2 + k) * unit), Math.round(2 * unit), k < 2 ? P.mid : P.light);
    px.rect(x0, horizon, w - 2 * m, 1, P.ink);
  } else if (kind === "bridge") {
    ridge(px, x0, x1, horizon, 12 * unit, 1.3, P.dark, horizon + 1);
    for (let x = x0 + 2; x < x1; x += 3 + Math.floor(random() * 6)) {
      const tall = Math.round((6 + random() * 12) * unit);
      const r = Math.max(2, Math.round(tall * 0.4));
      for (let k = 0; k < tall; k += 1) {
        const half = Math.round(r * Math.sin((k / tall) * Math.PI * 0.9 + 0.2));
        px.rect(x - half, horizon - k, half * 2 + 1, 1, P.deep);
      }
    }
    // Banks close in on a bend; the current streaks away from the viewer.
    const rail = Math.round(h * 0.84);
    for (let y = horizon; y < rail; y += 1) {
      const t = (y - horizon) / (rail - horizon);
      // The river swings right far off and leaves the picture.
      const center = w * (0.5 + 0.55 * (1 - t) ** 2.2);
      const half = w * (0.15 + 0.31 * t ** 0.9);
      const left = Math.round(center - half);
      const right = Math.round(center + half);
      if (left > x0) px.rect(x0, y, left - x0, 1, P.ink);
      if (right < x1) px.rect(right, y, x1 - right, 1, P.ink);
      for (let k = 0; k < 3; k += 1) {
        const lane = left + 2 + Math.floor(random() * Math.max(1, right - left - 4));
        if (random() < 0.35 + t * 0.3) px.rect(lane, y, 1, 1 + Math.round(t * 2), t > 0.5 ? P.light : P.soft);
      }
    }
    // Wooden railing in the foreground.
    px.rect(x0, rail, w - 2 * m, Math.round(3 * unit), P.goldDark);
    px.rect(x0, rail, w - 2 * m, 1, P.gold);
    px.rect(x0, rail + Math.round(9 * unit), w - 2 * m, Math.round(2 * unit), P.goldDark);
    for (let x = x0 + Math.round(w * 0.06); x < x1; x += Math.round(w * 0.2)) px.rect(x, rail - 1, Math.round(3 * unit), h - m - rail + 1, P.ink);
  }
  thornyBorder(px, m, m, w - 2 * m, h - 2 * m, random);
}

/*
 * A trophy board: dark-stained planks with their grain, cut corners, a bevel
 * lit from the top left, and a brass screw at each end. A legend's board has
 * a gold trim.
 */
const WOOD = { edge: "#1c120a", dark: "#3a2614", mid: "#553720", light: "#6e4a2a", grain: "#46301a", lit: "#86603a" };
function plaque(px, w, h, random, variant) {
  const cut = Math.max(3, Math.round(Math.min(w, h) * 0.1));
  const inset = (y) => Math.max(0, cut - y, cut - (h - 1 - y));
  const planks = Math.max(2, Math.round(h / 34));
  const plankH = h / planks;
  const phase = random() * 10;
  for (let y = 0; y < h; y += 1) {
    const x0 = inset(y);
    const plank = Math.floor(y / plankH);
    const seam = y > 0 && Math.floor((y - 1) / plankH) !== plank;
    for (let x = x0; x < w - x0; x += 1) {
      const border = y === 0 || y === h - 1 || x === x0 || x === w - x0 - 1;
      let color;
      if (border) color = WOOD.edge;
      else if (seam) color = WOOD.edge;
      else {
        // Grain: long wavy streaks along each plank, a knot here and there.
        const wave = Math.sin(x * 0.07 + plank * 2.1 + phase) * 2.2 + Math.sin(x * 0.019 + plank) * 3;
        const streak = Math.sin((y - plank * plankH + wave) * 1.3 + plank * 5);
        color = streak > 0.82 ? WOOD.grain : streak < -0.9 ? WOOD.light : (x + y) % 7 === 0 && streak > 0.4 ? WOOD.dark : WOOD.mid;
      }
      px.set(x, y, color);
    }
    // Bevel: light along the top and left edges, dark along the bottom and right.
    if (y > 0 && y < h - 1) {
      px.set(x0 + 1, y, WOOD.lit);
      px.set(w - x0 - 2, y, WOOD.dark);
    }
  }
  px.rect(cut + 1, 1, w - cut * 2 - 2, 1, WOOD.lit);
  px.rect(cut + 1, h - 2, w - cut * 2 - 2, 1, WOOD.dark);
  if (variant === "legend") {
    for (let y = 2; y < h - 2; y += 1) {
      const x0 = inset(y) + 2;
      px.set(x0, y, P.gold);
      px.set(w - x0 - 1, y, P.gold);
    }
    px.rect(cut + 2, 2, w - cut * 2 - 4, 1, P.gold);
    px.rect(cut + 2, h - 3, w - cut * 2 - 4, 1, P.goldDark);
  }
  // Two brass screws holding the board.
  for (const sx of [cut + 3, w - cut - 5]) {
    const sy = Math.round(h / 2) - 1;
    px.rect(sx, sy, 2, 2, P.goldDark);
    px.set(sx, sy, P.gold);
  }
}

const PAINTERS = {
  plaque(px, w, h, random, variant) {
    plaque(px, w, h, random, variant);
  },
  location(px, w, h, random, variant) {
    landscape(px, w, h, random, variant);
  },
  /** Big dialog windows: dithered dark fill, thorny frame, tangled corners. */
  ornate(px, w, h, random) {
    const m = 5;
    px.dither(m, m, w - m, h - m, P.dark, P.deep, -0.15);
    thornyBorder(px, m, m, w - 2 * m, h - 2 * m, random);
    const size = Math.min(10, Math.floor(Math.min(w, h) / 8));
    cornerTangle(px, m, m, 1, 1, size, random);
    cornerTangle(px, w - m - 1, m, -1, 1, size, random);
    cornerTangle(px, m, h - m - 1, 1, -1, size, random);
    cornerTangle(px, w - m - 1, h - m - 1, -1, -1, size, random);
  },
  /** Picture frame: a lake-at-dusk dither (sky over dark water) inside a thorny border. */
  picture(px, w, h, random) {
    const m = 3;
    const horizon = Math.round(h * 0.58);
    px.dither(m, m, w - m, horizon, P.mid, P.dark, 0.05);
    px.dither(m, horizon, w - m, h - m, P.deep, P.ink, 0.2);
    for (let y = horizon + 2; y < h - m - 2; y += 3) {
      for (let x = m + 2 + (y % 2); x < w - m - 2; x += 4) if (random() < 0.5) px.set(x, y, P.dark);
    }
    for (let i = 0; i < w / 6; i += 1) px.rect(m + Math.floor(random() * (w - 2 * m - 6)), horizon + 3 + Math.floor(random() * (h - horizon - 8)), 2 + Math.floor(random() * 4), 1, P.dark);
    thornyBorder(px, m, m, w - 2 * m, h - 2 * m, random);
  },
  /** Caption / text box: ink fill with a thin ticked line. */
  box(px, w, h, random) {
    px.rect(2, 2, w - 4, h - 4, P.ink);
    tickedBorder(px, 2, 2, w - 4, h - 4, random);
  },
  /** Recessed slot for items. */
  well(px, w, h, random) {
    px.dither(2, 2, w - 2, h - 2, P.deep, P.ink, 0.1);
    tickedBorder(px, 2, 2, w - 4, h - 4, random, EDGE_FAINT);
  },
  /** Title plate: a dark rectangle with one quiet outline. */
  tab(px, w, h) {
    px.rect(0, 0, w, h, P.ink);
    px.outlineRect(0, 0, w, h, EDGE_SOFT);
  },
};

const frames = new WeakMap();
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) paint(entry.target);
});

function paint(element) {
  const frame = frames.get(element);
  if (!frame) return;
  // Re-rendered lists drop old elements; stop watching them.
  if (!element.isConnected && element.dataset.framePainted) {
    observer.unobserve(element);
    return;
  }
  const { canvas, kind, seed } = frame;
  const variant = element.dataset.variant;
  const width = Math.max(1, Math.round(element.clientWidth / PIXEL));
  const height = Math.max(1, Math.round(element.clientHeight / PIXEL));
  if (width < 4 || height < 4) return;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  const pixels = new Pixels(ctx, width, height);
  PAINTERS[kind](pixels, width, height, rng(seed + width * 31 + height * 17), variant);
  pixels.flush();
  element.dataset.framePainted = "1";
}

/** Give an element a pixel frame of the given kind ("ornate", "picture", "box", "well", "tab", "plaque"). */
export function frame(element, kind, seed = 7) {
  if (frames.has(element)) {
    frames.get(element).kind = kind;
    paint(element);
    return element;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "frame-art";
  canvas.setAttribute("aria-hidden", "true");
  element.prepend(canvas);
  element.classList.add("framed");
  frames.set(element, { canvas, kind, seed });
  observer.observe(element);
  paint(element);
  return element;
}

/** Repaint a frame now, e.g. after its `data-variant` changed. */
export function repaint(element) {
  paint(element);
}

/** Frame every element matching `[data-frame]` inside `root`. */
export function frameAll(root = document) {
  root.querySelectorAll("[data-frame]").forEach((element, index) => frame(element, element.dataset.frame, 11 + index * 97));
}

/** Replace an element's content while keeping its painted frame. */
export function setContent(element, ...nodes) {
  const art = element.querySelector(":scope > .frame-art");
  element.replaceChildren(...(art ? [art] : []), ...nodes);
}
