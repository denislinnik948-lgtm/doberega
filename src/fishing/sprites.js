import { P } from "./palette.js";
import { fishPortrait } from "./fish-portrait.js";

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

/*
 * Each species is drawn after the real fish: its own colours (back, flank,
 * belly, upper and lower fins, eye), body depth and where it is deepest,
 * head and tail shape, and fins where they really are — perch, zander and
 * ruffe carry a spiny first dorsal, carp a long dorsal, pike has dorsal and
 * anal fins set far back, the catfish a tiny dorsal and an anal fin running
 * most of its belly. `u` runs along the body from the tail root (0) to the
 * snout (1). Fins are [from, to, height] in `u`.
 */
export const FISH_LOOKS = {
  // Roach: silvery, blue-grey back, red eye, orange-red lower fins.
  plitka: {
    len: 30, h: 11, peak: 0.55, back: "#3d5a63", side: "#c6d0d2", belly: "#eef0ea", fin: "#8c8478", lowFin: "#d0603a", tailFin: "#a0705a", eye: "#d8382a",
    dorsal: [[0.44, 0.6, 4]], anal: [0.2, 0.32, 3], tail: "fork",
  },
  // Rudd: golden-bronze flanks and bright blood-red fins, upturned mouth.
  krasnopirka: {
    len: 28, h: 12, peak: 0.52, back: "#56552c", side: "#d6b056", belly: "#f0e0ae", fin: "#d8402c", lowFin: "#e2482e", tailFin: "#d8402c", eye: "#e8a020",
    dorsal: [[0.36, 0.5, 4]], anal: [0.2, 0.34, 3], tail: "fork", mouthUp: true,
  },
  // Crucian: deep golden-bronze body with big scales, dark olive fins.
  karas: {
    len: 30, h: 16, peak: 0.5, back: "#463f1c", side: "#c09a3a", belly: "#e6d49c", fin: "#5e5028", lowFin: "#7a6230", tailFin: "#5e5028", eye: "#e8c860",
    dorsal: [[0.28, 0.66, 4, "long"]], anal: [0.2, 0.3, 3], tail: "fork", pattern: "scales", stem: 0.4,
  },
  // Perch: olive-green with 6 dark bars, spiny first dorsal with a dark spot, orange-red lower fins.
  okun: {
    len: 32, h: 13, peak: 0.58, back: "#34441f", side: "#a6ae48", belly: "#e8e4c0", fin: "#76786a", lowFin: "#e05a28", tailFin: "#d8622e", eye: "#e8b030",
    dorsal: [[0.52, 0.8, 5, "spiny"], [0.3, 0.48, 3]], anal: [0.2, 0.3, 3], tail: "fork",
    pattern: "bars", barColor: "#283216", bars: 6, finSpot: "#20241a", hump: true,
  },
  // Tench: thick olive-green body with a golden sheen, red eye, rounded fins, small barbels.
  lyn: {
    len: 32, h: 13, peak: 0.52, back: "#26341a", side: "#687830", belly: "#c8b66c", fin: "#2c381e", lowFin: "#364426", tailFin: "#2c381e", eye: "#e04428",
    dorsal: [[0.4, 0.56, 4, "round"]], anal: [0.2, 0.34, 4, "round"], tail: "square", stem: 0.5, barbels: 1,
  },
  // Bream: very deep, flat body with a small head, bronze-silver flanks, dark fins, long anal fin.
  lyasch: {
    len: 34, h: 20, peak: 0.55, back: "#38392f", side: "#b49c6a", belly: "#ddd2b2", fin: "#34352e", lowFin: "#424238", tailFin: "#34352e", eye: "#dad6c2",
    dorsal: [[0.5, 0.62, 5]], anal: [0.1, 0.46, 3, "long"], tail: "deep", head: 1.8, stem: 0.26,
  },
  // Common carp: golden-bronze with big scales, long dorsal, reddish lower fins, two barbels.
  korop: {
    len: 40, h: 16, peak: 0.55, back: "#4c3c1a", side: "#c08838", belly: "#ecd298", fin: "#5e4422", lowFin: "#b0502c", tailFin: "#8a4a26", eye: "#e8c060",
    dorsal: [[0.26, 0.66, 4, "long"]], anal: [0.2, 0.3, 3], tail: "fork", pattern: "scales", stem: 0.38, barbels: 2,
  },
  // Pike: long olive-green body with rows of pale bean spots, duck-bill snout, fins far back.
  shchuka: {
    len: 50, h: 10, peak: 0.45, back: "#2c401e", side: "#5c7834", belly: "#e6e4c6", fin: "#94702e", lowFin: "#a87434", tailFin: "#94702e", eye: "#e8c040",
    dorsal: [[0.06, 0.2, 4]], anal: [0.06, 0.18, 3], tail: "fork", pattern: "spots", spotColor: "#d8d88e", snout: "bill", flat: true,
  },
  // Zander: slender silver-grey with dark saddles, two dorsals (spiny first), big glassy eye.
  sudak: {
    len: 44, h: 11, peak: 0.55, back: "#3a4840", side: "#b4bcb4", belly: "#eceee8", fin: "#8a9088", lowFin: "#c8c8b8", tailFin: "#8a9088", eye: "#f2f2e2",
    dorsal: [[0.54, 0.8, 5, "spiny"], [0.3, 0.5, 4]], anal: [0.18, 0.3, 3], tail: "fork",
    pattern: "bars", barColor: "#4a5650", bars: 8, finDots: "#2a302c", snout: "point", bigEye: true,
  },
  // Wels catfish: dark mottled olive-brown, broad flat head, long whiskers, tiny dorsal, very long anal fin.
  som: {
    len: 50, h: 12, peak: 0.78, back: "#26261e", side: "#58543e", belly: "#c4c0a2", fin: "#34301f", lowFin: "#45412e", tailFin: "#34301f", eye: "#c8c0a0",
    dorsal: [[0.7, 0.76, 2]], anal: [0.04, 0.58, 3, "long"], tail: "round", pattern: "mottle", broadHead: true, stem: 0.4, whiskers: true,
  },
  // Ruffe: small olive-brown speckled fish, one long spiny dorsal, big bluish eye.
  yorzh: {
    len: 20, h: 8, peak: 0.6, back: "#46462c", side: "#96965e", belly: "#dedac0", fin: "#7a7a5a", lowFin: "#8a8a66", tailFin: "#7a7a5a", eye: "#9cb6d0",
    dorsal: [[0.28, 0.8, 4, "spiny"]], anal: [0.18, 0.3, 2], tail: "fork", pattern: "speckle", finDots: "#2e2e1e", bigEye: true,
  },
  // Bleak: a small slim silver surface fish, mouth turned up.
  verkhovodka: {
    len: 22, h: 5, peak: 0.5, back: "#6a8a6a", side: "#dfe6dc", belly: "#f4f6f0", fin: "#b8c0a8", lowFin: "#d0d4c0", tailFin: "#9aa888", eye: "#ece6d4",
    dorsal: [[0.34, 0.44, 2]], anal: [0.18, 0.34, 2], tail: "fork", mouthUp: true, stem: 0.38,
  },
  // Rotan: dark and mottled, a big head and rounded fins.
  rotan: {
    len: 22, h: 9, peak: 0.6, back: "#2a2a1c", side: "#5a5434", belly: "#a89c70", fin: "#3a3626", lowFin: "#4a4430", tailFin: "#3a3626", eye: "#d8b040",
    dorsal: [[0.3, 0.48, 3, "round"], [0.52, 0.66, 3, "round"]], anal: [0.2, 0.34, 3, "round"], tail: "round", pattern: "mottle", broadHead: true, head: 0.9,
  },
  // Goby: sandy and mottled, a big head and big eyes.
  bychok: {
    len: 20, h: 8, peak: 0.7, back: "#4a3a24", side: "#9c8456", belly: "#dccca0", fin: "#6a5634", lowFin: "#8a7448", tailFin: "#6a5634", eye: "#e0c060",
    dorsal: [[0.3, 0.48, 3], [0.54, 0.68, 3, "spiny"]], anal: [0.2, 0.36, 2], tail: "round", pattern: "mottle", broadHead: true, bigEye: true,
  },
  // Ide: silver going gold, with reddish lower fins.
  yaz: {
    len: 34, h: 12, peak: 0.55, back: "#3a4434", side: "#c0b07a", belly: "#ece4c8", fin: "#5a5a46", lowFin: "#c05a3a", tailFin: "#9a5a40", eye: "#e8d080",
    dorsal: [[0.44, 0.58, 4]], anal: [0.2, 0.32, 3], tail: "fork", pattern: "scales",
  },
  // Asp: long and silver, a dark back and a big pointed mouth.
  zherekh: {
    len: 52, h: 11, peak: 0.6, back: "#1c2a3a", side: "#9eb0c0", belly: "#e8eef0", fin: "#3a4a5a", lowFin: "#c87a5a", tailFin: "#3a4a5a", eye: "#f0e8c8",
    dorsal: [[0.5, 0.62, 5]], anal: [0.14, 0.34, 3], tail: "fork", snout: "point", bigEye: true,
  },
  // Trout: an olive back, a pinkish flank and dark spots.
  forel: {
    len: 34, h: 10, peak: 0.5, back: "#3c4a2a", side: "#c49a8a", belly: "#ecdcc8", fin: "#7a7458", lowFin: "#d0a080", tailFin: "#6a6448", eye: "#e8d0a0",
    dorsal: [[0.44, 0.58, 4]], anal: [0.2, 0.3, 3], tail: "square", pattern: "spots", spotColor: "#2a2418",
  },
  // Burbot: long and mottled brown, one barbel, long low fins.
  myn: {
    len: 44, h: 9, peak: 0.7, back: "#2e2a18", side: "#6a5e36", belly: "#c8bc90", fin: "#4a4228", lowFin: "#5a5030", tailFin: "#4a4228", eye: "#c8b070",
    dorsal: [[0.12, 0.46, 3, "long"], [0.5, 0.62, 3]], anal: [0.08, 0.46, 3, "long"], tail: "round", pattern: "mottle", broadHead: true, barbels: 1, flat: true,
  },
  // Grass carp: long, olive-gold, big scales.
  amur: {
    len: 48, h: 13, peak: 0.55, back: "#3a4228", side: "#a8a060", belly: "#e0dcb0", fin: "#5a5a3a", lowFin: "#7a7448", tailFin: "#5a5a3a", eye: "#e0d090",
    dorsal: [[0.46, 0.6, 4]], anal: [0.16, 0.28, 3], tail: "fork", pattern: "scales", stem: 0.42,
  },
  // Silver carp: a deep silver body and a big head.
  tovstolob: {
    len: 46, h: 22, peak: 0.6, back: "#5a5236", side: "#c8c0a0", belly: "#f0ece0", fin: "#7a7458", lowFin: "#a89c78", tailFin: "#6a6448", eye: "#e8e0c4",
    dorsal: [[0.46, 0.56, 4]], anal: [0.12, 0.3, 3, "long"], tail: "deep", head: 1.6, stem: 0.3, pattern: "scales",
  },
  // Sterlet: long, slim and grey, a pointed snout with barbels, a deep tail.
  sterliad: {
    len: 46, h: 8, peak: 0.45, back: "#3e4446", side: "#8c9496", belly: "#e0dcc8", fin: "#5a6264", lowFin: "#7a8284", tailFin: "#5a6264", eye: "#d8d4c0",
    dorsal: [[0.18, 0.28, 3]], anal: [0.16, 0.24, 2], tail: "deep", snout: "point", barbels: 2, pattern: "speckle", flat: true,
  },
  // Valerka: a clownfish. Orange, three black-edged white bands, rounded fins edged in black.
  valerka: {
    len: 26, h: 14, peak: 0.5, back: "#d8601a", side: "#f07a20", belly: "#f8a040", fin: "#f07a20", lowFin: "#f07a20", tailFin: "#f07a20", eye: "#f08a2a",
    dorsal: [[0.3, 0.72, 4, "round"]], anal: [0.18, 0.36, 3, "round"], tail: "round", pattern: "clown", finEdge: "#141414", stem: 0.45, head: 0.9,
  },
  // Live bait: a small roach-like fish.
  livebait: {
    len: 15, h: 6, peak: 0.55, back: "#3d5a63", side: "#c6d0d2", belly: "#eef0ea", fin: "#8c8478", lowFin: "#d0603a", tailFin: "#a0705a", eye: "#d8382a",
    dorsal: [[0.44, 0.6, 2]], anal: [0.22, 0.32, 2], tail: "fork",
  },
};

function fishGrid(species) {
  const look = FISH_LOOKS[species];
  const { len, h } = look;
  const width = len + (look.whiskers ? 10 : 5);
  const height = h + 12;
  const grid = new Grid(width, height);
  const y0 = Math.round(height / 2);
  const tailLen = Math.round(len * 0.17);
  const x0 = 2;
  const stem = look.stem ?? 0.32;

  // Body depth along its length: thin at the tail stem, deepest at `peak`, tapering to the snout.
  const profile = (u) => {
    const s = u < look.peak ? 0.5 * (u / look.peak) : 0.5 + 0.5 * ((u - look.peak) / (1 - look.peak));
    let p = stem + (1 - stem) * Math.sin(Math.PI * Math.min(0.97, s)) ** 0.8;
    if (u > 0.78) p *= 1 - (u - 0.78) * (look.head ?? 1.2);
    if (look.snout === "bill" && u > 0.74) p = Math.min(p, 0.62 - (u - 0.74) * 1.3);
    if (look.snout === "point" && u > 0.78) p *= 1 - (u - 0.78) * 0.9;
    if (look.broadHead && u > 0.7) p = Math.max(p, 0.8 - (u - 0.7) * 1.1);
    return Math.max(0.12, p);
  };
  const edges = (x) => {
    const u = (x - tailLen) / (len - tailLen);
    const half = (h / 2) * profile(u);
    // A humped back (perch) or a flat back (pike) shifts the outline.
    const lift = look.hump && u > 0.4 && u < 0.75 ? Math.sin(((u - 0.4) / 0.35) * Math.PI) * 1.2 : 0;
    const top = y0 - half * (look.flat ? 0.9 : 1.08) - lift;
    return { u, top, bottom: y0 + half * (look.flat ? 1.05 : 0.92) };
  };
  const xAt = (u) => tailLen + u * (len - tailLen);

  // A fin rising from an edge: `side` -1 grows up from the back, +1 down from the belly.
  const fin = ([from, to, size, kind], side, color, dots) => {
    for (let x = Math.ceil(xAt(from)); x <= Math.floor(xAt(to)); x += 1) {
      const t = (x - xAt(from)) / Math.max(1, xAt(to) - xAt(from));
      let height;
      if (kind === "long") height = t > 0.82 ? size : size * 0.55 + (t > 0.7 ? (t - 0.7) * 3 : 0);
      else if (kind === "round") height = size * Math.sin(Math.PI * (0.15 + t * 0.7));
      else height = size * (0.35 + 0.65 * t);
      height = Math.max(1, Math.round(height));
      const { top, bottom } = edges(x);
      const base = side < 0 ? Math.ceil(top) : Math.floor(bottom);
      for (let k = 1; k <= height; k += 1) {
        // Spiny fins: a comb of rays with gaps along the top.
        if (kind === "spiny" && k >= height - 1 && x % 2 === 1) continue;
        let c = k === height ? (look.finEdge ?? shade(color, 0.85)) : color;
        if (dots && (x + k) % 3 === 0) c = dots;
        grid.set(x0 + x, base + side * k, c);
      }
      // Dark blotch at the rear of a perch's spiny dorsal.
      if (look.finSpot && kind === "spiny" && t < 0.25 && side < 0) grid.set(x0 + x, base - Math.max(1, height - 1), look.finSpot);
    }
  };

  look.dorsal.forEach((spec, index) => fin(spec, -1, index === 0 ? look.fin : look.fin, look.finDots));
  if (look.anal) fin(look.anal, 1, look.lowFin, look.finDots);
  // Pelvic fin under the belly, a little ahead of the anal fin.
  fin([look.whiskers ? 0.62 : 0.5, look.whiskers ? 0.68 : 0.58, look.h > 14 ? 3 : 2], 1, look.lowFin);

  // Tail fin.
  for (let x = 0; x < tailLen; x += 1) {
    const v = (tailLen - x) / tailLen;
    // A rounded paddle widens, then closes in a curve; the others flare out to the edge.
    const spread = look.tail === "round"
      ? 1 + h * 0.38 * (v < 0.5 ? v / 0.5 : Math.sqrt(Math.max(0, 1 - ((v - 0.5) / 0.55) ** 2)))
      : 1 + v * h * 0.55;
    for (let dy = -spread; dy <= spread; dy += 1) {
      const a = Math.abs(dy);
      if (look.tail === "fork" && a < v * h * 0.26 && v > 0.4) continue;
      if (look.tail === "deep" && a < v * h * 0.3 && v > 0.35) continue;
      const rim = x < 1 || a > spread - 1.2;
      grid.set(x0 + x, y0 + dy, rim ? (look.finEdge ?? shade(look.tailFin, 0.8)) : look.tailFin);
    }
  }

  // Body: back, flank and belly bands with the species' markings.
  const barWidth = (len - tailLen) * 0.62 / Math.max(1, (look.bars ?? 1) * 2);
  for (let x = tailLen; x < len; x += 1) {
    const { u, top, bottom } = edges(x);
    for (let y = Math.ceil(top); y <= Math.floor(bottom); y += 1) {
      const t = (y - top) / Math.max(1, bottom - top);
      let color = t < 0.32 ? look.back : t < 0.72 ? look.side : look.belly;
      // Dithered seams between the bands, like hand-shaded pixel art.
      if (t > 0.27 && t < 0.37 && (x + y) % 2 === 0) color = t < 0.32 ? look.side : look.back;
      if (t > 0.67 && t < 0.77 && (x + y) % 2 === 0) color = t < 0.72 ? look.belly : look.side;
      // A soft highlight along the upper flank.
      if (t > 0.36 && t < 0.46 && u > 0.2 && u < 0.78) color = shade(color, 1.12);
      if (look.pattern === "scales" && t > 0.25 && t < 0.8 && u < 0.76 && ((x + (y % 2) * 2) % 4 === 0)) color = shade(color, 0.78);
      if (look.pattern === "bars" && t < 0.74 && u > 0.1 && u < 0.76) {
        const phase = (x - xAt(0.1)) / barWidth;
        if (Math.floor(phase) % 2 === 0 && phase < (look.bars ?? 6) * 2) color = t < 0.32 ? shade(look.barColor, 0.8) : look.barColor;
      }
      if (look.pattern === "spots" && t > 0.18 && t < 0.82 && u < 0.76) {
        // Pale, slightly elongated bean spots in staggered rows.
        const row = Math.floor((y - top) / 2.2);
        if ((x + row * 2) % 5 < 2 && (y + row) % 2 === 0) color = look.spotColor;
      }
      if (look.pattern === "clown") {
        // White bands behind the head, mid-body (bulging forward) and at the tail root, each edged in black.
        for (const [center, bulge] of [[0.84, 0], [0.5, 0.07], [0.06, 0]]) {
          const c = center + bulge * (1 - Math.abs(t - 0.5) * 2);
          const d = Math.abs(u - c);
          if (d < 0.05) color = "#f6f4ee";
          else if (d < 0.085) color = "#141414";
        }
      }
      if (look.pattern === "speckle" && t < 0.75 && hash(x, y, 21) < 0.2) color = shade(look.back, 0.75);
      if (look.pattern === "mottle" && t < 0.75) {
        const blotch = hash(x >> 1, y >> 1, 4);
        if (blotch < 0.3) color = shade(color, 0.62);
        else if (blotch > 0.85) color = shade(color, 1.25);
      }
      grid.set(x0 + x, y, color);
    }
    // Gill cover edge.
    if (u > 0.8 && u < 0.83) {
      for (let y = Math.ceil(top) + 2; y <= Math.floor(bottom) - 1; y += 1) grid.set(x0 + x, y, shade(look.side, 0.6));
    }
    // Pectoral fin behind the gill.
    if (u > 0.7 && u < 0.79) grid.set(x0 + x, Math.round(y0 + 1 + (0.79 - u) * 22), look.lowFin);
  }

  // Eye, mouth and barbels.
  const head = edges(len - 1);
  const eyeU = look.snout === "bill" ? 0.82 : look.broadHead ? 0.9 : 0.87;
  const eyeX = x0 + Math.round(xAt(eyeU));
  const eyeY = Math.round(edges(xAt(eyeU)).top + (edges(xAt(eyeU)).bottom - edges(xAt(eyeU)).top) * 0.3);
  grid.set(eyeX, eyeY, look.eye);
  if (look.bigEye) {
    grid.set(eyeX, eyeY - 1, look.eye);
    grid.set(eyeX + 1, eyeY - 1, look.eye);
  }
  grid.set(eyeX + 1, eyeY, P.ink);
  const mouthY = look.mouthUp ? Math.round(head.top + 1) : Math.round(y0 + (look.broadHead ? 2 : 1));
  grid.set(x0 + len - 1, mouthY, P.ink);
  if (look.snout === "bill") for (let k = 2; k <= 6; k += 1) grid.set(x0 + len - k, Math.round(y0 + 1), P.ink);

  if (look.whiskers) {
    // Two long whiskers from the upper jaw, shorter ones under the chin.
    for (let k = 1; k <= 9; k += 1) {
      grid.set(x0 + len - 2 + k, Math.round(y0 + 1 + k * 0.5), "#8a8466");
      grid.set(x0 + len - 3 + Math.round(k * 0.5), Math.round(y0 + 4 + k * 0.45), "#6e6a52");
    }
  }
  if (look.barbels) {
    grid.set(x0 + len, Math.round(y0 + 2), shade(look.side, 0.8));
    if (look.barbels > 1) grid.set(x0 + len + 1, Math.round(y0 + 3), shade(look.side, 0.8));
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

/**
 * The two-headed perch: the perch's own portrait with a second head growing
 * up out of its shoulders.
 */
function twoHeadedGrid(scale, label) {
  const look = FISH_LOOKS.okun;
  const portrait = fishPortrait(look);
  const lift = Math.round(portrait.height * 0.36);
  const grid = new Grid(portrait.width, portrait.height + lift);
  const from = Math.round(portrait.width * 0.6);
  // The second head first, up and a little back, then the fish over it.
  for (let y = 0; y < portrait.height; y += 1) {
    for (let x = from; x < portrait.width; x += 1) {
      const cell = portrait.cells[y * portrait.width + x];
      if (cell) grid.set(x - 3, y, cell);
    }
  }
  for (let y = 0; y < portrait.height; y += 1) {
    for (let x = 0; x < portrait.width; x += 1) {
      const cell = portrait.cells[y * portrait.width + x];
      if (cell) grid.set(x, y + lift, cell);
    }
  }
  const shownWidth = (look.len + 5) * scale * 1.15;
  return grid.toCanvas(shownWidth / portrait.width, label);
}

/** Artem: a bright red crayfish in black sunglasses, claws up, feelers out. */
function artemGrid() {
  return fromRows([
    "........................ff..",
    ".....................fff....",
    "..................fff.PPPP..",
    "................A...PPPppPP.",
    "...............AAAAAPP...PP.",
    "..T..........HHHHH.PPPPP....",
    ".TTSSSSSSSSSHHHHHHHkkkk.....",
    "TTTSsSsSsSsSHHLLHHHkwkk.....",
    ".TTSSSSSSSSSHHHHHHHHHHH.....",
    "..T..l.l.l..HHHHH.PPPPP.....",
    "...............AAAAAPP...PP.",
    "................A...PPPppPP.",
    "..................fff.PPPP..",
    ".....................fff....",
    "........................ff..",
  ], { T: "#a8301c", S: "#d24a2a", s: "#8a2a16", H: "#e05a34", L: "#f08050", A: "#c84a2a", P: "#e05a34", p: "#f6a070", f: "#a8442a", l: "#8a2a16", k: "#121212", w: "#f4f0e4" }).outline(P.ink);
}

/**
 * A fish for the UI: the detailed portrait (as on the social cards) in the
 * fish's own colours, shown at the size the plain sprite used to take up.
 * The old boot and Artem the crayfish keep their own pixel sprites.
 */
export function fishSprite(species, scale = 4, label = "") {
  if (species === "boot") return bootGrid().toCanvas(scale, label);
  if (species === "artem") return artemGrid().toCanvas(scale * 1.2, label);
  if (species === "dvoholovyi") return twoHeadedGrid(scale, label);
  const look = FISH_LOOKS[species];
  const portrait = fishPortrait(look);
  const grid = new Grid(portrait.width, portrait.height);
  grid.cells = portrait.cells;
  const shownWidth = (look.len + (look.whiskers ? 10 : 5)) * scale * 1.15;
  return grid.toCanvas(shownWidth / portrait.width, label);
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
  // A pinch of pale dough rolled into two balls.
  dough: () => {
    const grid = new Grid(18, 12);
    for (const [cx, cy, r] of [[6, 6, 4], [12, 7, 3]]) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          if (dx * dx + dy * dy > r * r) continue;
          grid.set(cx + dx, cy + dy, dx + dy < -r * 0.6 ? "#f4e8c0" : dx + dy > r * 0.7 ? "#bfa66a" : "#e2cf92");
        }
      }
    }
    return grid.outline(P.ink);
  },
  // Green peas, lit from the upper left.
  peas: () => {
    const grid = new Grid(18, 12);
    for (const [cx, cy] of [[4, 8], [8, 9], [12, 8], [6, 4], [10, 5], [14, 4]]) {
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) grid.set(cx + dx, cy + dy, dx + dy < 0 ? "#a6d05c" : dx + dy > 0 ? "#557a2a" : "#7aa83c");
    }
    return grid.outline(P.ink);
  },
  // Boiled potato cubes.
  potato: () => {
    const grid = new Grid(18, 12);
    for (const [x0, y0] of [[2, 5], [9, 3], [11, 7]]) {
      for (let dx = 0; dx < 5; dx += 1) for (let dy = 0; dy < 4; dy += 1) grid.set(x0 + dx, y0 + dy, dy === 0 ? "#f0dc9a" : dx === 4 ? "#a88c48" : "#dcc277");
    }
    return grid.outline(P.ink);
  },
  // A dark red piece of chicken liver.
  liver: () => {
    const grid = new Grid(18, 12);
    for (let x = 2; x < 16; x += 1) {
      const top = 4 + Math.round(Math.sin(x * 0.7) * 1.2);
      const bottom = 8 + Math.round(Math.cos(x * 0.5) * 1.3);
      for (let y = top; y <= bottom; y += 1) grid.set(x, y, y === top ? "#b8544a" : hash(x, y, 3) < 0.2 ? "#5a1c18" : "#7c2a24");
    }
    return grid.outline(P.ink);
  },
  // A silver strip of fish with the red cut showing.
  fishstrip: () => {
    const grid = new Grid(18, 12);
    for (let x = 2; x < 15; x += 1) {
      const y0 = 7 - Math.round((x - 2) * 0.3);
      for (let k = 0; k < 3; k += 1) grid.set(x, y0 + k, k === 0 ? "#dfe6e6" : k === 1 ? ((x % 2) ? "#a8b4b4" : "#c4cece") : "#6e7a7a");
    }
    for (let k = 0; k < 3; k += 1) grid.set(15, 3 + k, "#c0504a");
    return grid.outline(P.ink);
  },
  // A river crayfish facing right: fanned tail, segmented body, two open claws and long feelers.
  crayfish: () => fromRows([
    "................cc",
    "..............cc..",
    ".........CCC.cc...",
    "........CCLCC.....",
    "...LLLLLLL........",
    "TTBBBBBBBBBBe.....",
    "TTDBDBDBBBBB......",
    "...DDDDDDD........",
    "........CCDCC.....",
    ".........CCC.cc...",
    "..............cc..",
    "................cc",
  ], { T: "#6a4428", B: "#8a5a34", L: "#b07a48", D: "#5a3a20", C: "#a0603a", c: "#6a4a30", e: P.ink }).outline(P.ink),
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

BAIT_SPRITES.spoon = () => fromRows([
  "......oo........",
  ".....oSSo.......",
  "....oSWWSo......",
  "....oSWSSo......",
  "...oSWSSSSo.....",
  "...oSSSSSSo.....",
  "...oSSRRSSo.....",
  "....oSRRSo......",
  ".....oSSo.......",
  "......oo........",
  "......oHo.......",
  ".....oHoHo......",
  "....oHo.oHo.....",
  ".....o...o......",
], { o: P.ink, S: "#b9c2c4", W: "#f2f4ee", R: P.ember, H: "#8a8f88" });

// A spinner: a round silver blade turning ahead of a red-beaded body and a treble hook.
BAIT_SPRITES.spinner = () => fromRows([
  "......oo........",
  ".....oSSo.......",
  "....oSWWSo......",
  "....oSWSSo......",
  ".....oSSo.......",
  "......oo........",
  "......oBo.......",
  ".....oRRRo......",
  ".....oRRRo......",
  "......oBo.......",
  "......oHo.......",
  ".....oHoHo......",
  "....oHo.oHo.....",
  ".....o...o......",
], { o: P.ink, S: "#c9cfc8", W: "#f2f4ee", B: "#8a8f88", R: P.ember, H: "#8a8f88" });

// A wobbler: a little plastic fish, green back and yellow belly, a clear diving lip and two trebles.
BAIT_SPRITES.wobbler = () => fromRows([
  "....................",
  "..ooooooooooo.......",
  ".oGGGGGGGGGGGoo.....",
  "oGGgGgGgGGGGWkoo....",
  "oYYYYYYYYYYYYYYLLo..",
  ".oYYYYYYYYYYYYoLLLo.",
  "..oooooooooooo.ooo..",
  "....oHo....oHo......",
  "...oHoHo..oHoHo.....",
  "..oHo.oHooHo.oHo....",
  "...o...o..o...o.....",
], { o: P.ink, G: "#4f8a4a", g: "#2f5a30", Y: "#e2b85e", W: P.bone, k: P.ink, L: "#a9c7c4", H: "#8a8f88" });

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

/** An achievement badge: a gold medal on a ribbon, the ribbon's colour by group. */
export function medalSprite(scale = 3, ribbon = P.ember) {
  return fromRows([
    "..oooo..oooo..",
    "..oRRo..oRRo..",
    "...oRRooRRo...",
    "....oRRRRo....",
    ".....oRRo.....",
    "....oooooo....",
    "...oYgYYYdo...",
    "..oYgYYYYYdo..",
    "..oYYYddYYdo..",
    "..oYYdYYdYdo..",
    "..oYYYddYYdo..",
    "..oYYYYYYddo..",
    "...oddddddo...",
    "....oooooo....",
  ], { o: P.ink, R: ribbon, Y: P.gold, g: P.bone, d: P.goldDark }).toCanvas(scale);
}

/** Backpack: the inventory. */
export function packSprite(scale = 3) {
  // A khaki canvas backpack: carry loop, buckled top flap, shoulder straps and a front pocket.
  return fromRows([
    "......oooo......",
    ".....o....o.....",
    "....oooooooo....",
    "...oFFFFFFFFo...",
    "..oFLFFFFFFFFo..",
    "..oFFFFFFFFFFo..",
    ".oDDDDDggDDDDDo.",
    ".oSBBBBggBBBBSo.",
    ".oSBLBBBBBBBBSo.",
    ".oSBBooooooBBSo.",
    ".oSBoPPPPPPoBSo.",
    ".oSBoPPPgPPoBSo.",
    ".oSBoPPPPPPoBSo.",
    ".oSBBooooooBBSo.",
    ".oDBBBBBBBBBBDo.",
    "..oDDDDDDDDDDo..",
    "...oooooooooo...",
  ], { o: P.ink, F: "#7a6a3a", L: "#b4a46a", D: "#4e4426", B: "#8e7e48", S: "#3e3420", P: "#6e6034", g: P.gold }).toCanvas(scale);
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
  spinreel: () => fromRows([
    "................",
    ".....oooooo.....",
    "....oMMMMMMo....",
    "...oMGGGGGGMo...",
    "...oMGoooGGMo.oo",
    "...oMGoLoGGMooHo",
    "...oMGoooGGMo.oo",
    "...oMGGGGGGMo...",
    "....oMMMMMMo....",
    ".....oooooo.....",
    ".......oMo......",
    "...ooooMMMoooo..",
    "...oddddddddddo.",
    "....oooooooooo..",
  ], { o: P.ink, M: P.mid, G: P.soft, L: P.light, H: P.gold, d: P.dark }),
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

/** A tied sack of groundbait, crumbs spilling from the top. */
export function groundbaitSprite(scale = 3) {
  return fromRows([
    "......y.y.......",
    ".....y.yy.y.....",
    "......oooo......",
    ".....oTTTTo.....",
    "......oRRo......",
    ".....oBBBBo.....",
    "....oBBbBBBo....",
    "...oBBBBBbBBo...",
    "...oBbBBBBBBo...",
    "...oBBBBbBBBo...",
    "...oBBBBBBbBo...",
    "....oBbBBBBo....",
    ".....oooooo.....",
  ], { o: P.ink, y: "#e0c068", T: "#c9a35a", R: P.ember, B: "#9a7a46", b: "#7a5e34" }).toCanvas(scale);
}

/** A spool of fishing line; `worn` greys the line and frays its loose end. */
export function lineSprite(scale = 3, worn = false) {
  return fromRows([
    "..oooooooooo..",
    ".oDDDDDDDDDDo.",
    "..oLlLlLlLlo..",
    "..oLlLlLlLlo..",
    "..olLlLlLlLo..",
    "..oLlLlLlLlo..",
    "..olLlLlLlLo..",
    ".oDDDDDDDDDDo.",
    "..oooooooooo..",
    "...........l..",
    "............l.",
  ], { o: P.ink, D: P.goldDark, L: worn ? P.mid : P.light, l: worn ? P.dark : P.soft }).toCanvas(scale);
}

export function extraSprite(id, scale = 3) {
  return EXTRA_SPRITES[id]().toCanvas(scale);
}

/** The keepnet: a ring and a long mesh bag tapering down. */
export function keepnetSprite(scale = 3) {
  return fromRows([
    "..oooooooo..",
    ".oRRRRRRRRo.",
    "..oNoNoNoo..",
    "..oNNoNNo...",
    "..oNoNoNo...",
    "...oNNNo....",
    "...oNoNo....",
    "...oNNNo....",
    "....oNo.....",
    ".....o......",
  ], { o: P.ink, R: P.goldDark, N: P.soft }).toCanvas(scale);
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

/** Small sun / moon for the clock; at night the moon in its phase (`moon` from moonAt). */
export function clockSprite(night, scale = 2, moon = null) {
  const grid = new Grid(11, 11);
  const turn = Math.cos(2 * Math.PI * (moon?.phase ?? 0.2));
  const waxing = moon?.waxing ?? true;
  for (let x = 0; x < 11; x += 1) {
    for (let y = 0; y < 11; y += 1) {
      const d = Math.hypot(x - 5, y - 5);
      if (night) {
        if (d >= 4.6) continue;
        // Lit from the right while it waxes, from the left as it wanes; the rest a dark disc.
        const u = (x - 5) / 4.6;
        const edge = Math.sqrt(Math.max(0, 1 - ((y - 5) / 4.6) ** 2)) * turn;
        const lit = waxing ? u >= edge : u <= -edge;
        grid.set(x, y, lit ? (d < 3 ? P.bone : P.light) : P.mid);
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
