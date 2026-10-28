import { clamp, hash2, hexToInt, mixColor, smoothstep, valueNoise } from "./noise.js";
import { skylineY } from "./landscape-engine.js";

const CLOUD_RAMP = ".,-~=+*";
// Shaded → lit cloud ramp; recoloured through the day by setCloudColors.
const CLOUD_COLORS = Array.from({ length: 7 }, (_, i) => hexToInt(mixColor("#4d5a66", "#e6bd8e", i / 6)));

// Extra cloud cover (0..1), raised while it rains.
let cloudiness = 0;
export function setCloudiness(value) {
  cloudiness = value;
}

export function setCloudColors(shade, lit) {
  for (let i = 0; i < CLOUD_COLORS.length; i += 1) {
    const k = i / (CLOUD_COLORS.length - 1);
    CLOUD_COLORS[i] = (Math.round(shade[0] + (lit[0] - shade[0]) * k) << 16)
      | (Math.round(shade[1] + (lit[1] - shade[1]) * k) << 8)
      | Math.round(shade[2] + (lit[2] - shade[2]) * k);
  }
}

/** Clouds glow warmer toward wherever the sun (or moon) currently is. */
export function lightSky(cells, width, height, light) {
  const lx = light.x * width;
  const ly = light.y * height;
  const strength = light.strength;
  for (const cell of cells) {
    cell.warmth = strength * clamp(1 - Math.hypot((cell.x - lx) / (width * 0.5), (cell.y - ly) / (height * 0.3)), 0, 1);
  }
}
const STAR_COLOR = hexToInt("#aebcc3");
const SUN_GLYPHS = [
  { limit: 0.42, glyph: "@", color: hexToInt("#fff2cc") },
  { limit: 0.74, glyph: "#", color: hexToInt("#f9dca0") },
  { limit: 1, glyph: "o", color: hexToInt("#eeb877") },
];
// The unlit part of the moon, barely there against the night sky.
const DARK_MOON = hexToInt("#3b474c");
const MOON_GLYPHS = [
  { limit: 0.5, glyph: "O", color: hexToInt("#e6eadc") },
  { limit: 1, glyph: "o", color: hexToInt("#b8c4c4") },
];

/** Grid offsets that make up a disc of the given radius, with their glyph tier. */
export function discOffsets(radius, cellWidth, lineHeight) {
  const offsets = [];
  const cols = Math.ceil(radius / cellWidth);
  const rows = Math.ceil(radius / lineHeight);
  for (let r = -rows; r <= rows; r += 1) {
    for (let c = -cols; c <= cols; c += 1) {
      const d = Math.hypot(c * cellWidth, r * lineHeight * 1.08) / radius;
      if (d < 1) offsets.push({ dx: c * cellWidth, dy: r * lineHeight, d });
    }
  }
  offsets.radius = radius;
  return offsets;
}

/**
 * Push the sun or moon as ASCII glyphs, snapped to the character grid. The
 * moon shows its phase (`moon` from moonAt): the lit part grows from the
 * right while it waxes and shrinks to the left as it wanes; the dark part is
 * a faint ghost of the disc.
 */
export function pushDisc(batch, offsets, x, y, cellWidth, lineHeight, kind, moon = null) {
  const tiers = kind === "moon" ? MOON_GLYPHS : SUN_GLYPHS;
  const cx = (Math.round(x / cellWidth - 0.5) + 0.5) * cellWidth;
  const cy = (Math.round(y / lineHeight - 0.5) + 0.5) * lineHeight;
  const radius = offsets.radius ?? 1;
  const turn = moon ? Math.cos(2 * Math.PI * moon.phase) : -1;
  for (const { dx, dy, d } of offsets) {
    if (moon) {
      const v = (dy * 1.08) / radius;
      const terminator = Math.sqrt(Math.max(0, 1 - v * v)) * turn;
      const u = dx / radius;
      if (moon.waxing ? u < terminator : u > -terminator) {
        batch.push(cx + dx, cy + dy, ".", DARK_MOON);
        continue;
      }
    }
    // A few darker "craters" on the moon.
    const tier = tiers.find((entry) => d < entry.limit);
    const crater = kind === "moon" && ((dx * 7 + dy * 13) & 15) < 2 && d < 0.8;
    batch.push(cx + dx, cy + dy, crater ? "." : tier.glyph, crater ? 0x8a9898 : tier.color);
  }
}

/** Every sky cell that can be seen above the farthest ridge, with stable per-cell noise. */
export function createSkyCells(width, height, cellWidth, lineHeight) {
  const columns = Math.ceil(width / cellWidth);
  const cells = [];

  for (let column = 0; column < columns; column += 1) {
    const x = (column + 0.5) * cellWidth;
    const limit = skylineY(x, height) + lineHeight;
    for (let row = 0; (row + 0.5) * lineHeight < limit; row += 1) {
      const y = (row + 0.5) * lineHeight;
      cells.push({
        x,
        y,
        yN: y / height,
        noise: hash2(column, row, 3),
        warmth: 0,
      });
    }
  }

  return cells;
}

/**
 * Fill a glyph batch with this frame's clouds and stars. Clouds are slow,
 * horizontally stretched value-noise banks that drift with the breeze.
 */
export function sampleSky(cells, time, batch, starBatch) {
  batch.clear();
  starBatch.clear();
  const drift = time * 6;

  for (const cell of cells) {
    const mask = smoothstep(0.04, 0.13, cell.yN) * (1 - smoothstep(0.27, 0.36, cell.yN));
    let cloud = 0;
    if (mask > 0 || cloudiness > 0.02) {
      const nx = (cell.x + drift) / 230;
      const ny = cell.y / 48;
      const n = valueNoise(nx, ny, 11) * 0.56
        + valueNoise(nx * 2.3 + time * 0.012, ny * 2.1, 23) * 0.3
        + valueNoise(nx * 5.1, ny * 4.7 - time * 0.02, 37) * 0.14;
      cloud = (n - 0.5 + cloudiness * 0.22) * 3.1 * (mask + cloudiness * 0.6 * (1 - mask));
    }

    if (cloud > 0.06) {
      const glyph = CLOUD_RAMP[Math.min(CLOUD_RAMP.length - 1, Math.floor(cloud * CLOUD_RAMP.length))];
      const tone = clamp(cell.warmth * 0.75 + cell.yN * 1.4 - cloud * 0.25, 0, 0.999);
      batch.push(cell.x, cell.y, glyph, CLOUD_COLORS[Math.floor(tone * CLOUD_COLORS.length)]);
    } else if (cell.yN < 0.3 && cell.noise < 0.014) {
      const twinkle = 0.5 + 0.5 * Math.sin(time * (0.8 + cell.noise * 160) + cell.noise * 977);
      if (twinkle > 0.3 - cell.yN) starBatch.push(cell.x, cell.y, twinkle > 0.86 ? "+" : ".", STAR_COLOR);
    }
  }
}

/** A loose V of distant birds crosses the sky every forty seconds or so. */
export function birdsAt(time, width, height) {
  const period = 41;
  const flight = Math.floor(time / period);
  const progress = (time - flight * period) / 30;
  if (progress > 1) return [];

  const direction = flight % 2 === 0 ? 1 : -1;
  const count = 3 + (flight % 3);
  const leadX = direction > 0 ? -0.08 * width + progress * width * 1.16 : width * 1.08 - progress * width * 1.16;
  const leadY = height * (0.13 + hash2(flight, 1, 5) * 0.11) + Math.sin(progress * 5.5) * height * 0.012;
  const birds = [];
  for (let i = 0; i < count; i += 1) {
    const rank = Math.ceil(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const flap = Math.sin(time * 6.5 + i * 1.7);
    birds.push({
      x: leadX - direction * rank * 15,
      y: leadY + side * rank * 8 + Math.sin(time * 0.9 + i) * 2,
      glyph: flap > 0.2 ? "v" : flap < -0.5 ? "^" : "-",
    });
  }
  return birds;
}
