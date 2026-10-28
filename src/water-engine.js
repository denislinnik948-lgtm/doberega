import { fastSin } from "./noise.js";

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const NO_RIPPLES = [];

// The sample is written into one shared object: the renderer reads it at once
// for each of thousands of cells a frame, so there is nothing to allocate.
const result = { x: 0, y: 0, density: 0 };

/**
 * Pure water-surface model. It derives coherent motion and luminance from a fixed
 * character cell and elapsed time; it never uses per-frame randomness, and the
 * only things it keeps on a cell are the turn of a river bend there and its
 * wind coordinates on still water. Wave light becomes a character-density
 * threshold in the renderer. The returned sample is reused by the next call.
 */
export function sampleWater(point, time, config, verticalDepth, ripples = NO_RIPPLES) {
  const speed = config.waveSpeed;
  const t = time * speed;
  const x = point.x;
  const y = point.y;
  // A river carries the whole wave pattern sideways across the view, or
  // straight away from the viewer when we look downstream.
  const drift = (config.flow ?? 0) * time;
  // A bend turns the downstream pattern around a pivot, so far off the current
  // swings sideways and carries on out of view.
  let bx = x;
  let by = y;
  if (config.flowAway && config.bend) {
    const { x: cx, y: cy, from, to } = config.bend;
    // The turn depends only on where the cell is, so a water cell keeps it.
    if (point.bendCos === undefined || point.bendDepth !== verticalDepth) {
      const turn = clamp01((from - verticalDepth) / (from - to)) ** 1.4 * Math.PI * 0.5;
      point.bendCos = Math.cos(-turn);
      point.bendSin = Math.sin(-turn);
      point.bendDepth = verticalDepth;
    }
    const cos = point.bendCos;
    const sin = point.bendSin;
    bx = cx + (x - cx) * cos - (y - cy) * sin;
    by = cy + (x - cx) * sin + (y - cy) * cos;
  }
  // A light breeze sends broad, nearly parallel wavelets from the far shore
  // toward the viewer. Small crosswind terms gently bend the crests instead of
  // making a crisscross interference pattern. On still water a cell's wind
  // coordinates never change, so they are kept on it.
  let downlake;
  let acrossLake;
  if (!drift && !config.flowAway) {
    if (point.downlake === undefined) {
      point.downlake = (x + y) * 0.7071;
      point.acrossLake = (x - y) * 0.7071;
    }
    downlake = point.downlake;
    acrossLake = point.acrossLake;
  } else {
    const wx = config.flowAway ? bx + drift : x - drift;
    const wy = (config.flowAway ? by : y) + drift;
    downlake = (wx + wy) * 0.7071;
    acrossLake = (wx - wy) * 0.7071;
  }
  const crestBend = fastSin(acrossLake * 0.0032 - t * 0.14 + 1.1) * 36
    + fastSin(acrossLake * 0.007 - t * 0.23 + 2.4) * 10;
  const windPath = downlake + crestBend;
  const swell = fastSin(windPath * 0.0068 - t * 0.62 + 0.8);
  const breezeWave = fastSin(windPath * 0.015 - acrossLake * 0.0045 - t * 0.92 + 2.1);
  const fineWave = fastSin(windPath * 0.028 + acrossLake * 0.009 - t * 1.12 + 3.4);
  const gust = 0.86 + fastSin(acrossLake * 0.0028 - t * 0.13 + 0.6) * 0.14;
  const softCurrent = fastSin(downlake * 0.005 + acrossLake * 0.009 - t * 0.27 + 1.8);
  const broadWave = (swell * 0.5 + breezeWave * 0.34 + fineWave * 0.16) * gust + softCurrent * 0.08;
  const displacement = config.waveAmplitude;

  // Follow the wind with a restrained drift while keeping the character grid clear.
  const verticalDrift = broadWave * displacement * 0.3;
  const lateralDrift = fastSin(acrossLake * 0.009 - t * 0.38 + swell * 0.35) * displacement * 0.08;
  let offsetX = verticalDrift + lateralDrift;
  let offsetY = verticalDrift - lateralDrift;

  // Narrow, low-contrast glints travel along the same prevailing wind direction.
  const sheenA = fastSin(windPath * 0.021 - acrossLake * 0.007 - t * 1.04 + 1.4);
  const sheenB = fastSin(windPath * 0.034 + acrossLake * 0.011 - t * 1.28 + 2.6);
  const shimmer = sheenA * 0.68 + sheenB * 0.32;
  const depth = clamp01(verticalDepth);
  let rippleHighlight = 0;

  // A single Gaussian front travels out from each touch; it fades behind the front.
  for (const ripple of ripples) {
    const age = time - ripple.time;
    if (age < 0 || age > 5.5) continue;

    const dx = x - ripple.x;
    const dy = y - ripple.y;
    const distance = Math.hypot(dx, dy);
    const size = ripple.size ?? 1;
    const propagationSpeed = 110 * (0.7 + config.waveSpeed * 0.35) * (0.9 + size * 0.1);
    const radius = age * propagationSpeed;
    const width = 8 + (14 + age * 2.4) * size;
    const frontDistance = distance - radius;
    const ringProfile = Math.exp(-0.5 * (frontDistance / width) ** 2);
    const fade = Math.exp(-age * (0.3 / Math.sqrt(size)) - radius / (850 * size)) * ripple.strength;
    const ring = ringProfile * fade;

    if (distance > 0.001) {
      offsetX += (dx / distance) * ring * 9 * size;
      offsetY += (dy / distance) * ring * 9 * size;
    }
    rippleHighlight = Math.max(rippleHighlight, ring * 0.28 * size);
  }

  // Fast water: long bright streaks drawn out along the current.
  let streak = 0;
  if (config.flowAway) {
    const bend = fastSin(downlake * 0.006 + acrossLake * 0.002) * 1.6;
    const lane = Math.max(0, fastSin(acrossLake * 0.05 + bend));
    const pulse = 0.55 + 0.45 * fastSin(downlake * 0.018 + acrossLake * 0.013);
    streak = lane ** 10 * pulse * 0.2 - 0.03;
  }

  const density = clamp01(
    0.72 - depth * 0.025
      + streak
      // The wind ruffles the water: the wavelets stand out more.
      + broadWave * 0.105 * (1 + (config.ruffle ?? 0) * 0.9)
      + shimmer * config.shimmer * 0.026
      + rippleHighlight * 0.75,
  );

  result.x = x + offsetX;
  result.y = y + offsetY;
  result.density = density;
  return result;
}
