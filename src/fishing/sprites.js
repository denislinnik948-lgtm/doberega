import { P } from "./palette.js";

/**
 * Procedural 16-bit sprites for the game UI: fish, rods, bait and icons.
 * Each sprite is a small pixel grid drawn on a canvas and scaled up with
 * nearest-neighbour filtering, so it stays crisp at any size.
 */

function hash(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * amount)));
  return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1)}`;
}

class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height).fill(null);
  }

  set(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.cells[y * this.width + x] = color;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.cells[y * this.width + x];
  }

  /** One-pixel dark outline around everything drawn so far. */
  outline(color) {
    const add = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.set(x, y, color);
    return this;
  }

  toCanvas(scale, label = "") {
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d");
    this.cells.forEach((color, index) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(index % this.width, Math.floor(index / this.width), 1, 1);
    });
    canvas.className = "sprite";
    canvas.style.width = `${this.width * scale}px`;
    canvas.style.height = `${this.height * scale}px`;
    if (label) canvas.setAttribute("aria-label", label);
    else canvas.setAttribute("aria-hidden", "true");
    return canvas;
  }
}

function fromRows(rows, palette) {
  const grid = new Grid(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (palette[key]) grid.set(x, y, palette[key]);
  }));
  return grid;
}

/* ---------- Fish ---------- */

// Species keep recognisable markings but share the UI palette.
const FISH_LOOKS = {
  plitka: { len: 30, h: 11, back: P.mid, side: P.light, belly: P.bone, fin: P.ember, eye: P.ember },
  karas: { len: 30, h: 15, back: P.goldDark, side: P.gold, belly: P.bone, fin: P.goldDark, eye: P.bone, scales: true },
  okun: { len: 32, h: 13, back: P.dark, side: P.soft, belly: P.light, fin: P.ember, eye: P.gold, bars: true, spiny: true },
  lyasch: { len: 34, h: 18, back: P.mid, side: P.soft, belly: P.light, fin: P.dark, eye: P.bone },
  korop: { len: 40, h: 16, back: P.goldDark, side: P.gold, belly: P.bone, fin: P.goldDark, eye: P.bone, scales: true, barbels: true },
  shchuka: { len: 50, h: 10, back: P.dark, side: P.mid, belly: P.light, fin: P.soft, eye: P.gold, spots: true, snout: true, dorsalBack: true, roundTail: true },
  som: { len: 50, h: 12, back: P.deep, side: P.dark, belly: P.soft, fin: P.deep, eye: P.light, whiskers: true, broadHead: true, mottled: true, roundTail: true },
  yorzh: { len: 20, h: 8, back: P.dark, side: P.soft, belly: P.light, fin: P.mid, eye: P.light, spots: true, spiny: true },
  krasnopirka: { len: 28, h: 11, back: P.goldDark, side: P.gold, belly: P.bone, fin: P.ember, eye: P.ember },
  lyn: { len: 32, h: 13, back: P.deep, side: P.dark, belly: P.mid, fin: P.dark, eye: P.ember, roundTail: true, mottled: true },
  sudak: { len: 44, h: 11, back: P.dark, side: P.soft, belly: P.bone, fin: P.mid, eye: P.bone, bars: true, spiny: true, snout: true },
  livebait: { len: 15, h: 6, back: P.mid, side: P.light, belly: P.bone, fin: P.ember, eye: P.ink },
};

function fishGrid(species) {
  const look = FISH_LOOKS[species];
  const { len, h } = look;
  const width = len + (look.whiskers ? 8 : 4);
  const height = h + 10;
  const grid = new Grid(width, height);
  const y0 = height / 2 + 0.5;
  const tailLen = Math.round(len * 0.18);
  const x0 = 2;

  const profile = (u) => {
    let p = 0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.86)) ** 0.75;
    if (look.snout && u > 0.72) p *= 1 - (u - 0.72) * 1.9;
    if (look.broadHead && u > 0.6) p = Math.max(p, 0.78 - (u - 0.6) * 0.5);
    return p;
  };
  const bodyEdges = (x) => {
    const u = (x - tailLen) / (len - tailLen);
    const half = (h / 2) * profile(u);
    return { u, top: y0 - half * 1.08, bottom: y0 + half * 0.92 };
  };

  // Fins first, so the body draws over their roots.
  for (let x = tailLen; x < len; x += 1) {
    const { u, top, bottom } = bodyEdges(x);
    const dorsal = look.dorsalBack ? [0.04, 0.2] : [0.34, 0.6];
    if (u > dorsal[0] && u < dorsal[1]) {
      const t = (u - dorsal[0]) / (dorsal[1] - dorsal[0]);
      const fin = Math.round((1 - t) * (look.spiny ? 4 : 3) + 1);
      for (let k = 1; k <= fin; k += 1) {
        if (look.spiny && x % 2 === 1 && k === fin) continue;
        grid.set(x0 + x, top - k, look.fin);
      }
    }
    if ((u > 0.38 && u < 0.5) || (u > 0.12 && u < 0.26)) {
      const fin = u > 0.3 ? 2 : 3;
      for (let k = 1; k <= fin; k += 1) grid.set(x0 + x, bottom + k, look.fin);
    }
  }

  // Tail.
  for (let x = 0; x < tailLen; x += 1) {
    const v = (tailLen - x) / tailLen;
    const spread = 1 + v * h * 0.55;
    for (let dy = -spread; dy <= spread; dy += 1) {
      if (!look.roundTail && Math.abs(dy) < v * h * 0.28 && v > 0.35) continue;
      grid.set(x0 + x, y0 + dy, Math.abs(dy) > spread - 1.2 ? shade(look.fin, 0.8) : look.fin);
    }
  }

  // Body with back / side / belly bands and species markings.
  for (let x = tailLen; x < len; x += 1) {
    const { u, top, bottom } = bodyEdges(x);
    for (let y = Math.ceil(top); y <= Math.floor(bottom); y += 1) {
      const t = (y - top) / Math.max(1, bottom - top);
      let color = t < 0.3 ? look.back : t < 0.74 ? look.side : look.belly;
      if (t > 0.18 && t < 0.3 && hash(x, y, 3) < 0.5) color = shade(look.side, 0.82);
      if (look.scales && t > 0.25 && t < 0.78 && (x + y * 2) % 4 === 0) color = shade(color, 0.84);
      if (look.bars && t < 0.68 && u > 0.12 && u < 0.78 && Math.floor((x + (t < 0.3 ? 0 : 1)) / 3) % 2 === 0) color = shade(look.back, 0.75);
      if (look.spots && t > 0.22 && t < 0.72 && hash(x >> 1, y, 9) < 0.18) color = P.light;
      // Dither the seam between back and side, like hand-shaded pixel art.
      if (t > 0.26 && t < 0.34 && (x + y) % 2 === 0) color = look.back;
      if (look.mottled && t < 0.7 && hash(x >> 1, y >> 1, 4) < 0.3) color = shade(color, 0.7);
      if (t > 0.08 && t < 0.16 && u > 0.2 && u < 0.8) color = shade(color, 1.18);
      grid.set(x0 + x, y, color);
    }
    // Gill plate.
    if (u > 0.76 && u < 0.8) {
      for (let y = Math.ceil(top) + 2; y <= Math.floor(bottom) - 1; y += 1) grid.set(x0 + x, y, shade(look.side, 0.62));
    }
    // Pectoral fin.
    if (u > 0.66 && u < 0.74) grid.set(x0 + x, y0 + 1 + Math.round((0.74 - u) * 20), look.fin);
  }

  const head = bodyEdges(len - 1);
  const eyeX = x0 + Math.round(tailLen + (len - tailLen) * (look.snout ? 0.8 : 0.86));
  const eyeY = Math.round(y0 - (head.bottom - head.top) * 0.18 - (look.snout ? 0 : 1));
  grid.set(eyeX, eyeY, look.eye);
  grid.set(eyeX + 1, eyeY, P.ink);
  grid.set(x0 + len - 1, Math.round(y0 + 1), P.ink);

  if (look.whiskers) {
    for (let k = 1; k <= 7; k += 1) {
      grid.set(x0 + len - 2 + k, Math.round(y0 + 1 + k * 0.6), P.light);
      grid.set(x0 + len - 3 + k, Math.round(y0 + 3 + k * 0.9), P.soft);
    }
  }
  if (look.barbels) {
    grid.set(x0 + len, Math.round(y0 + 2), P.gold);
    grid.set(x0 + len + 1, Math.round(y0 + 3), P.gold);
  }
  return grid.outline(P.ink);
}

/** An old rubber boot, dripping with weed. */
function bootGrid() {
  return fromRows([
    "..........oooooo....",
    "..........oBBBBo....",
    "..........oBbBBo....",
    "..........oBBBBo....",
    "..........oBbBBo.g..",
    "..........oBBBBog...",
    "..........oBBBBo....",
    "..oooooooooBbBBo....",
    ".oBBBBBBBBBBBBBo....",
    "oBBbBBBBBBBBBBBo....",
    "oBBBBBBBBBBBBBBo....",
    "oSSSSSSSSSSSSSSo....",
    ".oooooooooooooo.....",
    "..g...g.............",
  ], { o: P.ink, B: "#6a7862", b: "#93a284", S: "#45463c", g: "#8fc06a" });
}

export function fishSprite(species, scale = 4, label = "") {
  return (species === "boot" ? bootGrid() : fishGrid(species)).toCanvas(scale, label);
}

/* ---------- Rods ---------- */

// Blank colour, handle colour and reel size per tier; the willow switch has no reel at all.
export const ROD_LOOKS = [
  { blank: "#8a6a3c", handle: "#6a4c28", reel: 0, guides: 0 },
  { blank: "#a07a48", handle: P.goldDark, reel: 0, guides: 1 },
  { blank: P.light, handle: P.goldDark, reel: 1, guides: 2 },
  { blank: P.soft, handle: P.gold, reel: 1, guides: 3 },
  { blank: P.bone, handle: P.gold, reel: 1, guides: 3 },
  { blank: P.mid, handle: P.ink, reel: 2, guides: 4 },
  { blank: "#5f8f5a", handle: P.ink, reel: 2, guides: 4 },
  { blank: P.gold, handle: P.ink, reel: 3, guides: 5 },
];

export function rodSprite(tier, scale = 3) {
  const look = ROD_LOOKS[tier - 1];
  const grid = new Grid(22, 22);
  for (let i = 0; i <= 19; i += 1) {
    // The willow switch bows; manufactured rods are straight.
    const bow = look.reel ? 0 : Math.round(Math.sin((i / 19) * Math.PI) * 1.5);
    const x = 1 + i;
    const y = 20 - i - bow;
    if (i < 5) {
      grid.set(x, y, i % 2 ? look.handle : shade(look.handle, 0.8));
      grid.set(x + 1, y, shade(look.handle, 0.65));
    } else {
      grid.set(x, y, i > 16 ? shade(look.blank, 1.25) : look.blank);
      if (i < 12 && look.reel) grid.set(x + 1, y, shade(look.blank, 0.6));
    }
  }
  if (look.reel) {
    const r = Math.min(2, look.reel);
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (dx * dx + dy * dy <= r * r + 0.5) grid.set(7 + dx, 17 + dy, look.reel >= 3 ? P.gold : dx + dy < 0 ? P.bone : P.soft);
      }
    }
    grid.set(7, 17, P.ink);
  }
  [9, 12, 14, 16, 18].slice(0, look.guides).forEach((i) => grid.set(1 + i, 19 - i, P.bone));
  for (let k = 1; k <= 4; k += 1) grid.set(20, 1 + k + (look.reel ? 0 : 1), P.light);
  grid.set(20, look.reel ? 6 : 7, P.ember);
  return grid.outline(P.ink).toCanvas(scale);
}

/* ---------- Bait ---------- */

const BAIT_SPRITES = {
  bread: () => fromRows([
    "................",
    "...oooooooooo...",
    "..oCCCCCCCCCCo..",
    ".oCCbbbbbbbbCCo.",
    ".oCbbbhbbbbbbCo.",
    ".oCbbbbbbbhbbCo.",
    "..oCbbbbbbbbCo..",
    "..oCbhbbbbbbCo..",
    "..oCbbbbbhbbCo..",
    "..oCbbbbbbbbCo..",
    "..oCbbbhbbbbCo..",
    "..oCCCCCCCCCCo..",
    "...oooooooooo...",
  ], { o: P.ink, C: P.goldDark, b: P.bone, h: P.light }),
  worm: () => {
    const grid = new Grid(18, 12);
    for (let x = 1; x < 16; x += 1) {
      const y = 5 + Math.round(Math.sin(x * 0.75) * 2.4);
      const band = x === 10 || x === 11;
      grid.set(x, y, band ? P.ember : P.bone);
      grid.set(x, y + 1, band ? shade(P.ember, 0.7) : x % 3 ? P.ember : shade(P.ember, 0.75));
    }
    return grid.outline(P.ink);
  },
  maggot: () => {
    const grid = new Grid(18, 12);
    for (const [cx, cy] of [[5, 4], [11, 3], [8, 8], [14, 8]]) {
      for (let dx = -2; dx <= 2; dx += 1) {
        grid.set(cx + dx, cy, dx % 2 ? P.light : P.bone);
        if (Math.abs(dx) < 2) grid.set(cx + dx, cy + 1, P.soft);
      }
      grid.set(cx + 2, cy, P.ink);
    }
    return grid.outline(P.ink);
  },
  corn: () => {
    const grid = new Grid(16, 14);
    for (const [cx, cy] of [[4, 9], [7, 10], [10, 9], [13, 10], [5, 6], [8, 6], [11, 6], [8, 3]]) {
      grid.set(cx, cy, P.bone);
      grid.set(cx + 1, cy, P.gold);
      grid.set(cx, cy + 1, P.gold);
      grid.set(cx + 1, cy + 1, P.goldDark);
    }
    return grid.outline(P.ink);
  },
  boilie: () => {
    const grid = new Grid(18, 12);
    for (const [cx, cy, base] of [[5, 6, P.goldDark], [12, 6, P.gold]]) {
      for (let dx = -4; dx <= 4; dx += 1) {
        for (let dy = -4; dy <= 4; dy += 1) {
          if (dx * dx + dy * dy > 16) continue;
          let color = dx + dy < -2 ? shade(base, 1.25) : dx + dy > 3 ? shade(base, 0.75) : base;
          if (hash(cx + dx, cy + dy, 5) < 0.12) color = P.ink;
          grid.set(cx + dx, cy + dy, color);
        }
      }
    }
    return grid.outline(P.ink);
  },
  livebait: () => fishGrid("livebait"),
  bloodworm: () => {
    const grid = new Grid(18, 12);
    for (const [ox, oy, phase] of [[2, 3, 0], [3, 7, 1.7], [8, 5, 3.1]]) {
      for (let x = 0; x < 8; x += 1) grid.set(ox + x, oy + Math.round(Math.sin(x * 0.9 + phase) * 1.4), x % 2 ? "#b8443a" : "#d85a48");
    }
    return grid.outline(P.ink);
  },
  barley: () => {
    const grid = new Grid(16, 14);
    for (const [cx, cy] of [[3, 9], [6, 10], [9, 9], [12, 10], [4, 6], [8, 6], [11, 6], [7, 3]]) {
      grid.set(cx, cy, P.bone);
      grid.set(cx + 1, cy, P.light);
      grid.set(cx, cy + 1, P.light);
      grid.set(cx + 1, cy + 1, P.soft);
    }
    return grid.outline(P.ink);
  },
  frog: () => fromRows([
    "................",
    "...oo......oo...",
    "..oWio....oWio..",
    "..oGGGooooGGGo..",
    ".oGGLGGGGGGLGGo.",
    ".oGGGGGGGGGGGGo.",
    "..oGGdGGGGdGGo..",
    "...oGGGGGGGGo...",
    "..oGGoGGGGoGGo..",
    ".oGGo.oGGo.oGGo.",
    ".ooo...oo...ooo.",
  ], { o: P.ink, G: "#5f8f5a", L: P.light, d: P.dark, W: P.bone, i: P.ink }),
};

export function baitSprite(id, scale = 3) {
  return BAIT_SPRITES[id]().toCanvas(scale);
}

/* ---------- UI icons ---------- */

export function coinSprite(scale = 3) {
  const grid = new Grid(10, 10);
  for (let x = 0; x < 10; x += 1) {
    for (let y = 0; y < 10; y += 1) {
      const d = Math.hypot(x - 4.5, y - 4.5);
      if (d > 4.6) continue;
      let color = d > 3.6 ? P.goldDark : x + y < 7 ? P.bone : P.gold;
      if (d < 2.4 && d > 1.3) color = P.goldDark;
      grid.set(x, y, color);
    }
  }
  return grid.outline(P.ink).toCanvas(scale);
}

/** A little shop front with a striped awning: the shop. */
export function bagSprite(scale = 3) {
  return fromRows([
    "................",
    ".oooooooooooooo.",
    ".oRWRWRWRWRWRWo.",
    ".oRWRWRWRWRWRWo.",
    ".oooooooooooooo.",
    "..oMMMMMMMMMMo..",
    "..oMkkkMMDDDMo..",
    "..oMkGkMMDDDMo..",
    "..oMkkkMMDgDMo..",
    "..oMMMMMMDDDMo..",
    "..oooooooooooo..",
    "................",
  ], { o: P.ink, R: P.ember, W: P.bone, M: P.mid, k: P.deep, G: P.gold, D: P.goldDark, g: P.gold }).toCanvas(scale);
}

/** Two-handled cup: the trophy room. */
export function cupSprite(scale = 3) {
  return fromRows([
    "................",
    "...oooooooooo...",
    ".oooYgYYYYYdooo.",
    "oY.oYgYYYYYdo.Yo",
    "oY.oYgYYYYYdo.Yo",
    ".oY.oYgYYYdo.Yo.",
    "..oooYgYYYdooo..",
    "....oYYYYdo.....",
    ".....oYYdo......",
    "......oYo.......",
    "......oYo.......",
    ".....oYYdo......",
    "....oddddddo....",
    "...oMLMMMMMMo...",
    "...oooooooooo...",
    "................",
  ], { o: P.ink, Y: P.gold, g: P.bone, d: P.goldDark, M: P.mid, L: P.light }).toCanvas(scale);
}

/** Backpack: the inventory. */
export function packSprite(scale = 3) {
  return fromRows([
    "................",
    ".....oooooo.....",
    "....oDo..oDo....",
    "...ooooooooooo..",
    "..oMMMMMMMMMMMo.",
    "..oMLLMMMMMMMMo.",
    "..oMooooooooMMo.",
    "..oMoGGGGGGoMMo.",
    "..oMoGgGGGGoMMo.",
    "..oMooooooooMMo.",
    "..oMMMMMMMMMMMo.",
    "..oDMMMMMMMMMDo.",
    "..oDDMMMMMMMDDo.",
    "...ooooooooooo..",
    "................",
  ], { o: P.ink, M: P.mid, L: P.light, D: P.dark, G: P.goldDark, g: P.gold }).toCanvas(scale);
}

/** Arrow out of a door frame: back to the menu. */
export function exitSprite(scale = 3) {
  return fromRows([
    "................",
    "..oooooooo......",
    "..oBBBBBBo......",
    "..oBo....o......",
    "..oBo.......o...",
    "..oBo.......oo..",
    "..oBo..ooooooLo.",
    "..oBo..oLLLLLLLo",
    "..oBo..ooooooLo.",
    "..oBo.......oo..",
    "..oBo.......o...",
    "..oBo....o......",
    "..oBBBBBBo......",
    "..oooooooo......",
    "................",
  ], { o: P.ink, B: P.soft, L: P.bone }).toCanvas(scale);
}

const EXTRA_SPRITES = {
  glowfloat: () => fromRows([
    "......gg......",
    ".....gYYg.....",
    ".....oYYo.....",
    ".....oYYo.....",
    "....oRRRRo....",
    "...oRRRRRRo...",
    "...oWWWWWWo...",
    "...oWWWWWWo...",
    "....oWWWWo....",
    ".....oLLo.....",
    "......oo......",
    "......o.......",
    "......o.......",
  ], { o: P.ink, g: "#9fe08a", Y: "#d8ff9a", R: P.ember, W: P.bone, L: P.light }),
  handbook: () => fromRows([
    "................",
    "..oooooooooooo..",
    "..oRRRRRRRRRRWo.",
    "..oRggggggggRWo.",
    "..oRgRRRRRRgRWo.",
    "..oRggggggggRWo.",
    "..oRRRRRRRRRRWo.",
    "..oRRRRggRRRRWo.",
    "..oRRRRggRRRRWo.",
    "..oRRRRRRRRRRWo.",
    "..oRRRRRRRRRRWo.",
    "..oddddddddddWo.",
    "...oooooooooooo.",
    "................",
  ], { o: P.ink, R: "#7a3a2a", g: P.gold, W: P.bone, d: "#4a2418" }),
  net: () => {
    const grid = new Grid(18, 18);
    for (let i = 0; i < 9; i += 1) grid.set(1 + i, 16 - i, P.goldDark);
    for (let a = 0; a < 32; a += 1) {
      const angle = (a / 32) * Math.PI * 2;
      grid.set(12 + Math.round(Math.cos(angle) * 4.5), 5 + Math.round(Math.sin(angle) * 4.5), P.soft);
    }
    for (let x = 8; x <= 16; x += 1) {
      for (let y = 5; y <= 13; y += 1) {
        const inside = (x - 12) ** 2 + (y - 7) ** 2 < 26 && y > 6;
        if (inside && (x + y) % 2 === 0) grid.set(x, y, P.light);
      }
    }
    return grid.outline(P.ink);
  },
  braid: () => {
    const grid = new Grid(16, 16);
    for (let y = 2; y <= 13; y += 1) {
      for (let x = 3; x <= 12; x += 1) {
        const edge = y === 2 || y === 13;
        grid.set(x, y, edge ? P.mid : (x + y) % 3 === 0 ? P.gold : P.goldDark);
      }
    }
    for (let k = 0; k < 4; k += 1) grid.set(13 + (k % 2), 8 + k, P.gold);
    return grid.outline(P.ink);
  },
  sonar: () => fromRows([
    "................",
    ".oooooooooooooo.",
    ".oMMMMMMMMMMMMo.",
    ".oMkkkkkkkkkkMo.",
    ".oMkkkkkkGkkkMo.",
    ".oMkGkkkkkkkkMo.",
    ".oMkkkkkGGkkkMo.",
    ".oMkLLLLLLLLkMo.",
    ".oMkLdLLdLLLkMo.",
    ".oMkkkkkkkkkkMo.",
    ".oMMMMMMMMMMMMo.",
    ".oMMoMMoMMoMMMo.",
    ".oooooooooooooo.",
    "................",
  ], { o: P.ink, M: P.mid, k: P.deep, G: P.gold, L: P.soft, d: P.dark }),
};

export function extraSprite(id, scale = 3) {
  return EXTRA_SPRITES[id]().toCanvas(scale);
}

/** A single fishing hook. */
export function hookSprite(scale = 3) {
  return fromRows([
    "......oo....",
    ".....oWo....",
    ".....oLo....",
    ".....oLo....",
    ".....oLo....",
    ".....oLo....",
    "..o..oLo....",
    ".oLo.oLo....",
    ".oLLooLo....",
    "..oLLLo.....",
    "...ooo......",
  ], { o: P.ink, L: P.light, W: P.bone }).toCanvas(scale);
}

/** Small sun / moon for the clock. */
export function clockSprite(night, scale = 2) {
  const grid = new Grid(11, 11);
  for (let x = 0; x < 11; x += 1) {
    for (let y = 0; y < 11; y += 1) {
      const d = Math.hypot(x - 5, y - 5);
      if (night) {
        // Crescent: a disc minus an offset disc.
        if (d < 4.6 && Math.hypot(x - 7, y - 3.5) > 3.6) grid.set(x, y, d < 3 ? P.bone : P.light);
      } else if (d < 3.2) {
        grid.set(x, y, d < 2 ? P.bone : P.gold);
      } else if (d < 5.2 && (x === 5 || y === 5 || x === y || x + y === 10)) {
        grid.set(x, y, P.gold);
      }
    }
  }
  return grid.outline(P.ink).toCanvas(scale);
}

/** Rain cloud for the clock while it's raining. */
export function rainSprite(scale = 3) {
  return fromRows([
    "....oooo....",
    "..ooLLLLoo..",
    ".oLLBBBBLLo.",
    "oLBBBBBBBBLo",
    "oBBBBBBBBBBo",
    ".oooooooooo.",
    "..d..d..d...",
    ".d..d..d....",
  ], { o: P.ink, L: P.bone, B: P.light, d: "#8fb4d0" }).toCanvas(scale);
}

/** A cog: settings. */
export function gearSprite(scale = 3) {
  const grid = new Grid(16, 16);
  for (let x = 0; x < 16; x += 1) {
    for (let y = 0; y < 16; y += 1) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const tooth = Math.cos(angle * 8) > 0.35;
      if (d < 2.3) continue;
      if (d < 5.2 || (tooth && d < 7)) grid.set(x, y, d < 3.4 ? P.mid : dx + dy < 0 ? P.light : P.soft);
    }
  }
  return grid.outline(P.ink).toCanvas(scale);
}
