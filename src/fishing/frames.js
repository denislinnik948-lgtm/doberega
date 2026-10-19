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

class Pixels {
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
  }

  set(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x | 0, y | 0, 1, 1);
  }

  rect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
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

/** A thorny, slightly broken bone line with knots and spikes. */
function thornyBorder(px, x, y, w, h, random) {
  px.outlineRect(x, y, w, h, P.bone);
  let next = 3;
  let index = 0;
  alongEdges(x, y, w, h, (ex, ey, ox, oy) => {
    index += 1;
    if (index < next) return;
    next = index + 3 + Math.floor(random() * 6);
    const roll = random();
    if (roll < 0.35) {
      // Spike sticking out (or occasionally in).
      const dir = random() < 0.75 ? 1 : -1;
      const len = 1 + Math.floor(random() * 2);
      for (let k = 1; k <= len; k += 1) px.set(ex + ox * k * dir, ey + oy * k * dir, P.bone);
    } else if (roll < 0.6) {
      // Knot: a little bump on both sides of the line.
      px.set(ex + ox, ey + oy, P.bone);
      px.set(ex - ox, ey - oy, P.bone);
      px.set(ex + oy, ey + ox, P.light);
    } else if (roll < 0.72) {
      // Small gap in the line.
      px.set(ex, ey, P.light);
    } else if (roll < 0.86) {
      px.set(ex + ox, ey + oy, P.light);
    }
  });
}

/** Tangled branches growing out of a corner. */
function cornerTangle(px, cx, cy, dx, dy, size, random) {
  for (let branch = 0; branch < 9; branch += 1) {
    let x = cx;
    let y = cy;
    const alongX = random() < 0.5;
    const steps = Math.round(size * (0.5 + random() * 0.7));
    for (let s = 0; s < steps; s += 1) {
      const r = random();
      if (alongX) {
        x += dx * (r < 0.7 ? 1 : 0);
        y += dy * (r > 0.55 ? (random() < 0.5 ? 1 : -1) : 0);
      } else {
        y += dy * (r < 0.7 ? 1 : 0);
        x += dx * (r > 0.55 ? (random() < 0.5 ? 1 : -1) : 0);
      }
      px.set(x, y, s % 5 === 4 ? P.light : P.bone);
      if (random() < 0.18) px.set(x + (alongX ? 0 : dx), y + (alongX ? dy : 0), P.bone);
    }
  }
  // A dense knot right at the corner.
  for (let k = 0; k < size * 2; k += 1) {
    const x = cx + Math.round((random() - 0.3) * 5) * dx;
    const y = cy + Math.round((random() - 0.3) * 5) * dy;
    px.set(x, y, random() < 0.7 ? P.bone : P.light);
  }
}

/** Short ticks on a thin line, with tiny boxes at the corners (the caption box). */
function tickedBorder(px, x, y, w, h, random, color = P.bone) {
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
  const horizon = Math.round(h * (kind === "pit" ? 0.42 : 0.52));
  const unit = h / 100;

  // Sky: dark overhead, warm and light toward the horizon, dithered.
  px.dither(x0, m, x1, horizon, P.dark, P.soft, -0.1);
  const sx = Math.round(w * (kind === "river" ? 0.62 : 0.34));
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
    ridge(px, x0, x1, horizon, 5 * unit, 1, P.deep, horizon + 1);
    // Willow on the far bank.
    const wx = Math.round(w * 0.72);
    for (let k = 0; k < 30 * unit; k += 1) px.set(wx + Math.round(Math.sin(k * 0.2)), horizon - k, P.ink);
    for (let a = 0; a < 260; a += 1) {
      const angle = random() * Math.PI;
      const r = random() * 16 * unit;
      const x = wx + Math.round(Math.cos(angle) * r * 1.4);
      const y = horizon - Math.round(26 * unit) + Math.round(Math.sin(angle) * r * 0.5) + Math.round(random() * 14 * unit);
      if (y < horizon) px.set(x, y, P.ink);
    }
    // Reeds and cattails crowding the near corners.
    for (let i = 0; i < w / 3; i += 1) {
      const side = random() < 0.5;
      const x = side ? x0 + Math.floor(random() * w * 0.28) : x1 - 1 - Math.floor(random() * w * 0.28);
      const tall = Math.round((12 + random() * 30) * unit);
      const lean = (random() - 0.5) * 0.3;
      for (let k = 0; k < tall; k += 1) px.set(x + Math.round(k * lean), h - m - 1 - k, P.ink);
      if (random() < 0.35) px.rect(x + Math.round(tall * lean) - 1, h - m - tall - 3, 2, 4, P.goldDark);
    }
    // Lily pads.
    for (let i = 0; i < 5; i += 1) {
      const cx = Math.round(w * (0.35 + random() * 0.3));
      const cy = Math.round(horizon + (h - horizon) * (0.4 + random() * 0.45));
      const r = Math.round((3 + random() * 3) * unit);
      for (let x = -r; x <= r; x += 1) px.rect(cx + x, cy, 1, 1 + Math.round((1 - Math.abs(x) / r) * r * 0.3), P.mid);
    }
  } else if (kind === "lake") {
    ridge(px, x0, x1, horizon, 16 * unit, 2.2, P.dark, horizon + 1);
    for (let x = x0 + 2; x < x1; x += 2 + Math.floor(random() * 4)) pine(px, x, horizon + 1, Math.round((8 + random() * 14) * unit), P.ink);
    px.rect(x0, horizon, w - 2 * m, 1, P.ink);
  } else if (kind === "river") {
    ridge(px, x0, x1, horizon, 9 * unit, 4, P.dark, horizon + 1);
    for (let x = x0 + 4; x < x1; x += 5 + Math.floor(random() * 8)) pine(px, x, horizon + 1, Math.round((5 + random() * 7) * unit), P.deep);
    // Banks converging to the horizon, with streaks of current between them.
    for (let y = horizon; y < h - m; y += 1) {
      const t = (y - horizon) / (h - m - horizon);
      const left = Math.round(x0 + (w * 0.4) * (1 - t) + 2 - t * 4);
      const right = Math.round(x1 - (w * 0.4) * (1 - t) - 2 + t * 4);
      px.rect(x0, y, Math.max(0, left - x0), 1, P.ink);
      px.rect(right, y, Math.max(0, x1 - right), 1, P.ink);
      if (y % 2 === 0 && right - left > 8) px.rect(left + 2 + Math.floor(random() * (right - left - 8)), y, 2 + Math.floor(t * 6), 1, P.soft);
    }
    for (let i = 0; i < 14; i += 1) {
      const y = horizon + Math.floor(random() * (h - horizon - m));
      px.rect(x0 + Math.floor(random() * 10 * unit), y, 2, 1, P.mid);
    }
  } else if (kind === "reservoir") {
    ridge(px, x0, x1, horizon, 26 * unit, 0.5, P.dark, horizon + 1);
    ridge(px, x0, x1, horizon, 13 * unit, 3, P.deep, horizon + 1);
    // Dam wall with spillway gates.
    const damX = Math.round(w * 0.55);
    const damW = Math.round(w * 0.38);
    const damH = Math.round(7 * unit);
    px.rect(damX, horizon - damH, damW, damH + 1, P.soft);
    px.rect(damX, horizon - damH, damW, 1, P.bone);
    for (let x = damX + 3; x < damX + damW - 2; x += Math.max(4, Math.round(5 * unit))) px.rect(x, horizon - damH + 2, 2, damH - 2, P.ink);
    // Pylons on the far ridge.
    for (const px0 of [0.15, 0.32]) {
      const x = Math.round(w * px0);
      const top = horizon - Math.round(30 * unit);
      for (let y = top; y < horizon - 10 * unit; y += 1) px.set(x, y, P.ink);
      px.rect(x - 3, top + 2, 7, 1, P.ink);
    }
  } else if (kind === "pit") {
    // Steep banks closing in on both sides.
    for (let y = m; y < h - m; y += 1) {
      const t = (y - m) / (h - 2 * m);
      const left = Math.round(w * (0.18 + 0.1 * Math.sin(t * 5)) * (1 - t * 0.3) + random() * 2);
      const right = Math.round(w * (0.2 + 0.08 * Math.cos(t * 4)) * (1 - t * 0.3) + random() * 2);
      px.rect(x0, y, left, 1, P.ink);
      px.rect(x1 - right, y, right, 1, P.ink);
    }
    // A dead snag leaning over the water.
    let x = x0 + Math.round(w * 0.18);
    let y = Math.round(h * 0.55);
    for (let k = 0; k < w * 0.3; k += 1) {
      px.rect(x, y, 2, 2, P.deep);
      if (k % 9 === 4) for (let b = 1; b < 6 * unit; b += 1) px.set(x + b, y - b, P.deep);
      x += 1;
      y -= random() < 0.35 ? 1 : 0;
    }
    // Whirlpool.
    const cx = Math.round(w * 0.55);
    const cy = Math.round(horizon + (h - horizon) * 0.55);
    for (let a = 0; a < 220; a += 1) {
      const angle = a * 0.22;
      const r = a * 0.09 * unit;
      px.set(cx + Math.round(Math.cos(angle) * r * 1.9), cy + Math.round(Math.sin(angle) * r * 0.6), a % 4 ? P.mid : P.light);
    }
  }
  thornyBorder(px, m, m, w - 2 * m, h - 2 * m, random);
}

const PAINTERS = {
  location(px, w, h, random, variant) {
    landscape(px, w, h, random, variant);
  },
  /** Big dialog windows: dithered dark fill, thorny frame, tangled corners. */
  ornate(px, w, h, random) {
    const m = 5;
    px.dither(m, m, w - m, h - m, P.dark, P.deep, -0.15);
    thornyBorder(px, m, m, w - 2 * m, h - 2 * m, random);
    const size = Math.min(16, Math.floor(Math.min(w, h) / 6));
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
    tickedBorder(px, 2, 2, w - 4, h - 4, random, P.soft);
  },
  /** Title tab: double outline with a notch below, like a speech bubble. */
  tab(px, w, h) {
    const notch = 4;
    const bodyH = h - notch;
    px.rect(0, 0, w, bodyH, P.bone);
    px.rect(1, 1, w - 2, bodyH - 2, P.ink);
    px.outlineRect(3, 3, w - 6, bodyH - 6, P.light);
    const cx = Math.floor(w / 2);
    for (let k = 0; k < notch + 1; k += 1) {
      const half = notch - k;
      px.rect(cx - half - 1, bodyH - 1 + k, half * 2 + 2, 1, P.bone);
      if (half > 0) px.rect(cx - half, bodyH - 1 + k, half * 2, 1, P.ink);
    }
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
  PAINTERS[kind](new Pixels(ctx, width, height), width, height, rng(seed + width * 31 + height * 17), variant);
  element.dataset.framePainted = "1";
}

/** Give an element a pixel frame of the given kind ("ornate", "picture", "box", "well", "tab"). */
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
