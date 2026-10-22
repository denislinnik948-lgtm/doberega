import { clamp, hash2, valueNoise } from "./noise.js";
import { activeScene, bankWidths, shorelineY, view } from "./scene.js";

/** Ridged fractal noise: sharp crests where the smooth noise crosses its midpoint. */
function ridged(x, y, seed, octaves = 4) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += amplitude * (1 - Math.abs(2 * valueNoise(x * frequency, y * frequency, seed + o * 17) - 1)) ** 1.5;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum;
}

export function ridgeTop(ridge, x, height) {
  const s = ridge.seed;
  if (ridge.jagged) {
    // Alpine ridgeline: sharp crests, rising toward one side of the view.
    const u = x / view.width;
    const [from, to] = ridge.rise ?? [0, 0];
    const ramp = to > from ? Math.min(1, Math.max(0, (u - from) / (to - from))) ** 0.8 : 1;
    const crest = ridged(x * 0.0042, s, 100 + Math.round(s * 10), 5);
    return height * (ridge.top - ridge.amplitude * ramp * (0.25 + 0.95 * crest));
  }
  const peaks = 0.55 * (1 - Math.abs(Math.sin(x * 0.0021 + s))) ** 1.4
    + 0.3 * (1 - Math.abs(Math.sin(x * 0.0057 - s * 0.7)))
    + 0.15 * (0.5 + 0.5 * Math.sin(x * 0.013 + s * 2.1));
  return height * (ridge.top - ridge.amplitude * peaks);
}

/** The highest point of the far landscape at x, used to bound the sky. */
export function skylineY(x, height) {
  const { ridges, horizon } = activeScene();
  return ridges.length ? ridgeTop(ridges[0], x, height) : height * horizon;
}

const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const SNOW_LIT = [244, 247, 250];
const SNOW_SHADE = [150, 166, 188];
const ROCK_LIT = [132, 132, 128];
const ROCK_SHADE = [52, 60, 76];
const WOOD_LIT = [70, 92, 76];
const WOOD_SHADE = [36, 50, 52];
const HAZE = [158, 178, 198];

/**
 * What an alpine slope looks like at a screen point. Couloirs and spurs come
 * from vertically stretched ridged noise; the sun lights faces turned to the
 * left. Snow lies above a ragged snowline and runs further down the gullies,
 * bare rock shows where it is too steep to hold snow, woods cover the lower
 * slopes. Light is snapped to a few steps to keep a flat, pixel-art palette.
 */
export function alpineSample(ridge, x, y, height, column = alpineColumn(ridge, x, height)) {
  const seed = 300 + Math.round(ridge.seed * 10);
  const f = 0.011;
  const terrain = (px) => ridged(px * f, y * f * 0.32, seed, 4);
  const here = terrain(x);
  const slope = terrain(x - 3) - terrain(x + 3);
  const { top, crestSlope } = column;
  const nearCrest = Math.exp(-(y - top) / (height * 0.04));
  const light = Math.round(clamp(0.5 + slope * 9 + crestSlope * 1.2 * nearCrest + (here - 0.45) * 0.5, 0, 1) * 3) / 3;
  const snowline = ridge.snowline ? height * (ridge.snowline + (1 - here) * 0.07 + (valueNoise(x * 0.02, 3, seed) - 0.5) * 0.03) : -1;
  // Woods climb to just under the snow, or most of the way up a lower ridge.
  const woodsTop = ridge.snowline ? ridge.snowline + 0.13 : ridge.top - ridge.amplitude * 0.7;
  const treeline = height * (woodsTop + (valueNoise(x * 0.015, 9, seed) - 0.5) * 0.03);
  const material = y < snowline && Math.abs(slope) < 0.065 ? "snow" : y > treeline ? "woods" : "rock";
  return { material, light, slope, crest: y - top < height * 0.012 };
}

const ALPINE = {
  snow: [SNOW_SHADE, SNOW_LIT],
  rock: [ROCK_SHADE, ROCK_LIT],
  woods: [WOOD_SHADE, WOOD_LIT],
};

/** Palette colour of a slope sample, with distance haze. */
export function alpineColor(ridge, sample, depth) {
  const [shade, lit] = ALPINE[sample.material];
  return mixRgb(mixRgb(shade, lit, sample.light), HAZE, (ridge.haze ?? 0.22) + depth * 0.12);
}

/** Per-column values of an alpine ridge, shared by every pixel below the crest. */
export function alpineColumn(ridge, x, height) {
  return {
    top: ridgeTop(ridge, x, height),
    crestSlope: (ridgeTop(ridge, x + 4, height) - ridgeTop(ridge, x - 4, height)) / 8,
  };
}

const toHexRgb = (c) => `#${((1 << 24) | (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])).toString(16).slice(1)}`;

/** Contour and stipple glyphs for every ridge, plus per-cell ridge membership for reflections. */
export function createRidgeGlyphs(width, height, cellWidth, lineHeight) {
  const columns = Math.ceil(width / cellWidth);
  const cells = [];

  activeScene().ridges.forEach((ridge, ridgeIndex) => {
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) * cellWidth;
      const top = ridgeTop(ridge, x, height);
      const bottom = shorelineY(x, height);
      const firstRow = Math.max(0, Math.floor(top / lineHeight));
      const lastRow = Math.floor(bottom / lineHeight);

      for (let row = firstRow; row <= lastRow; row += 1) {
        const y = (row + 0.5) * lineHeight;
        if (y < top) continue;
        const noise = hash2(column, row, 71 + ridgeIndex);
        let glyph = null;

        if (y - top < lineHeight) {
          const slope = (ridgeTop(ridge, x + cellWidth, height) - ridgeTop(ridge, x - cellWidth, height)) / (2 * cellWidth);
          if (slope < -0.32) glyph = "/";
          else if (slope > 0.32) glyph = "\\";
          else if (top < ridgeTop(ridge, x - cellWidth, height) && top < ridgeTop(ridge, x + cellWidth, height)) glyph = "^";
          else glyph = noise > 0.5 ? "_" : "-";
        } else {
          // Stipple thins out toward the misty base of each layer.
          const fade = 1 - Math.min(1, (y - top) / (bottom - top + 1)) * 0.7;
          if (noise < ridge.density * fade) {
            glyph = ridge.texture[Math.floor(hash2(column, row, 13) * ridge.texture.length)];
          }
        }

        if (ridge.alpine) {
          // Every cell is drawn: a flat palette block with a glyph that follows the slope.
          const sample = alpineSample(ridge, x, y, height);
          const base = alpineColor(ridge, sample, Math.min(1, (y - top) / (bottom - top + 1)));
          const pick = (set) => set[Math.floor(noise * set.length)];
          let mark;
          if (sample.crest) mark = sample.material === "snow" ? "^" : glyph ?? "^";
          else if (sample.material === "snow") mark = pick(sample.light > 0.5 ? "*'^:" : "-~:'");
          else if (sample.material === "woods") mark = pick("o*&%");
          else mark = Math.abs(sample.slope) < 0.012 ? pick("#%:") : sample.slope > 0 ? "/" : "\\";
          cells.push({
            x, y, column, row,
            glyph: mark.trim() || null,
            // Bright glyph on a darker block of the same hue, like the rest of the landscape.
            color: toHexRgb(mixRgb(base, [255, 255, 255], 0.12)),
            fill: toHexRgb(mixRgb(base, [44, 54, 72], sample.material === "snow" ? 0.22 : 0.5)),
            ridge: ridgeIndex,
          });
          continue;
        }
        cells.push({ x, y, column, row, glyph, color: ridge.glyph, fill: ridge.fill, ridge: ridgeIndex });
      }
    }
  });

  return cells;
}

/** A thin, irregular strip of pebbles and sand where the far shore meets the water. */
export function createShoreGlyphs(width, height, cellWidth, lineHeight, sunX) {
  const columns = Math.ceil(width / cellWidth);
  const cells = [];
  for (let column = 0; column < columns; column += 1) {
    const x = (column + 0.5) * cellWidth;
    const row = Math.floor((shorelineY(x, height) - lineHeight * 0.05) / lineHeight);
    const noise = hash2(column, row, 907);
    const lit = Math.abs(x - sunX) < width * 0.18 && noise > 0.45;
    if (activeScene().shore === "reeds") {
      // A low fringe of reeds along the far waterline.
      cells.push({ x, y: (row + 0.5) * lineHeight, column, row, glyph: "|!|'|,|i"[Math.floor(noise * 8)], color: noise > 0.6 ? "#7f9a5a" : "#5f7a44" });
      if (noise > 0.35) cells.push({ x, y: (row - 0.5) * lineHeight, column, row: row - 1, glyph: noise > 0.8 ? "'" : "|", color: "#6f8a4e" });
      continue;
    }
    cells.push({
      x,
      y: (row + 0.5) * lineHeight,
      column,
      row,
      glyph: "_.,_o-_,"[Math.floor(noise * 8)],
      color: lit ? "#6f6a50" : "#3c4233",
    });
  }
  return cells;
}

const cellAt = (x, y, cellWidth, lineHeight) => {
  const column = Math.floor(x / cellWidth);
  const row = Math.floor(y / lineHeight);
  return { column, row, x: (column + 0.5) * cellWidth, y: (row + 0.5) * lineHeight };
};

/**
 * Man-made things on the far shore: cottages (whose windows light up at night),
 * a concrete dam and power pylons. Returns glyph cells and the window lights.
 */
export function createStructures(width, height, cellWidth, lineHeight) {
  const { structures } = activeScene();
  const cells = [];
  const lights = [];
  // Solid shapes painted under the glyphs so buildings read as silhouettes.
  const shapes = [];
  // Where animated extras attach: chimney tops for smoke, pylon tips for warning lights.
  const chimneys = [];
  const beacons = [];
  const put = (x, y, glyph, color, extra = {}) => {
    const cell = { ...cellAt(x, y, cellWidth, lineHeight), glyph, color, ...extra };
    cells.push(cell);
    return cell;
  };

  if (structures.houses) {
    // Either explicit spots (`at`) or `count` houses spread evenly over from..to.
    const { from = 0, to = 1, count = 0, at, scale = 1, roof = "#5a3b2e", walls = "#7a7262" } = structures.houses;
    const spots = at ?? Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 0.5)) / count);
    for (let i = 0; i < spots.length; i += 1) {
      const cx = width * spots[i] + (hash2(i, 3, 5) - 0.5) * width * 0.01;
      const base = shorelineY(cx, height) - lineHeight * 0.6;
      const half = Math.round((5 + hash2(i, 7, 9) * 3) * scale);
      const wallRows = Math.round(3 * scale);
      const roofRows = Math.ceil(half * 0.65);
      const left = cx - (half + 0.5) * cellWidth;
      const right = cx + (half + 0.5) * cellWidth;
      const wallTop = base - (wallRows - 0.5) * lineHeight;
      shapes.push({ points: [[left, base + lineHeight * 0.5], [left, wallTop], [right, wallTop], [right, base + lineHeight * 0.5]], color: "#4a453c" });
      shapes.push({ points: [[left - cellWidth, wallTop], [cx, wallTop - roofRows * lineHeight], [right + cellWidth, wallTop]], color: mixHex(roof, "#000000", 0.3) });
      for (let r = 0; r < wallRows; r += 1) {
        const y = base - r * lineHeight;
        for (let c = -half; c <= half; c += 1) {
          const x = cx + c * cellWidth;
          const edge = Math.abs(c) === half;
          const window = r >= 1 && r <= wallRows - 2 && !edge && Math.abs(c) >= Math.round(2 * scale) && Math.abs(c) <= Math.round(3 * scale);
          const door = r < Math.max(2, wallRows - 1) && Math.abs(c) <= (scale > 1.3 ? 1 : 0);
          const cell = put(x, y, edge ? "|" : window ? "#" : door ? "]" : r === 0 ? "_" : ":", window ? "#e2b85e" : door ? "#4a3626" : walls);
          if (window) lights.push(cell);
        }
      }
      for (let r = 0; r < roofRows; r += 1) {
        const y = base - (wallRows + r) * lineHeight;
        const span = Math.round(half + 1 - (r * (half + 1)) / roofRows);
        for (let c = -span; c <= span; c += 1) {
          const glyph = c === -span ? "/" : c === span ? "\\" : r === roofRows - 1 ? "^" : "=";
          put(cx + c * cellWidth, y, glyph, roof);
        }
      }
      // Chimney.
      put(cx + (half - 2) * cellWidth, base - (wallRows + 1) * lineHeight, "|", "#5a4a3e");
      put(cx + (half - 2) * cellWidth, base - (wallRows + 2) * lineHeight, "|", "#5a4a3e");
      chimneys.push({ x: cx + (half - 2) * cellWidth, y: base - (wallRows + 2.6) * lineHeight, seed: i });
    }
  }

  if (structures.dam) {
    const { from, to } = structures.dam;
    const x0 = width * from;
    const x1 = width * to;
    const shore = shorelineY((x0 + x1) / 2, height);
    const rows = Math.max(4, Math.round((height * 0.055) / lineHeight));
    const damTop = shore - (rows - 0.5) * lineHeight - lineHeight * 0.2;
    shapes.push({ points: [[x0 - cellWidth / 2, shore + lineHeight * 0.3], [x0 - cellWidth / 2, damTop], [x1 + cellWidth / 2, damTop], [x1 + cellWidth / 2, shore + lineHeight * 0.3]], color: "#5f6762" });
    for (let r = 0; r < rows; r += 1) {
      const y = shore - r * lineHeight - lineHeight * 0.2;
      for (let x = x0, c = 0; x <= x1; x += cellWidth, c += 1) {
        const gate = c % 9 >= 3 && c % 9 <= 5 && r < rows - 1;
        let glyph = r === rows - 1 ? (c % 2 ? "-" : "+") : gate ? (r % 2 ? "H" : "|") : (c + r) % 4 === 0 ? "#" : "=";
        if (x === x0 || x + cellWidth > x1) glyph = "|";
        put(x, y, glyph, gate ? "#4f5a58" : r === rows - 1 ? "#b7bdb2" : "#8e978f");
      }
    }
    // Lamps along the top of the dam.
    for (let x = x0 + cellWidth * 4; x < x1; x += cellWidth * 12) {
      lights.push(put(x, shore - rows * lineHeight - lineHeight * 0.2, "*", "#e2b85e"));
    }
  }

  if (structures.pylons) {
    const tops = structures.pylons.map((fx) => {
      const x = width * fx;
      const ground = shorelineY(x, height) - height * 0.02;
      const tall = Math.round((height * 0.13) / lineHeight);
      for (let r = 0; r < tall; r += 1) {
        const y = ground - r * lineHeight;
        const spread = Math.max(0, Math.round(((tall - r) / tall) * 2));
        put(x - spread * cellWidth, y, "/", "#2b3539");
        put(x + spread * cellWidth, y, "\\", "#2b3539");
        if (r % 2) put(x, y, "X", "#2b3539");
      }
      const topY = ground - tall * lineHeight;
      for (let c = -3; c <= 3; c += 1) put(x + c * cellWidth, topY, c === 0 ? "T" : "-", "#2b3539");
      beacons.push({ x, y: topY - lineHeight * 0.8 });
      return { x, y: topY };
    });
    // Sagging wires between neighbouring pylons.
    for (let i = 0; i < tops.length - 1; i += 1) {
      const a = tops[i];
      const b = tops[i + 1];
      for (let x = a.x + cellWidth * 4; x < b.x - cellWidth * 3; x += cellWidth) {
        const t = (x - a.x) / (b.x - a.x);
        put(x, a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * lineHeight * 1.6, ".", "#2b3539");
      }
    }
  }

  const out = { cells, lights, shapes, chimneys, beacons };
  if (structures.crag) addCrag(structures.crag, width, height, cellWidth, lineHeight, out);
  if (structures.archBridge) addArchBridge(structures.archBridge, width, height, cellWidth, lineHeight, out);

  return out;
}

/** Old stone bridge over a stream mouth on the far bank, with round arches. */
function addArchBridge({ from, to, arches }, width, height, cellWidth, lineHeight, out) {
  const x0 = width * from;
  const x1 = width * to;
  const base = Math.max(shorelineY(x0, height), shorelineY(x1, height)) - lineHeight * 0.2;
  const rows = Math.max(4, Math.round((height * 0.06) / lineHeight));
  const top = base - rows * lineHeight;
  const span = (x1 - x0) / arches;
  const archRadius = span * 0.36;
  const archHeight = (rows - 1.6) * lineHeight;
  const insideArch = (x, y) => {
    for (let i = 0; i < arches; i += 1) {
      const ax = x0 + span * (i + 0.5);
      const dx = (x - ax) / archRadius;
      const dy = (base + lineHeight * 0.5 - y) / archHeight;
      if (dy >= 0 && dx * dx + dy * dy < 1) return true;
    }
    return false;
  };
  // Solid masonry silhouette, with the dark water of the stream under each arch.
  out.shapes.push({ points: [[x0 - cellWidth, base + lineHeight * 0.5], [x0, top], [x1, top], [x1 + cellWidth, base + lineHeight * 0.5]], color: "#545248" });
  for (let i = 0; i < arches; i += 1) {
    const ax = x0 + span * (i + 0.5);
    const points = [];
    for (let k = 0; k <= 16; k += 1) {
      const angle = Math.PI - (k / 16) * Math.PI;
      points.push([ax + Math.cos(angle) * archRadius, base + lineHeight * 0.5 - Math.sin(angle) * archHeight]);
    }
    out.shapes.push({ points, color: "#162026" });
  }
  for (let r = 0; r <= rows; r += 1) {
    const y = base - r * lineHeight;
    for (let x = x0; x <= x1; x += cellWidth) {
      const cell = cellAt(x, y, cellWidth, lineHeight);
      const noise = hash2(cell.column, cell.row, 2203);
      if (insideArch(cell.x, cell.y)) {
        // A glimpse of the stream running out under the arch.
        if (r === 0 && noise > 0.4) out.cells.push({ ...cell, glyph: noise > 0.7 ? "~" : "-", color: "#4f6f7a" });
        continue;
      }
      const ring = insideArch(cell.x, cell.y + lineHeight) || insideArch(cell.x - cellWidth, cell.y) || insideArch(cell.x + cellWidth, cell.y);
      let glyph;
      let color;
      if (r === rows) {
        // Low parapet along the deck.
        if (noise < 0.25) continue;
        glyph = noise > 0.85 ? "n" : "_";
        color = "#a39e8a";
      } else if (r === rows - 1) {
        glyph = "=";
        color = noise > 0.5 ? "#9a9480" : "#868070";
      } else if (ring) {
        glyph = "#";
        color = "#8f8a76";
      } else {
        glyph = (r + Math.floor(cell.column / 2)) % 2 ? ":" : "=";
        color = noise > 0.6 ? "#7a7564" : noise > 0.2 ? "#686456" : "#55524a";
      }
      out.cells.push({ ...cell, glyph, color });
    }
  }
}

/** Near banks (grassy or rocky) that frame the water at the sides of the view. */
export function createBankGlyphs(width, height, cellWidth, lineHeight, sunX = width / 2) {
  const { banks, horizon } = activeScene();
  if (!banks) return [];
  const cells = [];
  const columns = Math.ceil(width / cellWidth);
  const rows = Math.ceil(height / lineHeight);
  for (let row = Math.floor((height * horizon) / lineHeight); row < rows; row += 1) {
    const y = (row + 0.5) * lineHeight;
    const { left, right } = bankWidths(y / height);
    const leftEdge = left * width;
    const rightEdge = width * (1 - right);
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) * cellWidth;
      if (x >= leftEdge && x <= rightEdge) continue;
      const noise = hash2(column, row, 333);
      const edge = Math.abs(x - leftEdge) < cellWidth * 1.2 || Math.abs(x - rightEdge) < cellWidth * 1.2;
      let glyph;
      let color;
      // Plain grass is drawn as blades by the grass engine; only the glyphs that remain are kept.
      let plain = false;
      if (banks.style === "cliff") {
        // Layered rock: horizontal strata with cracks, lighter toward the water's edge.
        const nearEdge = Math.min(Math.abs(x - leftEdge), Math.abs(x - rightEdge)) / width;
        const strata = (row + Math.floor(column / 7)) % 4 === 0;
        glyph = edge ? (x < width / 2 ? "\\" : "/") : strata ? (noise > 0.5 ? "=" : "-") : "#%:/\\.:#"[Math.floor(noise * 8)];
        color = edge ? "#7a7a6c" : nearEdge < 0.04 ? "#4c4f47" : noise < 0.3 ? "#232824" : strata ? "#3f443d" : "#30352f";
        if (!edge && noise > 0.9) continue;
      } else if (banks.style === "willow" && Math.min(Math.abs(x - leftEdge), Math.abs(x - rightEdge)) < width * (0.03 + 0.05 * (y / height))) {
        // Willow scrub and sedge crowd the water's edge.
        const lit = (x < leftEdge) === (sunX < width / 2) ? noise > 0.45 : noise > 0.75;
        glyph = edge ? (noise > 0.5 ? "|" : "'") : "o%&*O#"[Math.floor(noise * 6)];
        color = edge ? "#5d6e45" : lit ? "#5f7243" : noise < 0.3 ? "#1f2c20" : "#2f4129";
      } else {
        glyph = edge ? "~" : ",'\"`.;,'"[Math.floor(noise * 8)];
        color = edge ? "#6a7a58" : noise < 0.5 ? "#3f5236" : "#56693f";
        if (!edge && noise > 0.8) continue;
        plain = true;
      }
      cells.push({ x, y, column, row, glyph, color, plain });
    }
  }
  return cells;
}

const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
};

/**
 * A wooded hill rising from the far shore to a sheer grey cliff, with a
 * castle of pale walls and red roofs perched on top.
 */
function addCrag({ to, peak }, width, height, cellWidth, lineHeight, out) {
  const horizon = activeScene().horizon * height;
  const plateau = horizon - height * peak;
  const lowSlope = height * peak * 0.66;
  // Height of the hill's skyline at x, with a scalloped edge of tree crowns.
  const skyline = (x) => {
    const u = x / width;
    let lift;
    if (u < 0.1) lift = height * peak * (0.7 + 0.3 * (u / 0.1));
    else if (u < 0.33) lift = height * peak;
    else if (u < 0.37) lift = height * peak + (lowSlope - height * peak) * ((u - 0.33) / 0.04);
    else lift = lowSlope * Math.max(0, 1 - (u - 0.37) / (to - 0.37)) ** 1.3;
    return horizon - lift;
  };
  // The woods are packed tree crowns on a jittered grid: each lit from the
  // upper left, shaded underneath, with dark gaps between them.
  const crownW = cellWidth * 5;
  const crownH = lineHeight * 2.8;
  const crownAt = (i, j) => ({
    x: (i + 0.5 + (j % 2) * 0.5 + (hash2(i, j, 4201) - 0.5) * 0.5) * crownW,
    y: (j + 0.5 + (hash2(i, j, 4203) - 0.5) * 0.4) * crownH,
    rx: crownW * (0.62 + hash2(i, j, 4207) * 0.25),
    ry: crownH * (0.6 + hash2(i, j, 4209) * 0.25),
    conifer: hash2(i, j, 4211) > 0.82,
  });
  const crownGlyph = (x, y, noise) => {
    const i0 = Math.floor(x / crownW);
    const j0 = Math.floor(y / crownH);
    let best = null;
    for (let j = j0 - 1; j <= j0 + 1; j += 1) {
      for (let i = i0 - 1; i <= i0 + 1; i += 1) {
        const crown = crownAt(i, j);
        const nx = (x - crown.x) / crown.rx;
        const ny = (y - crown.y) / crown.ry;
        // Conifers taper to a point at the top.
        const d = crown.conifer ? Math.abs(nx) / Math.max(0.05, (ny + 1) / 2) + Math.max(0, ny) ** 2 : nx * nx + ny * ny;
        // The lower crown stands in front.
        if (d < 1 && (!best || crown.y > best.crown.y)) best = { crown, nx, ny, d };
      }
    }
    if (!best) return { glyph: noise > 0.5 ? "." : ",", color: "#16241a" };
    const { nx, ny, d, crown } = best;
    const light = -nx * 0.6 - ny * 0.8;
    if (d > 0.72 && ny > -0.2) return { glyph: "%&#"[Math.floor(noise * 3)], color: "#16291a" };
    if (light > 0.45) return { glyph: crown.conifer ? "^" : noise > 0.5 ? "o" : "O", color: noise > 0.4 ? "#6a9a4a" : "#557f3c" };
    if (light > 0) return { glyph: crown.conifer ? "*" : "o*&"[Math.floor(noise * 3)], color: "#3a6230" };
    return { glyph: "*&%"[Math.floor(noise * 3)], color: "#1f3a20" };
  };

  // The cliff face hangs below the castle, deepest in the middle.
  const cliffDepth = (x) => {
    const u = (x / width - 0.12) / 0.22;
    if (u <= 0 || u >= 1) return 0;
    return height * peak * 0.5 * Math.sin(Math.PI * u ** 0.8) ** 0.9 * (0.75 + 0.25 * Math.sin(x * 0.07) * Math.sin(x * 0.023));
  };

  const outline = [[0, horizon + lineHeight]];
  for (let x = 0; x <= width * to; x += cellWidth) outline.push([x, skyline(x)]);
  outline.push([width * to, horizon + lineHeight]);
  out.shapes.push({ points: outline, color: "#0e1a10" });
  const cliff = [];
  for (let x = width * 0.12; x <= width * 0.34; x += cellWidth) cliff.push([x, skyline(x) - lineHeight * 0.3]);
  for (let x = width * 0.34; x >= width * 0.12; x -= cellWidth) cliff.push([x, skyline(x) + cliffDepth(x)]);
  out.shapes.push({ points: cliff, color: "#5c5d58" });

  // Each crown gets a solid body and a lighter cap, back rows first so nearer
  // trees overlap; crowns on the skyline give the hill a bumpy treetop edge.
  const ellipse = (cx, cy, rx, ry) => Array.from({ length: 14 }, (_, k) => {
    const a = (k / 14) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
  const firstRow = Math.floor((plateau - height * 0.02) / crownH);
  for (let j = firstRow; j * crownH < horizon + crownH; j += 1) {
    for (let i = -1; i * crownW < width * to + crownW; i += 1) {
      const crown = crownAt(i, j);
      if (crown.x < 0 || crown.x > width * to) continue;
      const top = skyline(crown.x);
      if (crown.y < top - crown.ry * 0.2 || crown.y < top + cliffDepth(crown.x) || crown.y > shorelineY(crown.x, height)) continue;
      const body = crown.conifer
        ? [[crown.x - crown.rx * 0.8, crown.y + crown.ry], [crown.x, crown.y - crown.ry * 1.3], [crown.x + crown.rx * 0.8, crown.y + crown.ry]]
        : ellipse(crown.x, crown.y, crown.rx, crown.ry);
      out.shapes.push({ points: body, color: "#15281b" });
      out.shapes.push({ points: crown.conifer
        ? [[crown.x - crown.rx * 0.45, crown.y + crown.ry * 0.2], [crown.x, crown.y - crown.ry * 1.1], [crown.x + crown.rx * 0.05, crown.y + crown.ry * 0.2]]
        : ellipse(crown.x - crown.rx * 0.18, crown.y - crown.ry * 0.25, crown.rx * 0.62, crown.ry * 0.55), color: "#243f26" });
    }
  }

  for (let column = 0; column * cellWidth < width * to; column += 1) {
    const x = (column + 0.5) * cellWidth;
    const top = skyline(x);
    const shore = shorelineY(x, height);
    for (let row = Math.floor(top / lineHeight); (row + 0.5) * lineHeight < shore; row += 1) {
      const y = (row + 0.5) * lineHeight;
      if (y < top) continue;
      const noise = hash2(column, row, 4101);
      if (y < top + cliffDepth(x)) {
        // Pale limestone with vertical cracks.
        const crack = hash2(column, 0, 4111) > 0.75;
        out.cells.push({ x, y, column, row, glyph: crack ? "|" : "#%:/\\.:"[Math.floor(noise * 7)], color: noise > 0.55 ? "#b4b4aa" : noise > 0.2 ? "#8e8f86" : "#6a6b64" });
      } else {
        out.cells.push({ x, y, column, row, rustle: true, ...crownGlyph(x, y, noise) });
      }
    }
  }

  // A very old castle on the plateau: a broken curtain wall, a gutted keep and
  // a crumbling corner tower, weathered grey stone patched with ivy.
  const rowsOf = (fraction) => Math.max(2, Math.round((height * fraction) / lineHeight));
  const stone = (column, row) => {
    const noise = hash2(column, row, 4301);
    if (noise > 0.86) return "#3d5530";
    return noise > 0.55 ? "#8a877a" : noise > 0.25 ? "#6e6b60" : "#55534a";
  };
  // Masonry from x0 to x1 standing `rows` high, its top broken by `ruin` (0..1).
  const ruinWall = (from, to2, rows, groundY, ruin, slits = false) => {
    const x0 = width * from;
    const x1 = width * to2;
    const columns = [];
    for (let x = x0 + cellWidth / 2; x < x1; x += cellWidth) {
      const cell = cellAt(x, groundY, cellWidth, lineHeight);
      const broken = Math.floor(hash2(cell.column, 7, 4303) ** 2 * ruin * rows);
      columns.push({ x, column: cell.column, top: rows - broken });
    }
    const outline = [[x0, groundY + lineHeight * 0.5]];
    for (const c of columns) {
      outline.push([c.x - cellWidth / 2, groundY - (c.top - 0.5) * lineHeight]);
      outline.push([c.x + cellWidth / 2, groundY - (c.top - 0.5) * lineHeight]);
    }
    outline.push([x1, groundY + lineHeight * 0.5]);
    out.shapes.push({ points: outline, color: "#4a4840" });
    columns.forEach((c, index) => {
      for (let r = 0; r < c.top; r += 1) {
        const cell = cellAt(c.x, groundY - r * lineHeight, cellWidth, lineHeight);
        const slit = slits && r === c.top - 2 && index % 3 === 1;
        const crest = r === c.top - 1;
        out.cells.push({ ...cell, glyph: slit ? "|" : crest ? (c.top === rows ? "n" : "'") : (r + index) % 3 ? ":" : "=", color: slit ? "#17160f" : stone(cell.column, cell.row) });
      }
    });
  };
  const ground = plateau;
  ruinWall(0.1, 0.31, rowsOf(0.022), ground, 0.9);
  ruinWall(0.13, 0.175, rowsOf(0.075), ground, 0.55, true);
  ruinWall(0.205, 0.225, rowsOf(0.045), ground, 0.7, true);
  ruinWall(0.285, 0.31, rowsOf(0.055), ground + height * 0.02, 0.6, true);
}
