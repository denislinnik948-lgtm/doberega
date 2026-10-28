import { fastSin, valueNoise } from "./noise.js";
import { ridgeTop } from "./landscape-engine.js";

/**
 * Small living details for the far landscape, rebuilt every frame on top of
 * the static land layer: wind running through meadows and grassy banks,
 * chimney smoke, mist on the far shore, cloud wisps clinging to the peaks,
 * blinking warning lights on pylons and, in winter, holiday lights on the houses. Everything is plain glyph pushes.
 */

const mix = (a, b, t) => {
  const channel = (shift) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

const SMOKE = [0x6e6c68, 0xa4acb4];
const MIST = 0xb4c2cc;
const WISP = 0xe6ecf0;
const BEACON = 0xff4a30;
const GARLAND = [0xff5a4a, 0xffd25a, 0x6ae07a, 0x6ab8ff];
const SMOKE_PUFFS = 16;
const SMOKE_LIFE = 7;

/** How thick the shoreline mist is at clock fraction `t`: heavy at dawn and dusk, light at night. */
function mistStrength(t) {
  const around = (center, width) => {
    const distance = ((t - center + 1.5) % 1) - 0.5;
    return Math.exp(-(distance ** 2) / (2 * width * width));
  };
  const night = t < 0.2 || t > 0.92 ? 0.45 : 0;
  return Math.max(night, around(0.27, 0.035), around(0.86, 0.03) * 0.8);
}

/**
 * Collect what can move in this scene. `breeze` cells are glyphs taken out of
 * the static layer (meadow stipple, grass on the banks) so they can shimmer.
 */
export function createAmbient({ scene, structures, ridgeCells, bankCells, width, height, cellWidth, lineHeight, shorelineY }) {
  const breezy = new Set(scene.ridges.map((ridge, index) => (ridge.breeze ? index : -1)).filter((index) => index >= 0));
  const grassBanks = scene.banks && scene.banks.style !== "cliff";
  const breeze = [
    ...ridgeCells.filter((cell) => breezy.has(cell.ridge) && cell.glyph).map((cell) => ({ ...cell, colorValue: parseInt(cell.color.slice(1), 16) })),
    ...(grassBanks ? bankCells : []).map((cell) => ({ ...cell, colorValue: parseInt(cell.color.slice(1), 16) })),
  ];

  // Mist sits in a band of rows straddling the far shoreline (not on fast rivers).
  const mist = [];
  for (let x = cellWidth; scene.mist !== false && x < width; x += cellWidth * 1.5) {
    const shore = shorelineY(x);
    for (let k = -4; k <= 2; k += 1) mist.push({ x, y: shore + k * lineHeight * 0.7, row: k });
  }

  // Cloud wisps drift across the upper slopes of alpine ridges.
  const alpine = scene.ridges.find((ridge) => ridge.alpine && ridge.snowline);
  const wisps = [];
  if (alpine) {
    const top = height * (alpine.snowline - 0.05);
    for (let y = top; y < top + height * 0.08; y += lineHeight) {
      for (let x = width * (alpine.rise?.[0] ?? 0); x < width; x += cellWidth * 1.5) {
        // Only over the mountain itself, or just above its crest.
        if (y > ridgeTop(alpine, x, height) - lineHeight * 1.5) wisps.push({ x, y });
      }
    }
  }

  // Leaves on the near wooded hill rustle in place.
  // Each keeps its place in the stir and the gust, so a frame only adds the time.
  const leaves = (structures.cells ?? []).filter((cell) => cell.rustle).map((cell) => ({
    x: cell.x, y: cell.y, glyph: cell.glyph, colorValue: parseInt(cell.color.slice(1), 16),
    stirPhase: cell.x * 0.031 + cell.y * 0.047, gustPhase: cell.x * 0.012,
  }));

  return {
    breeze,
    leaves,
    breezyRidges: breezy,
    grassBanks,
    chimneys: structures.chimneys ?? [],
    beacons: structures.beacons ?? [],
    garlands: structures.garlands ?? [],
    mist,
    wisps,
    cellWidth,
    lineHeight,
  };
}

/**
 * Push this frame's ambient glyphs. `ground` sits under the trees (grass),
 * `haze` drifts in front of them (smoke, mist, cloud); both take the daylight
 * tint. `glow` holds lights that stay bright at night.
 */
export function fillAmbient(ambient, { ground, haze, glow }, time, dayTime, rain = 0, wind = { strength: 0.2, dir: 1, gust: 1 }) {
  // Stronger wind, brighter and harder gusts across the meadows; smoke blown flatter and farther downwind.
  const blow = 0.5 + 1.5 * wind.strength * wind.gust;
  const downwind = wind.dir < 0 ? -1 : 1;
  ground.clear();
  haze.clear();
  glow.clear();
  const { cellWidth, lineHeight } = ambient;

  // Gusts sweep across the grass as bright travelling bands.
  for (const cell of ambient.breeze) {
    const gust = 0.5 + 0.5 * Math.sin(cell.x * 0.004 - time * 0.35);
    const wave = Math.min(1, Math.max(0, Math.sin(cell.x * 0.02 * downwind + cell.y * 0.03 - time * 1.4)) ** 3 * gust * blow);
    // The gust bends each stalk over and shifts it a little downwind.
    const lean = wave * cellWidth * 0.15 * downwind;
    ground.push(cell.x + lean, cell.y, cell.glyph, wave > 0.05 ? mix(cell.colorValue, 0xe8e6b8, wave * 0.45) : cell.colorValue, wave * 0.6 * downwind);
  }

  // Leaves stir a pixel or so and catch the light as gusts pass.
  const stirTime = time * 1.1;
  const gustTime = time * 0.6;
  for (const cell of ambient.leaves) {
    const stir = fastSin(stirTime + cell.stirPhase);
    const wave = fastSin(cell.gustPhase - gustTime);
    const gust = wave > 0 ? wave * wave * wave * wave : 0;
    ground.push(cell.x + stir * 0.7 * (0.4 + gust), cell.y + stir * 0.25, cell.glyph, gust > 0.1 ? mix(cell.colorValue, 0xb8d07a, gust * 0.35) : cell.colorValue);
  }

  // Chimney smoke rises, drifts downwind and thins out; rain beats it down.
  const rise = (1 - rain * 0.5) * (1.1 - 0.6 * wind.strength);
  const carry = downwind * (0.3 + 1.7 * wind.strength);
  for (const chimney of ambient.chimneys) {
    for (let i = 0; i < SMOKE_PUFFS; i += 1) {
      const age = (time + chimney.seed * 2.3 + (i * SMOKE_LIFE) / SMOKE_PUFFS) % SMOKE_LIFE;
      const u = age / SMOKE_LIFE;
      const x = chimney.x + u * u * cellWidth * 9 * carry + Math.sin(age * 1.3 + i) * cellWidth * 0.4 * u;
      const y = chimney.y - u * lineHeight * 7 * rise;
      const glyph = u < 0.25 ? "@" : u < 0.5 ? "o" : u < 0.75 ? "*" : "'";
      haze.push(x, y, glyph, mix(SMOKE[0], SMOKE[1], u));
      // A second, offset puff makes the plume read wider as it rises.
      if (u > 0.3) haze.push(x + cellWidth * (0.6 + u) * downwind, y + lineHeight * 0.3, u < 0.7 ? "o" : ".", mix(SMOKE[0], SMOKE[1], Math.min(1, u + 0.15)));
    }
  }

  // Mist drifts slowly along the far shore; rain clears it away.
  const strength = mistStrength(dayTime) * Math.max(0, 1 - rain * 4);
  if (strength > 0.05) {
    for (const cell of ambient.mist) {
      // Thickest right on the waterline, thinning upward into the trees.
      const fade = 1 - Math.abs(cell.row + 0.5) * 0.16;
      const density = valueNoise(cell.x * 0.012 - time * 0.06, cell.row * 0.9 + time * 0.02, 41) * strength * fade * 1.25;
      if (density > 0.3) haze.push(cell.x, cell.y, density > 0.5 ? "~" : "-", density > 0.5 ? MIST : 0x8c9aa6);
    }
  }

  // Thin cloud clinging to the mountain flanks.
  for (const cell of ambient.wisps) {
    const density = valueNoise(cell.x * 0.008 - time * 0.03, cell.y * 0.02, 57);
    if (density > 0.58) haze.push(cell.x, cell.y, density > 0.72 ? "~" : "-", WISP);
  }

  // Holiday lights under the eaves twinkle after dark, the colours running along the string.
  if (dayTime < 0.29 || dayTime > 0.77) {
    const run = Math.floor(time * 0.8);
    for (const bulb of ambient.garlands) {
      if (Math.sin(time * 1.9 + bulb.seed * 2.3) < -0.4) continue;
      glow.push(bulb.x, bulb.y, "*", GARLAND[(((bulb.seed + run) % 4) + 4) % 4]);
    }
  }

  // Pylon warning lights blink once dusk falls.
  if (dayTime < 0.27 || dayTime > 0.8) {
    ambient.beacons.forEach((beacon, i) => {
      if ((time * 0.8 + i * 0.37) % 1 < 0.35) glow.push(beacon.x, beacon.y, "*", BEACON);
    });
  }
}
