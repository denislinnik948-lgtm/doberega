import { P } from "./palette.js";

/**
 * A detailed fish portrait in the game's colours, drawn the same way as the
 * social cards (tools/cards): about twice the size of a plain sprite, with a
 * rounded body that darkens toward its edges, a lit streak along the flank,
 * rayed fins, a ringed eye with a glint and a dark outline. Light and shade
 * step through a few levels with ordered dithering, so it stays pixel art.
 *
 * `look` is one of the FISH_LOOKS in sprites.js. Returns the cropped grid:
 * `{ width, height, cells }`, each cell a #rrggbb colour or null.
 */

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

// Light levels a colour can be shaded to; values in between are dithered.
const LEVELS = [0.58, 0.76, 0.92, 1.06, 1.2];
const GLINT = "#f4f0e0";

function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const channels = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => `#${((1 << 24) | rgb.map((c) => Math.max(0, Math.min(255, Math.round(c)))).reduce((n, c) => (n << 8) | c, 0)).toString(16).slice(1)}`;
const shade = (hex, amount) => toHex(channels(hex).map((c) => c * amount));
const mix = (a, b, t) => {
  const ca = channels(a);
  const cb = channels(b);
  return toHex(ca.map((c, i) => c + (cb[i] - c) * t));
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function fishPortrait(look, { length = 70 } = {}) {
  // Slender fish get more length, deep ones less, so every portrait reads at a similar size.
  const L = Math.max(62, Math.min(look.whiskers ? 72 : 84, length * ((0.4 * look.len) / look.h) ** 0.3));
  const k = L / look.len;
  // Very slender fish are filled out a little so they still read.
  const H = Math.max(look.h * k, L * 0.24);
  const extra = look.whiskers ? 14 : 2;
  const width = Math.ceil(L + extra + 12);
  const height = Math.ceil(H * 1.5 + 40);
  const base = new Array(width * height).fill(null);
  const light = new Float32Array(width * height);
  const fixed = new Array(width * height).fill(null);
  const x0 = 6;
  const y0 = Math.round(height / 2);
  const tailLen = Math.round(L * 0.17);
  const stem = look.stem ?? 0.32;

  const put = (x, y, color, value) => {
    x = Math.round(x0 + x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    base[y * width + x] = color;
    light[y * width + x] = value;
    fixed[y * width + x] = null;
  };
  // Pixels with an exact colour (eye, mouth, lines) that shading must not touch.
  const mark = (x, y, color) => {
    x = Math.round(x0 + x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    fixed[y * width + x] = color;
    base[y * width + x] ??= color;
  };

  const profile = (u) => {
    const s = u < look.peak ? 0.5 * (u / look.peak) : 0.5 + 0.5 * ((u - look.peak) / (1 - look.peak));
    let p = stem + (1 - stem) * Math.sin(Math.PI * Math.min(0.97, s)) ** 0.8;
    if (u > 0.78) p *= 1 - (u - 0.78) * (look.head ?? 1.2);
    if (look.snout === "bill" && u > 0.74) p = Math.min(p, 0.62 - (u - 0.74) * 1.3);
    if (look.snout === "point" && u > 0.78) p *= 1 - (u - 0.78) * 0.9;
    if (look.broadHead && u > 0.7) p = Math.max(p, 0.8 - (u - 0.7) * 1.1);
    return Math.max(0.12, p);
  };
  const edges = (x) => {
    const u = (x - tailLen) / (L - tailLen);
    const half = (H / 2) * profile(u);
    const lift = look.hump && u > 0.4 && u < 0.75 ? Math.sin(((u - 0.4) / 0.35) * Math.PI) * k : 0;
    const top = y0 - half * (look.flat ? 0.9 : 1.08) - lift;
    return { u, top, bottom: y0 + half * (look.flat ? 1.05 : 0.92) };
  };
  const xAt = (u) => tailLen + u * (L - tailLen);

  // A fin rising from the back (side -1) or hanging from the belly (side 1), with rays.
  const fin = ([from, to, size, kind], side, color, dots) => {
    const scaled = size * k * 0.85;
    const start = Math.ceil(xAt(from));
    for (let x = start; x <= Math.floor(xAt(to)); x += 1) {
      const t = (x - xAt(from)) / Math.max(1, xAt(to) - xAt(from));
      let h;
      if (kind === "long") h = t > 0.82 ? scaled : scaled * 0.55 + (t > 0.7 ? (t - 0.7) * 1.2 * scaled : 0);
      else if (kind === "round") h = scaled * Math.sin(Math.PI * (0.15 + t * 0.7));
      else h = scaled * (0.35 + 0.65 * t);
      const ray = (x - start) % 2 === 0;
      // Spiny fins dip between the spines.
      if (kind === "spiny" && !ray) h *= 0.72;
      h = Math.max(1, Math.round(h));
      const { top, bottom } = edges(x);
      const edge = side < 0 ? Math.ceil(top) : Math.floor(bottom);
      for (let j = 1; j <= h; j += 1) {
        const lean = side < 0 ? -j * 0.3 : -j * 0.35;
        let c = color;
        if (dots && (x + j) % 3 === 0) c = dots;
        // A dark blotch at the rear of a spiny dorsal (perch).
        if (look.finSpot && kind === "spiny" && t < 0.3 && j < h * 0.8) c = look.finSpot;
        if (look.finEdge && j === h) c = look.finEdge;
        put(x + lean, edge + side * j, c, 0.98 + 0.16 * (1 - j / h) - (ray ? (kind === "spiny" ? 0.4 : 0.2) : 0));
      }
    }
  };

  // A fin fanning out from a point between two angles.
  const fan = (bx, by, a0, a1, len, color) => {
    for (let y = Math.floor(by - len); y <= by + len; y += 1) {
      for (let x = Math.floor(bx - len); x <= bx + len; x += 1) {
        const a = Math.atan2(y - by, x - bx);
        if (a < a0 || a > a1) continue;
        const s = (a - a0) / (a1 - a0);
        const r = Math.hypot(x - bx, y - by);
        if (r > len * (0.25 + 0.75 * Math.sin(Math.PI * s) ** 0.7)) continue;
        put(x, y, color, 1.05 - ((s * 5) % 1 < 0.25 ? 0.22 : 0) - (r / len) * 0.12);
      }
    }
  };

  // Behind the body: dorsal and anal fins, the pelvic fin and the tail.
  look.dorsal.forEach((spec) => fin(spec, -1, look.fin, look.finDots));
  if (look.anal) fin(look.anal, 1, look.lowFin, look.finDots);
  fin([look.whiskers ? 0.62 : 0.5, look.whiskers ? 0.68 : 0.58, look.h > 14 ? 3 : 2.4], 1, look.lowFin);

  for (let x = 0; x < tailLen; x += 1) {
    const v = (tailLen - x) / tailLen;
    const spread = look.tail === "round"
      ? 1 + H * 0.38 * (v < 0.5 ? v / 0.5 : Math.sqrt(Math.max(0, 1 - ((v - 0.5) / 0.55) ** 2)))
      : 1 + v * H * 0.55;
    for (let dy = -Math.ceil(spread); dy <= spread; dy += 1) {
      const a = Math.abs(dy);
      if (a > spread) continue;
      if (look.tail === "fork" && a < v * H * 0.26 && v > 0.4) continue;
      if (look.tail === "deep" && a < v * H * 0.3 && v > 0.35) continue;
      // Rays fan out from the tail root.
      const ray = ((Math.atan2(dy, tailLen - x + 3) + 3) * 7) % 1 < 0.25;
      const rim = look.finEdge && (x < 1 || a > spread - 1.2);
      put(x, y0 + dy, rim ? look.finEdge : look.tailFin, 1.04 - (ray ? 0.22 : 0) - v * 0.12);
    }
  }

  // The body: the game's back, flank and belly bands, rounded off toward the edges.
  const barWidth = ((L - tailLen) * 0.62) / Math.max(1, (look.bars ?? 1) * 2);
  for (let x = tailLen; x < L; x += 1) {
    const { u, top, bottom } = edges(x);
    for (let y = Math.ceil(top); y <= Math.floor(bottom); y += 1) {
      const t = (y - top) / Math.max(1, bottom - top);
      let color = mix(mix(look.back, look.side, smooth(0.22, 0.38, t)), look.belly, smooth(0.64, 0.8, t));
      // Roundness: darker at the very edges, a soft lit streak along the upper flank.
      let value = 1.1 - (1 - Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))) * 0.5;
      if (t > 0.34 && t < 0.46 && u > 0.2 && u < 0.78) value += 0.14;
      if (look.pattern === "bars" && t < 0.74 && u > 0.1 && u < 0.76) {
        const phase = (x - xAt(0.1) + (t - 0.5) * 2) / barWidth;
        if (Math.floor(phase) % 2 === 0 && phase < (look.bars ?? 6) * 2) color = t < 0.32 ? shade(look.barColor, 0.8) : look.barColor;
      }
      if (look.pattern === "scales" && t > 0.2 && t < 0.82 && u < 0.76) {
        const row = Math.floor((y - top) / 3);
        const r = (y - Math.floor(top)) % 3;
        const c = (x + (row % 2) * 2) % 4;
        if ((r === 2 && (c === 1 || c === 2)) || (r === 1 && (c === 0 || c === 3))) value -= 0.2;
      }
      if (look.pattern === "spots" && t > 0.18 && t < 0.82 && u < 0.76) {
        const row = Math.floor((y - top) / 3.5);
        const cx = (x + row * 3) % 7;
        if (cx >= 2 && cx <= 4 && (y - Math.floor(top)) % 3.5 < 2) color = look.spotColor;
      }
      if (look.pattern === "speckle" && t < 0.75 && hash(x, y, 21) < 0.22) value -= 0.32;
      if (look.pattern === "mottle" && t < 0.78) {
        const blotch = hash(x >> 2, y >> 2, 4) * 0.6 + hash(x >> 1, y >> 1, 5) * 0.4;
        if (blotch < 0.32) value -= 0.32;
        else if (blotch > 0.8) value += 0.15;
      }
      if (look.pattern === "clown") {
        // White bands behind the head, mid-body (bulging forward) and at the tail root, each edged in black.
        for (const [center, bulge] of [[0.84, 0], [0.5, 0.07], [0.06, 0]]) {
          const c = center + bulge * (1 - Math.abs(t - 0.5) * 2);
          const d = Math.abs(u - c);
          if (d < 0.05) color = "#f6f4ee";
          else if (d < 0.085) color = "#141414";
        }
      }
      put(x, y, color, value);
    }
  }

  // Gill cover: a dark arc with a lit rim behind it.
  const gill = edges(xAt(0.8));
  for (let y = Math.ceil(gill.top) + 2; y <= Math.floor(gill.bottom) - 1; y += 1) {
    const s = ((y - gill.top) / (gill.bottom - gill.top)) * 2 - 1;
    const gx = xAt(0.8) - k * (1 - s * s);
    mark(gx, y, shade(look.side, 0.5));
    if (s < 0.2) put(gx - 1, y, look.side, 1.2);
  }

  // Pectoral fin over the body, behind the gill.
  fan(xAt(0.79) + 1, y0 + 2, Math.PI * 0.68, Math.PI * 0.92, H * 0.3 + 3, look.lowFin);

  // Eye, mouth, barbels and whiskers.
  const eyeU = look.snout === "bill" ? 0.82 : look.broadHead ? 0.9 : 0.87;
  const eyeEdges = edges(xAt(eyeU));
  const ex = xAt(eyeU);
  const ey = eyeEdges.top + (eyeEdges.bottom - eyeEdges.top) * 0.3;
  const er = (look.bigEye ? 2.9 : 2.3) * Math.min(1.25, k / 2.2);
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > er) continue;
      mark(ex + dx, ey + dy, d > er - 0.9 || d < er * 0.45 ? P.ink : look.eye);
    }
  }
  mark(ex - 1, ey - 1, GLINT);

  const head = edges(L - 1);
  const mouthY = look.mouthUp ? Math.round(head.top + 1) : Math.round(y0 + (look.broadHead ? 2 : 1));
  const mouthLen = look.snout === "bill" ? 9 : look.broadHead ? 6 : 3;
  for (let j = 0; j < mouthLen; j += 1) mark(L - 1 - j, mouthY + (look.mouthUp ? j * 0.4 : j * 0.15), P.ink);
  if (look.barbels) {
    for (let j = 1; j <= 3; j += 1) mark(L - 1 + j * 0.4, mouthY + j, shade(look.side, 0.8));
    if (look.barbels > 1) for (let j = 1; j <= 2; j += 1) mark(L - 3 + j * 0.3, mouthY + 1 + j, shade(look.side, 0.8));
  }
  if (look.whiskers) {
    for (let j = 1; j <= 13; j += 1) {
      mark(L - 1 + j, mouthY + j * 0.45 + Math.sin(j * 0.4) * 0.8, "#8a8466");
      mark(L - 3 + j * 0.45, mouthY + 3 + j * 0.45, "#6e6a52");
    }
  }

  // Shade, dither, outline, then crop to the fish.
  const cells = new Array(width * height).fill(null);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (fixed[i]) {
        cells[i] = fixed[i];
        continue;
      }
      if (!base[i]) continue;
      const v = Math.max(LEVELS[0], Math.min(LEVELS[LEVELS.length - 1], light[i]));
      let level = 0;
      while (level < LEVELS.length - 2 && v > LEVELS[level + 1]) level += 1;
      const frac = (v - LEVELS[level]) / (LEVELS[level + 1] - LEVELS[level]);
      cells[i] = shade(base[i], LEVELS[level + (frac > BAYER[y & 3][x & 3] ? 1 : 0)]);
    }
  }
  const filled = (x, y) => x >= 0 && y >= 0 && x < width && y < height && cells[y * width + x];
  const outline = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!cells[y * width + x] && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) outline.push(y * width + x);
    }
  }
  for (const i of outline) cells[i] = P.ink;

  let [minX, minY, maxX, maxY] = [width, height, 0, 0];
  cells.forEach((color, i) => {
    if (!color) return;
    const x = i % width;
    const y = Math.floor(i / width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const cropped = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) cropped.push(cells[y * width + x]);
  return { width: maxX - minX + 1, height: maxY - minY + 1, cells: cropped };
}
