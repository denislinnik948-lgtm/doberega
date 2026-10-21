import { FISH_LOOKS } from "../../src/fishing/sprites.js";

/**
 * A card portrait of a fish, drawn from the same looks as the game's sprites
 * but at about twice their size: the same bands, fins and markings, shaded in
 * four tones with a soft roundness, chunky dithering and a dark outline.
 * Returns a grid of palette indices (or -1 for empty) and where the mouth is.
 */

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

const INK = 0;
const BONE = 3;

function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A game colour as a card tone from 0 (ink) to 3 (bone), by its brightness. */
function tone(hex, lift = 0) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
  return Math.max(0, Math.min(3, ((lum - 0.1) / 0.75) * 3 + lift));
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function cardFish(species, { width = 90, height = 78 } = {}) {
  const look = FISH_LOOKS[species];
  // Slender fish get more length, deep ones less, so every portrait fills the frame.
  const length = Math.max(62, Math.min(look.whiskers ? 72 : 84, 70 * ((0.4 * look.len) / look.h) ** 0.3));
  const k = length / look.len;
  const L = length;
  // Very slender fish are filled out a little so they still read at card size.
  const H = Math.max(look.h * k, L * 0.24);
  const values = new Float32Array(width * height).fill(NaN);
  const fixed = new Int8Array(width * height).fill(-1);
  const extra = look.whiskers ? 12 : 0;
  const x0 = Math.round((width - L - extra) / 2);
  const y0 = Math.round(height / 2 + 2);
  const tailLen = Math.round(L * 0.17);
  const stem = look.stem ?? 0.32;

  const put = (x, y, value) => {
    x = Math.round(x0 + x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < width && y < height) values[y * width + x] = value;
  };
  // Pixels with a fixed tone (eye, mouth, lines) that dithering must not touch.
  const mark = (x, y, index) => {
    x = Math.round(x0 + x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < width && y < height) {
      fixed[y * width + x] = index;
      if (Number.isNaN(values[y * width + x])) values[y * width + x] = 0;
    }
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
    const lift = look.hump && u > 0.4 && u < 0.75 ? Math.sin(((u - 0.4) / 0.35) * Math.PI) * 1.2 * k * 0.8 : 0;
    const top = y0 - half * (look.flat ? 0.9 : 1.08) - lift;
    return { u, top, bottom: y0 + half * (look.flat ? 1.05 : 0.92) };
  };
  const xAt = (u) => tailLen + u * (L - tailLen);

  // A fin rising from the back (side -1) or hanging from the belly (side 1), with rays.
  const fin = ([from, to, size, kind], side, color, dots, spot) => {
    const base = tone(color, 0.6);
    const scaled = size * k * 0.85;
    const start = Math.ceil(xAt(from));
    for (let x = start; x <= Math.floor(xAt(to)); x += 1) {
      const t = (x - xAt(from)) / Math.max(1, xAt(to) - xAt(from));
      let h;
      if (kind === "long") h = t > 0.82 ? scaled : scaled * 0.55 + (t > 0.7 ? (t - 0.7) * 3 * scaled * 0.4 : 0);
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
        let v = base + 0.4 * (1 - j / h) - (ray ? (kind === "spiny" ? 1.8 : 0.6) : 0);
        if (dots && (x + j) % 3 === 0) v = tone(dots);
        if (spot && kind === "spiny" && t < 0.3 && j < h * 0.8) v = tone(spot);
        put(x + lean, edge + side * j, v);
      }
    }
  };

  // A fin fanning out from a point between two angles.
  const fan = (bx, by, a0, a1, len, color) => {
    const base = tone(color, 0.2);
    for (let y = Math.floor(by - len); y <= by + len; y += 1) {
      for (let x = Math.floor(bx - len); x <= bx + len; x += 1) {
        const a = Math.atan2(y - by, x - bx);
        if (a < a0 || a > a1) continue;
        const s = (a - a0) / (a1 - a0);
        const r = Math.hypot(x - bx, y - by);
        if (r > len * (0.25 + 0.75 * Math.sin(Math.PI * s) ** 0.7)) continue;
        put(x, y, base - ((s * 5) % 1 < 0.25 ? 0.7 : 0) - (r / len) * 0.3);
      }
    }
  };

  // Behind the body: dorsal and anal fins, the pelvic fin and the tail.
  look.dorsal.forEach((spec) => fin(spec, -1, look.fin, look.finDots, look.finSpot));
  if (look.anal) fin(look.anal, 1, look.lowFin, look.finDots);
  fin([look.whiskers ? 0.62 : 0.5, look.whiskers ? 0.68 : 0.58, look.h > 14 ? 3 : 2.4], 1, look.lowFin);

  const tailTone = tone(look.tailFin, 0.2);
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
      const angle = Math.atan2(dy, tailLen - x + 3);
      const ray = ((angle + 3) * 7) % 1 < 0.25;
      put(x, y0 + dy, tailTone - (ray ? 0.6 : 0) - v * 0.3);
    }
  }

  // The body, in the game's three bands, rounded off toward the edges.
  const back = tone(look.back);
  const side = tone(look.side);
  const belly = tone(look.belly);
  const barWidth = ((L - tailLen) * 0.62) / Math.max(1, (look.bars ?? 1) * 2);
  for (let x = tailLen; x < L; x += 1) {
    const { u, top, bottom } = edges(x);
    for (let y = Math.ceil(top); y <= Math.floor(bottom); y += 1) {
      const t = (y - top) / Math.max(1, bottom - top);
      let v = back + (side - back) * smooth(0.22, 0.38, t) + (belly - side) * smooth(0.64, 0.8, t);
      // Roundness: darker at the very edges, a soft lit streak along the upper flank.
      v -= (1 - Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))) * 0.55;
      if (t > 0.34 && t < 0.46 && u > 0.2 && u < 0.78) v += 0.35;
      if (look.pattern === "bars" && t < 0.74 && u > 0.1 && u < 0.76) {
        const phase = (x - xAt(0.1) + (t - 0.5) * 2) / barWidth;
        if (Math.floor(phase) % 2 === 0 && phase < (look.bars ?? 6) * 2) v = Math.min(v, tone(look.barColor, t < 0.32 ? -0.3 : 0));
      }
      if (look.pattern === "scales" && t > 0.2 && t < 0.82 && u < 0.76) {
        const row = Math.floor((y - top) / 3);
        const r = (y - Math.floor(top)) % 3;
        const c = (x + (row % 2) * 2) % 4;
        if ((r === 2 && (c === 1 || c === 2)) || (r === 1 && (c === 0 || c === 3))) v -= 0.55;
      }
      if (look.pattern === "spots" && t > 0.18 && t < 0.82 && u < 0.76) {
        const row = Math.floor((y - top) / 3.5);
        const cx = (x + row * 3) % 7;
        if (cx >= 2 && cx <= 4 && (y - Math.floor(top)) % 3.5 < 2) v = tone(look.spotColor);
      }
      if (look.pattern === "speckle" && t < 0.75 && hash(x, y, 21) < 0.22) v -= 0.8;
      if (look.pattern === "mottle" && t < 0.78) {
        const blotch = hash(x >> 2, y >> 2, 4) * 0.6 + hash(x >> 1, y >> 1, 5) * 0.4;
        if (blotch < 0.32) v -= 0.8;
        else if (blotch > 0.8) v += 0.4;
      }
      put(x, y, v);
    }
  }

  // Gill cover: a dark arc with a lit rim behind it.
  const gillU = 0.8;
  const gill = edges(xAt(gillU));
  for (let y = Math.ceil(gill.top) + 2; y <= Math.floor(gill.bottom) - 1; y += 1) {
    const s = ((y - gill.top) / (gill.bottom - gill.top)) * 2 - 1;
    const gx = xAt(gillU) - 2.5 * k * 0.4 * (1 - s * s);
    mark(gx, y, INK);
    if (s < 0.2) put(gx - 1, y, side + 0.7);
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
      if (d > er - 0.9 || d < er * 0.45) mark(ex + dx, ey + dy, INK);
      else put(ex + dx, ey + dy, Math.max(1.6, tone(look.eye)));
    }
  }
  mark(ex - 1, ey - 1, BONE);

  const head = edges(L - 1);
  const mouthY = look.mouthUp ? Math.round(head.top + 1) : Math.round(y0 + (look.broadHead ? 2 : 1));
  const mouthLen = look.snout === "bill" ? 9 : look.broadHead ? 6 : 3;
  for (let j = 0; j < mouthLen; j += 1) mark(L - 1 - j, mouthY + (look.mouthUp ? j * 0.4 : j * 0.15), INK);
  if (look.barbels) {
    for (let j = 1; j <= 3; j += 1) put(L - 1 + j * 0.4, mouthY + j, side - 0.4);
    if (look.barbels > 1) for (let j = 1; j <= 2; j += 1) put(L - 3 + j * 0.3, mouthY + 1 + j, side - 0.4);
  }
  if (look.whiskers) {
    for (let j = 1; j <= 13; j += 1) {
      put(L - 1 + j, mouthY + j * 0.45 + Math.sin(j * 0.4) * 0.8, 2);
      put(L - 3 + j * 0.45, mouthY + 3 + j * 0.45, 1.6);
    }
  }

  // Dither the tones, then outline everything.
  const grid = new Int8Array(width * height).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (Number.isNaN(values[i])) continue;
      if (fixed[i] >= 0) {
        grid[i] = fixed[i];
        continue;
      }
      const v = Math.max(0, Math.min(3, values[i]));
      const b = Math.floor(v);
      grid[i] = b >= 3 ? 3 : b + (v - b > BAYER[y & 3][x & 3] ? 1 : 0);
    }
  }
  const outline = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y * width + x] >= 0) continue;
      const filled = (dx, dy) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < width && ny < height && grid[ny * width + nx] >= 0;
      };
      if (filled(-1, 0) || filled(1, 0) || filled(0, -1) || filled(0, 1)) outline.push(y * width + x);
    }
  }
  for (const i of outline) grid[i] = INK;

  return { grid, width, height, mouth: { x: x0 + L - 2, y: mouthY } };
}
