export function hash01(value) {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function hash2(x, y, seed = 0) {
  return hash01(Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041));
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [0, 1]. */
export function valueNoise(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function parseHex(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mix two #rrggbb colors and optionally darken the result. */
export function mixColor(a, b, amount, brightness = 1) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const channel = (i) => Math.round(clamp((ca[i] + (cb[i] - ca[i]) * amount) * brightness, 0, 255));
  return `#${((1 << 24) | (channel(0) << 16) | (channel(1) << 8) | channel(2)).toString(16).slice(1)}`;
}

/** Pack #rrggbb into a 0xRRGGBB integer for glyph batches. */
export const hexToInt = (hex) => parseInt(hex.slice(1), 16);
