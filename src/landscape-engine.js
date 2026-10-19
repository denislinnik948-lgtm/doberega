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
  const put = (x, y, glyph, color, extra = {}) => {
    const cell = { ...cellAt(x, y, cellWidth, lineHeight), glyph, color, ...extra };
    cells.push(cell);
    return cell;
  };

  if (structures.houses) {
    // Either explicit spots (`at`) or `count` houses spread evenly over from..to.
    const { from = 0, to = 1, count = 0, at, scale = 1 } = structures.houses;
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

  if (structures.castle) addCastle(structures.castle, width, height, cellWidth, lineHeight, { cells, lights, shapes });

  return { cells, lights, shapes };
}

/**
 * A stone castle on a rocky hill above the far shore: curtain wall with a gate,
 * corner towers under tiled cones, a tall keep, banners, and windows and
 * torches that glow at dusk.
 */
function addCastle({ x: fx, width: fw }, width, height, cellWidth, lineHeight, out) {
  const grid = new Map();
  const put = (x, y, glyph, color, light = false) => {
    const cell = { ...cellAt(x, y, cellWidth, lineHeight), glyph, color };
    grid.set(`${cell.column},${cell.row}`, { cell, light });
  };
  const rowsOf = (fraction) => Math.max(2, Math.round((height * fraction) / lineHeight));
  const cx = width * fx;
  const halfWidth = (width * fw) / 2;
  const shore = shorelineY(cx, height) - lineHeight * 0.3;
  const hillRows = rowsOf(0.075);
  const ground = shore - hillRows * lineHeight;
  const stone = (column, row, lit) => {
    const noise = hash2(column, row, 1501);
    return lit ? (noise > 0.4 ? "#a8a28c" : "#8f8a76") : noise > 0.5 ? "#6c685a" : "#5a574b";
  };

  // Rocky hill, wider at the waterline.
  const hillBase = halfWidth * 1.45;
  // Craggy sides: the slope bulges and steps rather than running straight.
  const spanAt = (t) => hillBase + (halfWidth * 1.08 - hillBase) * Math.sqrt(t) + Math.sin(t * 9) * cellWidth * 1.2;
  const outline = [];
  for (let i = 0; i <= 8; i += 1) outline.push([cx - spanAt(i / 8), shore + lineHeight * 0.5 - (i / 8) * (shore - ground + lineHeight * 0.5)]);
  for (let i = 8; i >= 0; i -= 1) outline.push([cx + spanAt(i / 8), shore + lineHeight * 0.5 - (i / 8) * (shore - ground + lineHeight * 0.5)]);
  out.shapes.push({ points: outline, color: "#2f302a" });
  for (let r = 0; r <= hillRows; r += 1) {
    const t = r / hillRows;
    const span = spanAt(t);
    const y = shore - r * lineHeight;
    for (let x = cx - span; x <= cx + span; x += cellWidth) {
      const noise = hash2(Math.round(x / cellWidth), r, 1777);
      const edge = x < cx - span + cellWidth || x > cx + span - cellWidth;
      const glyph = edge ? (x < cx ? "/" : "\\") : t < 0.3 && noise > 0.6 ? "," : "#%:^.&"[Math.floor(noise * 6)];
      put(x, y, glyph, t < 0.3 && noise > 0.6 ? "#4f6b3a" : noise > 0.7 ? "#6e6a5a" : "#45443b");
    }
  }

  // A block of masonry with optional battlements, slits and lit windows.
  const block = (centerX, half, rows, { merlons = true, windows = [] } = {}) => {
    const x0 = centerX - (half + 0.5) * cellWidth;
    const x1 = centerX + (half + 0.5) * cellWidth;
    const top = ground - (rows - 0.5) * lineHeight;
    out.shapes.push({ points: [[x0, ground + lineHeight * 0.5], [x0, top], [x1, top], [x1, ground + lineHeight * 0.5]], color: "#4a483f" });
    for (let r = 0; r < rows; r += 1) {
      const y = ground - r * lineHeight;
      for (let c = -half; c <= half; c += 1) {
        const x = centerX + c * cellWidth;
        const column = Math.round(x / cellWidth);
        const lit = c < 0;
        const window = windows.find(([wr, wc]) => wr === r && wc === c);
        if (window) {
          put(x, y, window[2] ? "#" : "|", window[2] ? "#e2b85e" : "#262520", window[2]);
          continue;
        }
        const glyph = Math.abs(c) === half ? "|" : (r + (c & 1)) % 3 === 0 ? "=" : hash2(column, r, 31) > 0.5 ? ":" : "#";
        put(x, y, glyph, stone(column, r, lit));
      }
    }
    if (merlons) {
      for (let c = -half; c <= half; c += 2) put(centerX + c * cellWidth, ground - rows * lineHeight, "#", stone(c, rows, c < 0));
    }
    return ground - rows * lineHeight;
  };

  // Tiled cone on a tower, with a banner on a pole at the top.
  const cone = (centerX, half, base, flag) => {
    const rows = half + 2;
    out.shapes.push({ points: [[centerX - (half + 1.5) * cellWidth, base + lineHeight * 0.5], [centerX, base - (rows - 0.5) * lineHeight], [centerX + (half + 1.5) * cellWidth, base + lineHeight * 0.5]], color: "#4a2620" });
    for (let r = 0; r < rows; r += 1) {
      const span = Math.max(0, Math.round(half + 1 - ((half + 1) * r) / (rows - 1)));
      for (let c = -span; c <= span; c += 1) {
        const glyph = r === rows - 1 ? "^" : c === -span ? "/" : c === span ? "\\" : "=";
        put(centerX + c * cellWidth, base - r * lineHeight, glyph, c < 0 ? "#8a4a36" : "#6a3428");
      }
    }
    if (flag) banner(centerX, base - rows * lineHeight);
  };
  const banner = (x, y) => {
    put(x, y, "|", "#3a3530");
    put(x, y - lineHeight, "|", "#3a3530");
    put(x + cellWidth, y - lineHeight, ">", "#c0503c");
    put(x + cellWidth * 2, y - lineHeight, "~", "#a8402f");
  };

  const wallRows = rowsOf(0.05);
  const towerRows = rowsOf(0.1);
  const keepRows = rowsOf(0.14);
  const towerHalf = 2;

  // Back to front: keep and slender tower, then corner towers, then the wall.
  const keepX = cx + halfWidth * 0.18;
  const keepTop = block(keepX, 4, keepRows, {
    windows: [[keepRows - 3, -2, true], [keepRows - 3, 2, true], [keepRows - 6, 0, true], [wallRows + 1, -2, false], [wallRows + 1, 2, false]],
  });
  banner(keepX, keepTop - lineHeight);
  const turretX = cx - halfWidth * 0.32;
  const turretTop = block(turretX, 1, rowsOf(0.12), { merlons: false, windows: [[rowsOf(0.12) - 3, 0, true]] });
  cone(turretX, 1, turretTop, true);
  for (const side of [-1, 1]) {
    const x = cx + side * halfWidth;
    const top = block(x, towerHalf, towerRows, { merlons: false, windows: [[towerRows - 3, 0, side > 0], [wallRows - 1, 0, false]] });
    cone(x, towerHalf, top, side < 0);
  }
  const wallTop = block(cx, Math.round((halfWidth - towerHalf * cellWidth) / cellWidth), wallRows);

  // Arched gate with a torch either side.
  const gateX = cx - halfWidth * 0.15;
  for (let r = 0; r < Math.min(3, wallRows - 1); r += 1) {
    for (let c = -1; c <= 1; c += 1) {
      const glyph = r === 2 ? (c === 0 ? "_" : c < 0 ? "(" : ")") : c === 0 ? " " : c < 0 ? "(" : ")";
      put(gateX + c * cellWidth, ground - r * lineHeight, glyph === " " ? "." : glyph, glyph === " " ? "#14120f" : "#3a3630");
    }
  }
  put(gateX - cellWidth * 2.2, ground - lineHeight * 2, "*", "#ffa040", true);
  put(gateX + cellWidth * 2.2, ground - lineHeight * 2, "*", "#ffa040", true);
  put(cx + halfWidth * 0.55, wallTop, "*", "#ffa040", true);

  for (const { cell, light } of grid.values()) {
    out.cells.push(cell);
    if (light) out.lights.push(cell);
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
      }
      cells.push({ x, y, column, row, glyph, color });
    }
  }
  return cells;
}
