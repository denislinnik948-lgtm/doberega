import { hash2 } from "./noise.js";
import { activeScene, bankWidths, shorelineY } from "./scene.js";

export function ridgeTop(ridge, x, height) {
  const s = ridge.seed;
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
  const put = (x, y, glyph, color, extra = {}) => {
    const cell = { ...cellAt(x, y, cellWidth, lineHeight), glyph, color, ...extra };
    cells.push(cell);
    return cell;
  };

  if (structures.houses?.style === "mazanka") {
    addMazanky(structures.houses, { width, height, cellWidth, lineHeight, put, shapes, lights });
  } else if (structures.houses) {
    const { from, to, count, scale = 1 } = structures.houses;
    for (let i = 0; i < count; i += 1) {
      const cx = width * (from + ((to - from) * (i + 0.5)) / count) + (hash2(i, 3, 5) - 0.5) * width * 0.03;
      const base = shorelineY(cx, height) - lineHeight * 0.6;
      const half = Math.round((5 + hash2(i, 7, 9) * 3) * scale);
      const wallRows = Math.round(3 * scale);
      const roofRows = Math.ceil(half * 0.65);
      const left = cx - (half + 0.5) * cellWidth;
      const right = cx + (half + 0.5) * cellWidth;
      const wallTop = base - (wallRows - 0.5) * lineHeight;
      shapes.push({ points: [[left, base + lineHeight * 0.5], [left, wallTop], [right, wallTop], [right, base + lineHeight * 0.5]], color: "#4a453c" });
      shapes.push({ points: [[left - cellWidth, wallTop], [cx, wallTop - roofRows * lineHeight], [right + cellWidth, wallTop]], color: "#3e2a24" });
      for (let r = 0; r < wallRows; r += 1) {
        const y = base - r * lineHeight;
        for (let c = -half; c <= half; c += 1) {
          const x = cx + c * cellWidth;
          const edge = Math.abs(c) === half;
          const window = r >= 1 && r <= wallRows - 2 && !edge && Math.abs(c) >= Math.round(2 * scale) && Math.abs(c) <= Math.round(3 * scale);
          const door = r < Math.max(2, wallRows - 1) && Math.abs(c) <= (scale > 1.3 ? 1 : 0);
          const cell = put(x, y, edge ? "|" : window ? "#" : door ? "]" : r === 0 ? "_" : ":", window ? "#e2b85e" : door ? "#4a3626" : "#7a7262");
          if (window) lights.push(cell);
        }
      }
      for (let r = 0; r < roofRows; r += 1) {
        const y = base - (wallRows + r) * lineHeight;
        const span = Math.round(half + 1 - (r * (half + 1)) / roofRows);
        for (let c = -span; c <= span; c += 1) {
          const glyph = c === -span ? "/" : c === span ? "\\" : r === roofRows - 1 ? "^" : "=";
          put(cx + c * cellWidth, y, glyph, "#5a3b2e");
        }
      }
      // Chimney.
      put(cx + (half - 2) * cellWidth, base - (wallRows + 1) * lineHeight, "|", "#5a4a3e");
      put(cx + (half - 2) * cellWidth, base - (wallRows + 2) * lineHeight, "|", "#5a4a3e");
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

  const ctx = { width, height, cellWidth, lineHeight, put, shapes, lights };
  if (structures.fence) addFence(structures.fence, ctx);
  if (structures.well) addWellSweep(structures.well, ctx);
  if (structures.church) addChurch(structures.church, ctx);
  const windmill = structures.windmill ? addWindmill(structures.windmill, ctx) : null;

  return { cells, lights, shapes, windmill };
}

/** Near banks (grassy or rocky) that frame the water at the sides of the view. */
export function createBankGlyphs(width, height, cellWidth, lineHeight) {
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
      if (banks.style === "cliff") {
        // Layered rock: horizontal strata with cracks, lighter toward the water's edge.
        const nearEdge = Math.min(Math.abs(x - leftEdge), Math.abs(x - rightEdge)) / width;
        const strata = (row + Math.floor(column / 7)) % 4 === 0;
        glyph = edge ? (x < width / 2 ? "\\" : "/") : strata ? (noise > 0.5 ? "=" : "-") : "#%:/\\.:#"[Math.floor(noise * 8)];
        color = edge ? "#7a7a6c" : nearEdge < 0.04 ? "#4c4f47" : noise < 0.3 ? "#232824" : strata ? "#3f443d" : "#30352f";
        if (!edge && noise > 0.9) continue;
      } else {
        glyph = edge ? "~" : ",'\"`.;,'"[Math.floor(noise * 8)];
        color = edge ? "#6a7a58" : noise < 0.5 ? "#3f5236" : "#56693f";
        if (!edge && noise > 0.8) continue;
      }
      cells.push({ x, y, column, row, glyph, color });
    }
  }
  return cells;
}

/* ---------- Village pieces for the pond ---------- */

/** Whitewashed clay cottages with thick thatched roofs and warm windows. */
function addMazanky({ from, to, count, scale = 1 }, { width, height, cellWidth, lineHeight, put, shapes, lights }) {
  for (let i = 0; i < count; i += 1) {
    const cx = width * (from + ((to - from) * (i + 0.5)) / count) + (hash2(i, 3, 5) - 0.5) * width * 0.02;
    const base = shorelineY(cx, height) - lineHeight * 0.9;
    const half = Math.round((6 + hash2(i, 7, 9) * 2) * scale);
    const wallRows = Math.round(3 * scale);
    const roofRows = Math.round(4 * scale);
    const left = cx - (half + 0.5) * cellWidth;
    const right = cx + (half + 0.5) * cellWidth;
    const wallTop = base - (wallRows - 0.5) * lineHeight;
    const eave = wallTop + lineHeight * 0.3;
    const ridgeY = wallTop - roofRows * lineHeight;
    shapes.push({ points: [[left, base + lineHeight * 0.5], [left, wallTop], [right, wallTop], [right, base + lineHeight * 0.5]], color: "#a9a493" });
    // A hipped thatch roof overhanging the walls.
    shapes.push({ points: [[left - cellWidth * 2, eave], [cx - half * 0.35 * cellWidth, ridgeY], [cx + half * 0.35 * cellWidth, ridgeY], [right + cellWidth * 2, eave]], color: "#6f5a2e" });
    for (let r = 0; r < wallRows; r += 1) {
      const y = base - r * lineHeight;
      for (let c = -half; c <= half; c += 1) {
        const edge = Math.abs(c) === half;
        const window = r >= 1 && r <= wallRows - 1 && Math.abs(c) >= Math.round(2.5 * scale) && Math.abs(c) <= Math.round(3.5 * scale) && !edge;
        const door = r < wallRows - 1 && c === -1;
        const glyph = edge ? "|" : window ? "#" : door ? "]" : r === 0 ? "_" : hash2(c, r + i * 7, 41) > 0.7 ? "." : " ";
        if (glyph === " ") continue;
        const cell = put(cx + c * cellWidth, y, glyph, window ? "#e2b85e" : door ? "#4a3626" : "#d2cdbb");
        if (window) lights.push(cell);
      }
    }
    for (let r = 0; r < roofRows; r += 1) {
      const y = eave - (r + 0.5) * lineHeight;
      const t = r / roofRows;
      const span = Math.round((half + 2) - t * (half + 2 - half * 0.35));
      for (let c = -span; c <= span; c += 1) {
        const glyph = c === -span ? "/" : c === span ? "\\" : r === roofRows - 1 ? "~" : hash2(c, r, 61 + i) > 0.5 ? "\"" : "'";
        put(cx + c * cellWidth, y, glyph, c === -span || c === span ? "#8a7038" : hash2(c, r, 67) > 0.4 ? "#c4a862" : "#a88c4e");
      }
    }
  }
}

/** A woven wattle fence along the far bank. */
function addFence({ from, to }, { width, height, cellWidth, lineHeight, put }) {
  for (let x = width * from, c = 0; x <= width * to; x += cellWidth, c += 1) {
    const y = shorelineY(x, height) - lineHeight * 0.75;
    put(x, y, c % 4 === 0 ? "|" : c % 2 ? "X" : "x", "#7a6040");
    if (c % 4 === 0) put(x, y - lineHeight, "'", "#7a6040");
  }
}

/** A well sweep: an upright post with a long tilted pole and a bucket on a rope. */
function addWellSweep({ x: fx }, { width, height, cellWidth, lineHeight, put }) {
  const x = width * fx;
  const ground = shorelineY(x, height) - lineHeight * 0.9;
  const postRows = Math.max(5, Math.round((height * 0.05) / lineHeight));
  for (let r = 0; r < postRows; r += 1) put(x, ground - r * lineHeight, r === postRows - 1 ? "Y" : "|", "#a08458");
  // Well box at the foot of the sweep.
  for (let c = 2; c <= 5; c += 1) put(x + c * cellWidth, ground, c === 2 || c === 5 ? "|" : "=", "#b4966a");
  // The pole: low end behind, high end over the well.
  const pivot = { x, y: ground - (postRows - 1) * lineHeight };
  const steps = Math.round(postRows * 2);
  let tip = pivot;
  for (let k = -Math.round(steps * 0.35); k <= steps; k += 1) {
    const px = pivot.x + k * cellWidth * 0.75;
    const py = pivot.y - k * lineHeight * 0.32;
    put(px, py, "/", "#b4966a");
    tip = { x: px, y: py };
  }
  for (let y = tip.y + lineHeight; y < ground - lineHeight * 1.5; y += lineHeight) put(tip.x, y, "|", "#8a7454");
  put(tip.x, ground - lineHeight, "U", "#c8aa76");
}

/** A small whitewashed church with an onion dome, a cross and a lit window. */
function addChurch({ x: fx }, { width, height, cellWidth, lineHeight, put, shapes, lights }) {
  const cx = width * fx;
  const base = shorelineY(cx, height) - lineHeight * 0.9;
  const half = 4;
  const wallRows = 5;
  const wallTop = base - (wallRows - 0.5) * lineHeight;
  const left = cx - (half + 0.5) * cellWidth;
  const right = cx + (half + 0.5) * cellWidth;
  shapes.push({ points: [[left, base + lineHeight * 0.5], [left, wallTop], [right, wallTop], [right, base + lineHeight * 0.5]], color: "#b4af9f" });
  for (let r = 0; r < wallRows; r += 1) {
    for (let c = -half; c <= half; c += 1) {
      const edge = Math.abs(c) === half;
      const window = c === 0 && (r === 2 || r === 3);
      const glyph = edge ? "|" : window ? (r === 3 ? "n" : "#") : r === 0 ? "_" : "";
      if (!glyph) continue;
      const cell = put(cx + c * cellWidth, base - r * lineHeight, glyph, window ? "#e2b85e" : "#dcd7c6");
      if (window) lights.push(cell);
    }
  }
  // Drum, onion dome and cross.
  const drumTop = wallTop - lineHeight * 1.5;
  shapes.push({ points: [[cx - 2.5 * cellWidth, wallTop], [cx - 2.5 * cellWidth, drumTop], [cx + 2.5 * cellWidth, drumTop], [cx + 2.5 * cellWidth, wallTop]], color: "#b4af9f" });
  put(cx - 2 * cellWidth, wallTop - lineHeight * 0.7, "|", "#dcd7c6");
  put(cx + 2 * cellWidth, wallTop - lineHeight * 0.7, "|", "#dcd7c6");
  const dome = [[-3, "("], [-2, "@"], [-1, "@"], [0, "@"], [1, "@"], [2, "@"], [3, ")"]];
  const domeBase = drumTop - lineHeight * 0.5;
  shapes.push({
    points: [[cx - 3.2 * cellWidth, drumTop], [cx - 3.6 * cellWidth, drumTop - lineHeight * 1.2], [cx - 1.6 * cellWidth, drumTop - lineHeight * 2.6], [cx, drumTop - lineHeight * 3.4], [cx + 1.6 * cellWidth, drumTop - lineHeight * 2.6], [cx + 3.6 * cellWidth, drumTop - lineHeight * 1.2], [cx + 3.2 * cellWidth, drumTop]],
    color: "#b8903a",
  });
  for (const [c, glyph] of dome) put(cx + c * cellWidth, drumTop - lineHeight * 1.1, glyph, "#e2b85e");
  for (let c = -1; c <= 1; c += 1) put(cx + c * cellWidth, drumTop - lineHeight * 2.2, c ? (c < 0 ? "/" : "\\") : "^", "#e8c46a");
  put(cx, drumTop - lineHeight * 3.4, "|", "#e8c46a");
  put(cx, drumTop - lineHeight * 4.3, "+", "#f0d48a");
}

/** A post windmill on the hill; its sails are animated by the renderer. */
function addWindmill({ x: fx }, { width, height, cellWidth, lineHeight, put, shapes }) {
  const { ridges } = activeScene();
  const x = width * fx;
  const ground = (ridges.length ? ridgeTop(ridges[0], x, height) : shorelineY(x, height)) + lineHeight * 1.2;
  const rows = Math.max(8, Math.round((height * 0.1) / lineHeight));
  const top = ground - rows * lineHeight;
  shapes.push({ points: [[x - 5 * cellWidth, ground + lineHeight * 0.5], [x - 2.5 * cellWidth, top], [x + 2.5 * cellWidth, top], [x + 5 * cellWidth, ground + lineHeight * 0.5]], color: "#4e4032" });
  for (let r = 0; r < rows; r += 1) {
    const spread = Math.round(4.5 - (r / rows) * 2);
    put(x - spread * cellWidth, ground - r * lineHeight, "/", "#7a6448");
    put(x + spread * cellWidth, ground - r * lineHeight, "\\", "#7a6448");
    if (r % 2) put(x, ground - r * lineHeight, "#", "#6a5640");
  }
  for (let c = -2; c <= 2; c += 1) put(x + c * cellWidth, top - lineHeight * 0.5, c === 0 ? "^" : c < 0 ? "/" : "\\", "#8a7254");
  return { x, y: top + lineHeight * 0.6, length: height * 0.11 };
}
