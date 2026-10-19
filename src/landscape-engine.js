import { hash2 } from "./noise.js";
import { activeScene, bankWidths, shorelineY, view } from "./scene.js";

const triangle = (v) => 1 - Math.abs((((v % 2) + 2) % 2) - 1);

export function ridgeTop(ridge, x, height) {
  const s = ridge.seed;
  if (ridge.jagged) {
    // Alpine ridgeline: sharp crests, rising toward one side of the view.
    const u = x / view.width;
    const [from, to] = ridge.rise ?? [0, 0];
    const ramp = to > from ? Math.min(1, Math.max(0, (u - from) / (to - from))) ** 0.8 : 1;
    const crest = 0.5 * triangle(x * 0.0024 + s) + 0.32 * triangle(x * 0.0067 + s * 1.3) + 0.18 * triangle(x * 0.017 + s * 2);
    return height * (ridge.top - ridge.amplitude * ramp * (0.45 + 0.55 * crest));
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

export const SNOW_FILL = "#d6dfe5";

/** The snowline at x: snow covers whatever rises above it, ragged where gullies cut down. */
export function snowLine(ridge, x, height) {
  const gullies = Math.max(0, Math.sin(x * 0.045 + ridge.seed)) ** 6 * 0.05 + Math.max(0, Math.sin(x * 0.13)) ** 8 * 0.025;
  return height * (ridge.snowline + gullies + 0.012 * Math.sin(x * 0.021));
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

        // Snow caps: white glyphs on a pale fill down from the crest.
        const snowy = ridge.snowline && y < snowLine(ridge, x, height);
        if (snowy && !glyph && noise < 0.55) glyph = "^*'."[Math.floor(noise * 7) % 4];
        cells.push({
          x, y, column, row, glyph,
          color: snowy ? (noise > 0.3 ? "#f2f6f8" : "#c8d4dc") : ridge.glyph,
          fill: snowy ? SNOW_FILL : ridge.fill,
          ridge: ridgeIndex,
        });
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

  const out = { cells, lights, shapes, wheels: [] };
  if (structures.crag) addCrag(structures.crag, width, height, cellWidth, lineHeight, out);
  if (structures.church) addChurch(structures.church, width, height, cellWidth, lineHeight, out);
  if (structures.archBridge) addArchBridge(structures.archBridge, width, height, cellWidth, lineHeight, out);
  if (structures.mill) addMill(structures.mill, width, height, cellWidth, lineHeight, out);

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

/** A watermill: a timber house under a thatched roof, its wheel turning in the river. */
function addMill({ x: fx }, width, height, cellWidth, lineHeight, out) {
  const cx = width * fx;
  const base = shorelineY(cx, height) - lineHeight * 0.6;
  const half = 5;
  const wallRows = Math.max(3, Math.round((height * 0.04) / lineHeight));
  const roofRows = 4;
  const left = cx - (half + 0.5) * cellWidth;
  const right = cx + (half + 0.5) * cellWidth;
  const wallTop = base - (wallRows - 0.5) * lineHeight;
  out.shapes.push({ points: [[left, base + lineHeight * 0.5], [left, wallTop], [right, wallTop], [right, base + lineHeight * 0.5]], color: "#4a3a2c" });
  out.shapes.push({ points: [[left - cellWidth * 1.5, wallTop], [cx, wallTop - roofRows * lineHeight], [right + cellWidth * 1.5, wallTop]], color: "#5e4e2c" });
  for (let r = 0; r < wallRows; r += 1) {
    const y = base - r * lineHeight;
    for (let c = -half; c <= half; c += 1) {
      const cell = cellAt(cx + c * cellWidth, y, cellWidth, lineHeight);
      const edge = Math.abs(c) === half;
      // Half-timbering: dark posts and a cross brace over pale daub.
      const timber = edge || c === 0 || r === wallRows - 1 || (r === 1 && Math.abs(c) === 3);
      const window = r === wallRows - 2 && Math.abs(c) === 2;
      out.cells.push({ ...cell, glyph: window ? "#" : timber ? (edge || c === 0 ? "|" : "=") : r === 0 ? "_" : ".", color: window ? "#e2b85e" : timber ? "#4a3626" : "#b0a488" });
      if (window) out.lights.push(out.cells[out.cells.length - 1]);
    }
  }
  for (let r = 0; r < roofRows; r += 1) {
    const span = Math.round(half + 2 - (r * (half + 2)) / roofRows);
    for (let c = -span; c <= span; c += 1) {
      const cell = cellAt(cx + c * cellWidth, base - (wallRows + r) * lineHeight, cellWidth, lineHeight);
      const glyph = c === -span ? "/" : c === span ? "\\" : r === roofRows - 1 ? "^" : "\"';,"[Math.floor(hash2(cell.column, cell.row, 61) * 4)];
      out.cells.push({ ...cell, glyph, color: c < 0 ? "#a08a52" : "#7e6a3c" });
    }
  }
  // The wheel turns every frame, so the renderer draws it from this description.
  const radius = Math.max(3, (height * 0.055) / lineHeight) * lineHeight;
  const wheel = { x: right + radius * 1.1, y: base - radius * 0.55, radius };
  out.wheels.push(wheel);
  // A dark disc behind the turning wheel keeps it legible against the trees.
  const disc = [];
  for (let k = 0; k < 24; k += 1) {
    const a = (k / 24) * Math.PI * 2;
    disc.push([wheel.x + Math.cos(a) * radius * 1.12, wheel.y + Math.sin(a) * radius * 0.92]);
  }
  out.shapes.push({ points: disc, color: "#1a140e" });
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
    const crowns = u < 0.1 || u > 0.35 ? Math.abs(Math.sin(x * 0.09)) * lineHeight * 0.9 : 0;
    return horizon - lift + crowns;
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
  out.shapes.push({ points: outline, color: "#1f3a1d" });
  const cliff = [];
  for (let x = width * 0.12; x <= width * 0.34; x += cellWidth) cliff.push([x, skyline(x) - lineHeight * 0.3]);
  for (let x = width * 0.34; x >= width * 0.12; x -= cellWidth) cliff.push([x, skyline(x) + cliffDepth(x)]);
  out.shapes.push({ points: cliff, color: "#5c5d58" });

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
        // Dense spring-green woods, lighter on the crowns.
        const lit = hash2(column, row + 1, 4101) > noise;
        out.cells.push({ x, y, column, row, glyph: "oO*+&@o"[Math.floor(noise * 7)], color: lit ? (noise > 0.6 ? "#7fae4a" : "#5f9238") : noise > 0.5 ? "#3d6a2a" : "#2c5020" });
      }
    }
  }

  // Castle on the plateau: two long halls, a small turret, a round tower on the cliff edge.
  const ground = plateau;
  const rowsOf = (fraction) => Math.max(2, Math.round((height * fraction) / lineHeight));
  const hall = (from, to2, rows, groundY) => {
    const x0 = width * from;
    const x1 = width * to2;
    const top = groundY - rows * lineHeight;
    out.shapes.push({ points: [[x0, groundY + lineHeight * 0.5], [x0, top + lineHeight * 0.5], [x1, top + lineHeight * 0.5], [x1, groundY + lineHeight * 0.5]], color: "#b8ae94" });
    for (let r = 0; r < rows; r += 1) {
      for (let x = x0 + cellWidth / 2; x < x1; x += cellWidth) {
        const cell = cellAt(x, groundY - r * lineHeight, cellWidth, lineHeight);
        const window = r === rows - 1 && cell.column % 3 === 1;
        out.cells.push({ ...cell, glyph: window ? "#" : r === 0 ? "_" : ":", color: window ? "#e2b85e" : hash2(cell.column, r, 5) > 0.5 ? "#e0d8c0" : "#cbc2a8" });
        if (window && hash2(cell.column, r, 9) > 0.4) out.lights.push(out.cells[out.cells.length - 1]);
      }
    }
    roof(x0, x1, top);
  };
  const roof = (x0, x1, base) => {
    const rows = 2;
    out.shapes.push({ points: [[x0 - cellWidth * 0.5, base + lineHeight * 0.5], [x0 + cellWidth * 1.5, base - (rows - 0.5) * lineHeight], [x1 - cellWidth * 1.5, base - (rows - 0.5) * lineHeight], [x1 + cellWidth * 0.5, base + lineHeight * 0.5]], color: "#8a3622" });
    for (let r = 0; r < rows; r += 1) {
      for (let x = x0 + r * cellWidth; x < x1 - r * cellWidth; x += cellWidth) {
        const cell = cellAt(x, base - r * lineHeight, cellWidth, lineHeight);
        const edge = x < x0 + (r + 1) * cellWidth ? "/" : x >= x1 - (r + 1) * cellWidth ? "\\" : "=";
        out.cells.push({ ...cell, glyph: edge, color: r === rows - 1 ? "#d0613e" : "#b04a30" });
      }
    }
  };
  const tower = (fx, rows, groundY) => {
    const x = width * fx;
    for (let r = 0; r < rows; r += 1) {
      for (const c of [-1, 0, 1]) {
        const cell = cellAt(x + c * cellWidth, groundY - r * lineHeight, cellWidth, lineHeight);
        out.cells.push({ ...cell, glyph: c === 0 && r === rows - 2 ? "#" : c < 0 ? "(" : c > 0 ? ")" : ":", color: c === 0 && r === rows - 2 ? "#e2b85e" : c < 0 ? "#e4dcc4" : "#b8ae94" });
      }
    }
    out.shapes.push({ points: [[x - cellWidth * 1.5, groundY + lineHeight * 0.5], [x - cellWidth * 1.5, groundY - (rows - 0.5) * lineHeight], [x + cellWidth * 1.5, groundY - (rows - 0.5) * lineHeight], [x + cellWidth * 1.5, groundY + lineHeight * 0.5]], color: "#b8ae94" });
    const coneBase = groundY - rows * lineHeight;
    out.shapes.push({ points: [[x - cellWidth * 2, coneBase + lineHeight * 0.5], [x, coneBase - 2.5 * lineHeight], [x + cellWidth * 2, coneBase + lineHeight * 0.5]], color: "#8a3622" });
    for (let r = 0; r < 3; r += 1) {
      const span = 1 - Math.floor(r / 2);
      for (let c = -span; c <= span; c += 1) {
        const cell = cellAt(x + c * cellWidth, coneBase - r * lineHeight, cellWidth, lineHeight);
        out.cells.push({ ...cell, glyph: r === 2 ? "^" : c < 0 ? "/" : c > 0 ? "\\" : "A", color: c <= 0 ? "#d0613e" : "#a8442c" });
      }
    }
  };
  // Grey retaining wall along the cliff top.
  for (let x = width * 0.1; x < width * 0.31; x += cellWidth) {
    const cell = cellAt(x, ground + lineHeight * 0.6, cellWidth, lineHeight);
    out.cells.push({ ...cell, glyph: "=", color: "#9a9a8e" });
  }
  hall(0.1, 0.175, rowsOf(0.038), ground);
  hall(0.175, 0.26, rowsOf(0.028), ground);
  tower(0.205, rowsOf(0.05), ground - rowsOf(0.028) * lineHeight * 0.4);
  tower(0.3, rowsOf(0.055), ground + height * 0.025);
}

/** A white church with a tall slate spire on the far shore. */
function addChurch({ x: fx }, width, height, cellWidth, lineHeight, out) {
  const cx = width * fx;
  const base = shorelineY(cx, height) - lineHeight * 1.2;
  const rows = Math.max(3, Math.round((height * 0.035) / lineHeight));
  const half = 4;
  const x0 = cx - (half + 0.5) * cellWidth;
  const x1 = cx + (half + 0.5) * cellWidth;
  const top = base - (rows - 0.5) * lineHeight;
  out.shapes.push({ points: [[x0, base + lineHeight * 0.5], [x0, top], [x1, top], [x1, base + lineHeight * 0.5]], color: "#c8c4b8" });
  out.shapes.push({ points: [[x0 - cellWidth, top], [cx - cellWidth, top - 2.5 * lineHeight], [x1 + cellWidth, top]], color: "#4a4e52" });
  for (let r = 0; r < rows; r += 1) {
    for (let c = -half; c <= half; c += 1) {
      const cell = cellAt(cx + c * cellWidth, base - r * lineHeight, cellWidth, lineHeight);
      const window = r === rows - 2 && c % 3 === 0 && Math.abs(c) < half;
      out.cells.push({ ...cell, glyph: window ? "#" : c === -half || c === half ? "|" : ":", color: window ? "#e2b85e" : c < 0 ? "#eeeae0" : "#d4d0c4" });
      if (window) out.lights.push(out.cells[out.cells.length - 1]);
    }
  }
  for (let r = 0; r < 3; r += 1) {
    for (let c = -half - 1 + r * 2; c <= half - r * 2; c += 1) {
      const cell = cellAt(cx + c * cellWidth, top - (r + 0.5) * lineHeight, cellWidth, lineHeight);
      out.cells.push({ ...cell, glyph: c === -half - 1 + r * 2 ? "/" : "=", color: "#6a6e72" });
    }
  }
  // Bell tower and a needle spire.
  const tx = cx + (half + 2) * cellWidth;
  const towerRows = Math.max(5, Math.round((height * 0.075) / lineHeight));
  const spireRows = Math.max(4, Math.round((height * 0.07) / lineHeight));
  out.shapes.push({ points: [[tx - cellWidth * 1.5, base + lineHeight * 0.5], [tx - cellWidth * 1.5, base - (towerRows - 0.5) * lineHeight], [tx + cellWidth * 1.5, base - (towerRows - 0.5) * lineHeight], [tx + cellWidth * 1.5, base + lineHeight * 0.5]], color: "#d8d4c8" });
  for (let r = 0; r < towerRows; r += 1) {
    for (const c of [-1, 0, 1]) {
      const cell = cellAt(tx + c * cellWidth, base - r * lineHeight, cellWidth, lineHeight);
      const opening = c === 0 && r === towerRows - 2;
      out.cells.push({ ...cell, glyph: opening ? "n" : c ? "|" : ":", color: opening ? "#3a3c3e" : c < 0 ? "#f2eee4" : "#cfcbbf" });
    }
  }
  const spireBase = base - towerRows * lineHeight;
  out.shapes.push({ points: [[tx - cellWidth * 1.4, spireBase + lineHeight * 0.5], [tx, spireBase - (spireRows - 0.5) * lineHeight], [tx + cellWidth * 1.4, spireBase + lineHeight * 0.5]], color: "#4a4e52" });
  for (let r = 0; r < spireRows; r += 1) {
    const cell = cellAt(tx, spireBase - r * lineHeight, cellWidth, lineHeight);
    out.cells.push({ ...cell, glyph: r === spireRows - 1 ? "+" : r > spireRows * 0.5 ? "|" : "A", color: r === spireRows - 1 ? "#d0b060" : "#7a7e82" });
  }
}
