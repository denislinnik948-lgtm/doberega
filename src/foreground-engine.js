import { hash01, hash2 } from "./noise.js";
import { activeScene } from "./scene.js";

/**
 * Close-up shore details: reeds and cattails framing the bottom corners, a
 * weathered rock at the water's edge, and a few lily pads floating nearby.
 */
export function createReeds(width, height, frame = { left: 0, width }) {
  // Reeds frame the visible part of the view, which on a phone is narrower than the scene.
  const left = frame.left;
  width = frame.width;
  const reeds = [];
  const { reeds: density = 1, oak } = activeScene().foreground;
  const perSide = Math.round(Math.max(10, Math.min(30, width / 46)) * density);

  for (const side of [-1, 1]) {
    // Where the oak stands on the left there are no reeds, only grass about its roots.
    const underOak = oak && side < 0;
    for (let i = 0; i < (underOak ? Math.round(perSide * 0.3) : perSide); i += 1) {
      const seed = 7000 + (side + 1) * 500 + i;
      // Most stalks crowd the screen edge; a few stray toward the open water.
      const reach = hash01(seed * 3) ** 1.7 * (underOak ? 0.14 : 0.24);
      const baseX = left + (side < 0 ? width * (reach - 0.015) : width * (1.015 - reach));
      const edgeBoost = 1 - reach / 0.24;
      const kindRoll = hash01(seed * 5);
      const kind = underOak ? "grass" : kindRoll < 0.24 ? "cattail" : kindRoll < 0.4 ? "grass" : "blade";
      const length = height * (kind === "grass" ? 0.06 + hash01(seed * 7) * 0.08 : 0.13 + hash01(seed * 7) * 0.2 + edgeBoost * 0.1);

      reeds.push({
        baseX,
        baseY: height + 6,
        length,
        kind,
        lean: (hash01(seed * 11) - 0.5) * 0.3 - side * 0.06,
        curve: (hash01(seed * 13) - 0.5) * (kind === "blade" ? 0.55 : 0.18),
        phase: hash01(seed * 17) * Math.PI * 2,
        flex: kind === "cattail" ? 0.045 : 0.075,
        lit: hash01(seed * 19) > 0.55,
        depth: hash01(seed * 23),
      });
    }
  }

  // Draw the shortest, farthest stalks first.
  return reeds.sort((a, b) => a.depth - b.depth);
}

/** Lily pads snap to the water grid so they read as part of the same ASCII field. */
export function createLilyPads(width, height, cellWidth, lineHeight, frame = { left: 0, width }) {
  const left = frame.left;
  width = frame.width;
  const { lilyPads: count = 5, padScale = 1.2 } = activeScene().foreground;
  const pads = [
    { x: 0.27, y: 0.8, r: 0.034, flower: false },
    { x: 0.31, y: 0.885, r: 0.046, flower: true },
    { x: 0.585, y: 0.75, r: 0.022, flower: false },
    { x: 0.655, y: 0.935, r: 0.05, flower: true },
    { x: 0.7, y: 0.86, r: 0.026, flower: false },
  ];
  // A weedy pond gets extra pads, scattered toward the banks.
  for (let i = pads.length; i < count; i += 1) {
    const side = i % 2 ? 1 : -1;
    pads.push({
      x: 0.5 + side * (0.18 + hash01(i * 13) * 0.24),
      y: 0.62 + hash01(i * 29) * 0.3,
      r: 0.018 + hash01(i * 31) * 0.026,
      flower: hash01(i * 37) > 0.6,
    });
  }
  pads.length = count;

  return pads.map((pad, index) => {
    const cx = left + width * pad.x;
    const cy = height * pad.y;
    const rx = Math.max(cellWidth * 5, Math.min(width, height * 1.6) * pad.r * padScale);
    const ry = rx * 0.34;
    const notch = hash01(index * 97 + 5) * Math.PI * 2;
    const cells = [];

    for (let row = Math.floor((cy - ry) / lineHeight); row <= Math.ceil((cy + ry) / lineHeight); row += 1) {
      const y = (row + 0.52) * lineHeight;
      for (let column = Math.floor((cx - rx) / cellWidth); column <= Math.ceil((cx + rx) / cellWidth); column += 1) {
        const x = (column + 0.5) * cellWidth;
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const distance = nx * nx + ny * ny;
        if (distance > 1) continue;
        const angle = Math.atan2(ny, nx);
        const notchDelta = Math.abs(((angle - notch + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (notchDelta < 0.28 && distance > 0.08) continue;

        const noise = hash2(column, row, 211 + index);
        let glyph;
        if (distance > 0.62) glyph = nx < -0.55 ? "(" : nx > 0.55 ? ")" : ny > 0 ? "_" : "-";
        else glyph = noise < 0.3 ? "~" : noise < 0.55 ? "=" : noise < 0.75 ? "-" : ".";
        cells.push({ x, y, column, row, glyph, color: ny < -0.2 && noise > 0.35 ? "#a8c472" : noise < 0.25 ? "#4f7040" : "#6f9452" });
      }
    }

    const flower = pad.flower
      ? [
        { dx: -cellWidth, dy: -lineHeight * 0.9, glyph: "(", color: "#d9a5ab" },
        { dx: 0, dy: -lineHeight * 0.9, glyph: "@", color: "#ecc777" },
        { dx: cellWidth, dy: -lineHeight * 0.9, glyph: ")", color: "#d9a5ab" },
        { dx: 0, dy: -lineHeight * 1.8, glyph: "^", color: "#e6b9bd" },
      ].map((petal) => ({ ...petal, x: cx + petal.dx, y: cy + petal.dy }))
      : [];

    return { cx, cy, rx, ry, cells, flower, phase: index * 1.9 };
  });
}

/**
 * Foreground boulders: a rounded rock at the lake, or angular concrete blocks
 * at the reservoir. Returns a (possibly empty) list.
 */
export function createRocks(width, height, sunX, frame = { left: 0, width }) {
  const left = frame.left;
  width = frame.width;
  const { rock, blocks } = activeScene().foreground;
  const size = Math.min(width, height * 1.5);
  const make = (cx, rx, ry, kind) => {
    const outline = [];
    for (let i = 0; i <= 40; i += 1) {
      const angle = Math.PI + (i / 40) * Math.PI;
      const bump = kind === "block"
        ? 1 / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)) * 1.15) ** 0.35
        : 1 + Math.sin(angle * 5 + 1.3) * 0.05 + Math.sin(angle * 11) * 0.025;
      outline.push({ x: cx + Math.cos(angle) * rx * bump, y: height * 1.01 + Math.sin(angle) * ry * bump * (1 + Math.cos(angle) * 0.18) });
    }
    return { cx, baseY: height * 1.01, rx, ry, outline, kind, litSide: sunX > cx ? 1 : -1 };
  };
  const rocks = [];
  if (rock) rocks.push(make(left + width * 0.135, size * 0.11, size * 0.065, "rock"));
  if (blocks) {
    rocks.push(make(left + width * 0.1, size * 0.13, size * 0.08, "block"));
    rocks.push(make(left + width * 0.28, size * 0.07, size * 0.05, "block"));
    rocks.push(make(left + width * 0.9, size * 0.12, size * 0.07, "block"));
  }
  return rocks;
}

export function rockGlyphs(rock, cellWidth, lineHeight) {
  const cells = [];
  for (let row = Math.floor((rock.baseY - rock.ry * 1.3) / lineHeight); row * lineHeight < rock.baseY; row += 1) {
    const y = (row + 0.5) * lineHeight;
    for (let column = Math.floor((rock.cx - rock.rx) / cellWidth); column <= Math.ceil((rock.cx + rock.rx) / cellWidth); column += 1) {
      const x = (column + 0.5) * cellWidth;
      const nx = (x - rock.cx) / rock.rx;
      const ny = (rock.baseY - y) / rock.ry;
      const distance = nx * nx + ny * ny;
      if (distance > 0.92) continue;
      const noise = hash2(column, row, 503);
      const top = distance > 0.62 && ny > 0.3;
      const lit = nx * rock.litSide > 0.05 && ny > 0.35;
      const concrete = rock.kind === "block";
      const glyph = top ? (noise > 0.5 ? "_" : concrete ? "=" : ".") : (concrete ? "[]=#|:" : "#%&@8$")[Math.floor(noise * 6)];
      const color = concrete
        ? (lit ? (top ? "#b9bcb2" : "#8a8f88") : ny < 0.25 ? "#3a3f3c" : "#5f6560")
        : (lit ? (top ? "#a39c7e" : "#6f6f63") : ny < 0.25 ? "#2c3330" : "#474e48");
      if (!top && noise < 0.12) continue;
      cells.push({ x, y, glyph, color });
    }
  }
  return cells;
}
