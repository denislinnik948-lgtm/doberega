import { fastSin, hash2 } from "./noise.js";
import { activeScene, bankWidths, nearBankY, shorelineY } from "./scene.js";
import { gradeInt } from "./theme.js";
import { inCrown } from "./forest-engine.js";

/**
 * Grass as single strokes: every blade is a "|" glyph turned to its own angle,
 * in its own shade of green, with dark ground showing between the blades.
 * Near blades are made of two or three segments that bend further toward the
 * tip, so gusts sweeping across the bank curl them. Flowers and dew sparkle
 * among the blades, and fireflies drift over the grass and the shore at night.
 *
 * Two fields: `far` (grassy river banks, drawn behind the bank trees) and
 * `near` (the bank we stand on at the bottom of the view, drawn over the water).
 */

// Blade tones by season, dark to light; in winter dry straw pokes up through the snow.
const PALETTES = {
  spring: [0x1a3a20, 0x285a30, 0x3a7a40, 0x56a052, 0x84c46c],
  summer: [0x183222, 0x234832, 0x316248, 0x427e5a, 0x5e9c72],
  autumn: [0x30301e, 0x444628, 0x5e5c30, 0x7a7238, 0x988a44],
  winter: [0x5e5a4a, 0x766e58, 0x8e866c, 0xb4b2a4, 0xdde3e4],
};
// How many flowers dot the grass: a meadow full of them in spring, none under snow.
const BLOOM = { spring: 2, summer: 1, autumn: 0.4, winter: 0 };
const FLOWERS = [0xd8662a, 0xe0a030, 0xc8442c];
const SPRING_FLOWERS = [0xf0eee0, 0xe8d050, 0xa88ad8, 0xe0a030];
const DEW = 0xe6f0ea;
const FIREFLY = 0xd8f080;
const FIREFLIES = 40;

// How far each segment of a one-, two- or three-part blade leans, as a share of the whole bend.
const SEGMENT_LEAN = [null, [1], [0.4, 1], [0.24, 0.59, 1]].map((shares) => shares && Float32Array.from(shares));

function field() {
  return { blades: [], sparkles: [] };
}

/**
 * Lay blades over every grassy patch of the scene. `inside(x, y)` says
 * whether a point is grass, `t(y)` how near it is (0 far .. 1 at the bottom).
 */
function sow(out, { top, bottom, left, right, inside, covered, nearness, cellWidth, lineHeight, seed, palette, flowers, lift = 0 }) {
  let row = 0;
  for (let y = top; y < bottom; row += 1) {
    const t = nearness(y);
    const dy = lineHeight * (0.26 + 0.38 * t);
    const dx = cellWidth * (0.55 + 0.85 * t);
    let column = 0;
    for (let x = left + hash2(row, 1, seed) * dx; x < right; x += dx, column += 1) {
      const noise = hash2(column, row, seed);
      // Gaps let the dark ground show through.
      if (noise < 0.2) continue;
      const jx = x + (hash2(column, row, seed + 1) - 0.5) * dx * 0.9;
      const jy = y + (hash2(column, row, seed + 2) - 0.5) * dy * 0.9;
      if (!inside(jx, jy) || covered(jx, jy)) continue;
      const roll = hash2(column, row, seed + 3);
      if (roll < 0.014 * flowers) {
        const colors = flowers > 1.5 ? SPRING_FLOWERS : FLOWERS;
        out.sparkles.push({ x: jx, y: jy, kind: "flower", color: gradeInt(colors[Math.floor(noise * colors.length) % colors.length]), phase: noise * 40 });
        continue;
      }
      if (roll > 0.97) out.sparkles.push({ x: jx, y: jy - lineHeight * 0.3, kind: "dew", color: DEW, phase: noise * 40 });
      // Near blades are longer, in more segments; tones pick from the palette with a bias to the middle.
      const shade = Math.min(palette.length - 1, Math.floor(((hash2(column, row, seed + 4) + hash2(column, row, seed + 5)) / 2) * palette.length * (0.6 + t * 0.45)) + lift);
      out.blades.push({
        x: jx,
        y: jy,
        segments: t > 0.75 ? 3 : t > 0.25 ? 2 : 1,
        // The blade's place in the travelling gust bands, worked out once.
        sweep: jx * 0.004,
        band: jx * 0.018 + jy * 0.03,
        length: lineHeight * (0.5 + t * 0.35),
        lean: (hash2(column, row, seed + 6) - 0.45) * 0.7,
        phase: noise * Math.PI * 2,
        color: palette[shade],
        tip: palette[Math.min(palette.length - 1, shade + 1)],
        glyph: t < 0.12 ? "'" : "|",
      });
    }
    y += dy;
  }
  out.blades.sort((a, b) => a.y - b.y);
}

/** Build the grass and fireflies for the current scene, in its `season`. */
export function createGrass({ width, height, cellWidth, lineHeight, frame, season = "summer", trees = [] }) {
  const scene = activeScene();
  // No grass inside the crowns of trees standing on the banks: they keep their dark backing.
  const crowns = trees.filter((tree) => tree.bank);
  const covered = (x, y) => crowns.some((tree) => inCrown(tree, x, y));
  const palette = (PALETTES[season] ?? PALETTES.summer).map(gradeInt);
  const flowers = BLOOM[season] ?? 1;
  const horizon = height * scene.horizon;
  const far = field();
  const near = field();

  // Grassy river banks, from the far bend down to the bottom of the view.
  if (scene.banks && scene.banks.style !== "cliff") {
    sow(far, {
      top: horizon + lineHeight * 0.5,
      bottom: height + lineHeight,
      left: 0,
      right: width,
      inside: (x, y) => {
        const { left, right } = bankWidths(y / height);
        // Leave the willow scrub along the water's edge to its own glyphs.
        const margin = width * (0.03 + 0.05 * (y / height));
        return x < left * width - margin || x > width * (1 - right) + margin;
      },
      covered,
      nearness: (y) => Math.max(0, (y - horizon) / (height - horizon)),
      cellWidth, lineHeight, seed: 901, palette, flowers,
    });
  }

  // The bank we stand on.
  if (scene.nearBank) {
    let top = height;
    for (let x = frame.left; x <= frame.left + frame.width; x += cellWidth) top = Math.min(top, nearBankY(x, height));
    sow(near, {
      top: top - lineHeight * 0.2,
      bottom: height + lineHeight,
      left: frame.left - cellWidth,
      right: frame.left + frame.width + cellWidth,
      inside: (x, y) => y > nearBankY(x, height) - lineHeight * 0.1,
      covered: () => false,
      // Close up, the grass catches more light.
      lift: 1,
      nearness: (y) => 0.55 + 0.45 * Math.min(1, Math.max(0, (y - top) / (height - top))),
      cellWidth, lineHeight, seed: 977, palette, flowers,
    });
  }

  // Fireflies wander over the grass, or along the far shore where there is none; none in winter.
  const homes = [];
  for (let i = 0; i < (season === "winter" ? 0 : FIREFLIES); i += 1) {
    const pool = i % 2 ? near.blades : far.blades;
    const blade = pool.length ? pool[Math.floor(hash2(i, 7, 313) * pool.length)] : null;
    const x = blade ? blade.x : frame.left + frame.width * hash2(i, 8, 313);
    const y = blade ? blade.y - lineHeight * (0.8 + hash2(i, 9, 313) * 2) : shorelineY(x, height) + lineHeight * (hash2(i, 9, 313) * 3 - 1.5);
    homes.push({ x, y, phase: hash2(i, 10, 313) * 100, speed: 0.3 + hash2(i, 11, 313) * 0.5 });
  }

  return { far, near, fireflies: homes, cellWidth, lineHeight };
}

/** How dewy the morning is and how open the flowers are, by clock fraction. */
function dewAt(dayTime) {
  return Math.max(0, 1 - Math.abs(dayTime - 0.27) / 0.1);
}

function fillField(batch, grass, data, time, dayTime, wind) {
  const { lineHeight } = grass;
  // Gusts bend the grass harder in the wind, and it leans downwind.
  const strength = 0.5 + 1.5 * wind.strength * wind.gust;
  const lean = wind.dir * wind.strength * 0.35;
  for (const blade of data.blades) {
    // Gusts run across the field as bands; every blade also flutters on its own.
    const wave = Math.max(0, fastSin(blade.band - time * 1.3));
    const gust = (0.5 + 0.5 * fastSin(blade.sweep - time * 0.35)) * wave * wave * wave;
    const bend = blade.lean + lean + gust * 0.7 * strength * (wind.dir < 0 ? -1 : 1) + fastSin(time * 1.7 + blade.phase) * 0.05 * strength;
    const step = blade.length / blade.segments;
    const shares = SEGMENT_LEAN[blade.segments];
    let x = blade.x;
    let y = blade.y;
    for (let k = 0; k < blade.segments; k += 1) {
      // Each segment leans further than the one below it, curving the blade.
      // Angles stay small, so a short series stands in for sin and cos.
      const angle = bend * shares[k];
      const a2 = angle * angle;
      const sin = angle * (1 - a2 / 6);
      const cos = 1 - a2 / 2 + (a2 * a2) / 24;
      const color = k === blade.segments - 1 || gust > 0.45 ? blade.tip : blade.color;
      batch.push(x + sin * step * 0.5, y - cos * step * 0.5, blade.glyph, color, angle);
      x += sin * step;
      y -= cos * step;
    }
  }
  const dew = dewAt(dayTime);
  const day = dayTime > 0.22 && dayTime < 0.85;
  for (const spark of data.sparkles) {
    const twinkle = 0.5 + 0.5 * Math.sin(time * 2.3 + spark.phase);
    if (spark.kind === "flower") {
      if (day) batch.push(spark.x, spark.y - lineHeight * 0.4, twinkle > 0.85 ? "*" : "o", spark.color);
    } else if (dew > 0.05 && twinkle > 0.35) {
      batch.push(spark.x, spark.y, twinkle > 0.9 ? "*" : ".", spark.color, 0, Math.round(255 * dew * twinkle));
    }
  }
}

/**
 * Push this frame's grass. `far` sits behind the bank trees, `near` over the
 * water; fireflies go to `flies`, which stays bright at night.
 */
export function fillGrass(grass, { far, near, flies }, time, dayTime, rain = 0, wind = { strength: 0.2, dir: 1, gust: 1 }) {
  far.clear();
  near.clear();
  flies.clear();
  fillField(far, grass, grass.far, time, dayTime, wind);
  fillField(near, grass, grass.near, time, dayTime, wind);

  const night = dayTime < 0.2 || dayTime > 0.88;
  if (!night || rain > 0.2) return;
  for (const fly of grass.fireflies) {
    const t = time * fly.speed + fly.phase;
    const x = fly.x + Math.sin(t * 0.7) * 28 + Math.sin(t * 1.9) * 9;
    const y = fly.y + Math.sin(t * 0.9 + 1.3) * 12;
    // Each one pulses on and off at its own pace.
    const pulse = Math.max(0, Math.sin(time * (0.9 + fly.speed) + fly.phase * 3));
    if (pulse < 0.15) continue;
    flies.push(x, y, pulse > 0.75 ? "*" : ".", FIREFLY, 0, Math.round(255 * Math.min(1, pulse * 1.3)));
  }
}
