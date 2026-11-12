import { P } from "./palette.js";
import { SPECIAL_AVATAR } from "./data.js";
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

  /** The same picture without its empty margins, so it centres where it is shown. */
  trim() {
    let x0 = this.width, y0 = this.height, x1 = -1, y1 = -1;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (!this.get(x, y)) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) return this;
    const out = new Grid(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) out.set(x - x0, y - y0, this.get(x, y));
    return out;
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
    // Straight into the pixels: a fish portrait is a few thousand of them.
    const image = ctx.createImageData(this.width, this.height);
    const { data } = image;
    const odd = [];
    this.cells.forEach((color, index) => {
      if (!color) return;
      if (color.length !== 7 || color[0] !== "#") {
        odd.push([index, color]);
        return;
      }
      const value = parseInt(color.slice(1), 16);
      data[index * 4] = value >> 16;
      data[index * 4 + 1] = (value >> 8) & 255;
      data[index * 4 + 2] = value & 255;
      data[index * 4 + 3] = 255;
    });
    ctx.putImageData(image, 0, 0);
    for (const [index, color] of odd) {
      ctx.fillStyle = color;
      ctx.fillRect(index % this.width, Math.floor(index / this.width), 1, 1);
    }
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
  // Rainbow trout: silver, a pink band along the side, fine dark spots over the back and tail.
  raiduzhna: {
    len: 38, h: 11, peak: 0.5, back: "#3a5048", side: "#c4c8bc", belly: "#eeeae2", fin: "#6a7a6a", lowFin: "#d8a4a0", tailFin: "#5e6e62", eye: "#e8d8b0",
    dorsal: [[0.44, 0.58, 4]], anal: [0.2, 0.3, 3], tail: "square", pattern: "spots", spotColor: "#1e2420", stripe: "#d07a92",
  },
  // Brook trout: dark olive with pale spots, an orange belly, white-edged lower fins.
  paliya: {
    len: 30, h: 9, peak: 0.5, back: "#2a3622", side: "#7a7a4a", belly: "#e07a36", fin: "#4a4a30", lowFin: "#e06a3a", tailFin: "#4a4a30", eye: "#e8d090",
    dorsal: [[0.44, 0.58, 3]], anal: [0.2, 0.3, 2], tail: "square", pattern: "spots", spotColor: "#e0d27a",
  },
  // Huchen: long and round, coppery, a broad head and small dark spots.
  holovach: {
    len: 56, h: 11, peak: 0.55, back: "#3a302c", side: "#b08a78", belly: "#ece0d4", fin: "#5a4a40", lowFin: "#b07a60", tailFin: "#5a4a40", eye: "#e8d8b0",
    dorsal: [[0.44, 0.56, 4]], anal: [0.16, 0.26, 3], tail: "square", pattern: "spots", spotColor: "#2a1e1a", broadHead: true,
  },
  // Chub: a thick silver-bronze body, a broad dark head, big dark-edged scales, orange lower fins.
  holavl: {
    len: 36, h: 12, peak: 0.55, back: "#2e3a2e", side: "#b0a880", belly: "#ece6d0", fin: "#3a3a30", lowFin: "#d0703a", tailFin: "#3a3a30", eye: "#e8d8a0",
    dorsal: [[0.44, 0.56, 4]], anal: [0.18, 0.28, 3], tail: "fork", pattern: "scales", broadHead: true,
  },
  // Steelhead: a sea-run rainbow, steel-blue back, bright silver sides, a faint pink band.
  stalhead: {
    len: 42, h: 11, peak: 0.5, back: "#2e4458", side: "#d2d8dc", belly: "#f2f2ee", fin: "#5a6a78", lowFin: "#c8b8b8", tailFin: "#4a5a68", eye: "#e8e0c8",
    dorsal: [[0.44, 0.56, 4]], anal: [0.2, 0.3, 3], tail: "square", pattern: "spots", spotColor: "#24303a", stripe: "#d8a0ac",
  },
  // Mirror carp: a carp's deep golden body, bare but for a few big scattered scales.
  dzerkalnyi: {
    len: 40, h: 17, peak: 0.55, back: "#5a4418", side: "#d0a048", belly: "#f0dca0", fin: "#5e4422", lowFin: "#b0502c", tailFin: "#8a4a26", eye: "#e8c060",
    dorsal: [[0.26, 0.66, 4, "long"]], anal: [0.2, 0.3, 3], tail: "fork", pattern: "spots", spotColor: "#9a7428", stem: 0.38, barbels: 2,
  },
  // Bigmouth buffalo: a deep, humped grey-olive body, a big head and a long low dorsal.
  bufalo: {
    len: 42, h: 17, peak: 0.6, back: "#2e3428", side: "#7a8068", belly: "#d4d2bc", fin: "#3a3e30", lowFin: "#5a5e48", tailFin: "#3a3e30", eye: "#d8d0a8",
    dorsal: [[0.22, 0.62, 4, "long"]], anal: [0.18, 0.28, 3], tail: "fork", pattern: "scales", head: 1.3, stem: 0.4, hump: true,
  },
  // Channel catfish: slim and blue-grey, small dark spots, a forked tail and long whiskers.
  kanalnyi: {
    len: 42, h: 9, peak: 0.72, back: "#2e3a48", side: "#7a8a98", belly: "#e2e2dc", fin: "#3a4652", lowFin: "#5a6672", tailFin: "#3a4652", eye: "#d8d4c0",
    dorsal: [[0.66, 0.74, 3]], anal: [0.08, 0.36, 3, "long"], tail: "fork", pattern: "speckle", broadHead: true, stem: 0.35, whiskers: true,
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
      // A coloured band along the middle of the side (the rainbow trout's).
      if (look.stripe && t > 0.42 && t < 0.6 && u > 0.06 && u < 0.8) color = (x + y) % 2 && (t < 0.46 || t > 0.56) ? look.side : look.stripe;
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
/* The legends: each a giant of its kind, in colours of its own. */
Object.assign(FISH_LOOKS, {
  // The golden crucian: bright gold all over.
  zolotyi: { ...FISH_LOOKS.karas, back: "#7a5a12", side: "#f0c23e", belly: "#fbeaa8", fin: "#c88e22", lowFin: "#e0a02c", tailFin: "#c88e22", eye: "#fff0a0" },
  // The grey pike: an old pike gone silver-grey.
  syva: { ...FISH_LOOKS.shchuka, back: "#3c4642", side: "#8c968e", belly: "#ecece2", fin: "#6e6c5c", lowFin: "#847e68", tailFin: "#6e6c5c", spotColor: "#d4d8cc", eye: "#e8e0b0" },
  // The princely trout: rosy flanks and a dark back.
  knyazha: { ...FISH_LOOKS.forel, back: "#2c3c3a", side: "#d0a0a8", belly: "#f0e4dc", lowFin: "#e08a80", spotColor: "#1a1814", eye: "#f0d8a0" },
  // Myron the carp: old, dark bronze, mossy.
  myron: { ...FISH_LOOKS.korop, back: "#2e2a14", side: "#8a7a34", belly: "#d8c890", fin: "#3e3a1c", lowFin: "#8a4a2a", tailFin: "#5a4220" },
  // Grandpa Panas the catfish: near black, pale-eyed.
  panas: { ...FISH_LOOKS.som, back: "#1a1c16", side: "#4a4a3a", belly: "#b8b49a", eye: "#e8e0c0" },
  // The Old Grass Carp: huge and dark, its scales gone bronze and mossy with age.
  staryi: { ...FISH_LOOKS.amur, back: "#22261a", side: "#6e6a3e", belly: "#c8c49a", fin: "#3a3a26", lowFin: "#5a5636", tailFin: "#3a3a26", eye: "#e8dca0" },
  // The granite pike: dark, grey as the quarry walls, pale spots like lichen.
  granitna: { ...FISH_LOOKS.shchuka, back: "#2a2e2c", side: "#6a6e66", belly: "#d8d6c8", fin: "#5a5448", lowFin: "#7a6a52", tailFin: "#5a5448", spotColor: "#b8b8a4", eye: "#f0d070" },
  // Veselka, the rainbow: a huge rainbow trout, its band gone bright as a rainbow.
  veselka: { ...FISH_LOOKS.raiduzhna, back: "#2a5a4a", side: "#e2dcd2", belly: "#f6f0e6", stripe: "#e8607e", lowFin: "#e88a8a", eye: "#fff0c0" },
});

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

/** A green glass bottle lying on its side, corked, a rolled note inside. */
function bottleGrid() {
  return fromRows([
    "..oooooooooooooo........",
    ".oGGGGGGGGGGGGGGo.......",
    "oGhhhhhhhhhhhhGGGoooo...",
    "oGPPPPPPPPPGGGGGGGGGGoo.",
    "oGPpPpPPpPPGGGGGGGGGGCCo",
    "oGPPPPPPPPPGGGGGGGGGGoo.",
    "oGGGGGGGGGGGGGGGGoooo...",
    ".oGGGGGGGGGGGGGGo.......",
    "..oooooooooooooo........",
  ], { o: P.ink, G: "#3f7a5a", h: "#8fc0a0", P: "#e2dcc0", p: "#7a6a50", C: "#a8743c" });
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
const portraits = new Map();

/** Shade every species ahead of time, one per idle moment, so the first handbook or catch opens at once. */
export function warmFishPortraits() {
  const idle = window.requestIdleCallback ?? ((callback) => setTimeout(callback, 200));
  const species = Object.keys(FISH_LOOKS).filter((id) => !portraits.has(id));
  const next = () => {
    const id = species.shift();
    if (!id) return;
    if (!portraits.has(id)) portraits.set(id, fishPortrait(FISH_LOOKS[id]));
    idle(next);
  };
  idle(next);
}

export function fishSprite(species, scale = 4, label = "") {
  if (species === "boot") return bootGrid().toCanvas(scale, label);
  if (species === "bottle") return bottleGrid().toCanvas(scale * 1.2, label);
  // A lost lure is drawn as the lure it is (showCatch passes which); a spinner if unknown.
  if (species === "lostlure") return BAIT_SPRITES.spinner().toCanvas(scale * 1.5, label);
  if (species === "artem") return artemGrid().toCanvas(scale * 1.2, label);
  if (species === "dvoholovyi") return twoHeadedGrid(scale, label);
  const look = FISH_LOOKS[species];
  // A portrait takes a few milliseconds to shade and never changes: shade each species once.
  let portrait = portraits.get(species);
  if (!portrait) portraits.set(species, portrait = fishPortrait(look));
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

/** The money icon: a gold dollar coin, lit on its top left, the dollar struck on its face. */
export function coinSprite(scale = 3) {
  return fromRows([
    "...oooooo...",
    "..oDDDDDDo..",
    ".oDLLfGGGDo.",
    "oDLGffffGGDo",
    "oDLfGfGGGGDo",
    "oDGGfffGGGDo",
    "oDGGGfGfGGDo",
    "oDGffffGGGDo",
    ".oDGGfGGGDo.",
    "..oDDDDDDo..",
    "...oooooo...",
  ], { o: P.ink, D: P.goldDark, L: P.bone, G: P.gold, f: P.goldDark }).toCanvas(scale);
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
/** A tournament cup's metal by place: gold, silver, bronze ([body, shade, shine]). */
export const CUP_METALS = { gold: [P.gold, P.goldDark, P.bone], silver: ["#c8ccd0", "#727880", "#f2f4f6"], bronze: ["#c88a50", "#74461f", "#ecc49a"] };
export function cupSprite(scale = 3, metal = "gold") {
  const [Y, d, g] = CUP_METALS[metal] ?? CUP_METALS.gold;
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
  ], { o: P.ink, Y, g, d, M: P.mid, L: P.light }).toCanvas(scale);
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

/** An open atlas, lines on one page and a fish on the other: the collection. */
export function atlasSprite(scale = 3) {
  return fromRows([
    "................",
    ".oooooo..oooooo.",
    "oWWWWWWooWWWWWWo",
    "oWLLLLWooWWWWWWo",
    "oWWWWWWooWWWWWWo",
    "oWLLLLWoosWSSSWo",
    "oWWWWWWooWSSSoSo",
    "oWLLLWWoosWSSSWo",
    "oWWWWWWooWWWWWWo",
    "oWLLLLWooWLLLLWo",
    "oWWWWWWooWWWWWWo",
    "oRRRRRRooRRRRRRo",
    ".oooooooooooooo.",
    "................",
  ], { o: P.ink, W: P.bone, L: P.mid, S: P.soft, s: P.soft, R: P.ember }).toCanvas(scale);
}

/*
 * The anglers a player can pick as their picture: head and shoulders on a
 * 24-pixel grid, lit from the top left (a lit forehead, a shaded right
 * cheek, eyes with whites, brows, nose and ears), each with a hat or hair of
 * its own (ribbed bobble hats, woven straw, fur, a dotted headscarf), a skin
 * tone, a jacket with its collar, and some a beard, a moustache or glasses.
 * One more, SPECIAL_AVATAR, is not among the picks: it is the game's
 * author's own, on a sunburst of its own (the server keeps it to the admins).
 */
const SKIN = { light: "#e0bc94", tan: "#c08a5e", dark: "#8a5a3a", ruddy: "#dca084" };
export const AVATARS = [
  { hat: "bucket", hatColor: "#7a6a3a", skin: "light", jacket: "#3c6860", hair: "#5a3a1e" },
  { hat: "cap", hatColor: "#b8402e", skin: "light", jacket: "#3a5a86", face: "moustache", hair: "#5a3a1e" },
  { hat: "beanie", hatColor: "#d0782e", skin: "ruddy", jacket: "#2e4a32", face: "beard", hair: "#b8b8a8" },
  { hat: "straw", hatColor: "#d8c070", skin: "tan", jacket: "#d8d4c0", shirt: "#8a3a2a", hair: "#3a2a1a" },
  { hat: "none", hair: "#3a2a1a", skin: "light", jacket: "#5a5e62", glasses: true },
  { hat: "ushanka", hatColor: "#6a4a2e", skin: "ruddy", jacket: "#5e6a3a", face: "moustache", hair: "#3a2a1a" },
  { hat: "cap", hatColor: "#4e6a3a", skin: "dark", jacket: "#4e5a36", hair: "#1e1a18" },
  { hat: "bald", skin: "tan", jacket: "#6a4a6e", face: "moustache", hair: "#c8c8bc", sides: true, glasses: true },
  { hat: "beanie", hatColor: "#3a6a9a", skin: "light", jacket: "#7a4a8a", long: "#d8b860", hair: "#b8903a" },
  { hat: "bucket", hatColor: "#e2b85e", skin: "light", jacket: "#e2b85e", shirt: "#3c6860", hair: "#5a3a1e" },
  { hat: "scarf", hatColor: "#b83a3a", skin: "ruddy", jacket: "#3a5a86", hair: "#5a3a1e" },
  { hat: "cap", hatColor: "#2a2a2e", skin: "light", jacket: "#2a2e32", face: "beard", hair: "#c4643e" },
];
const SPECIAL_LOOK = { hat: "bald", skin: "light", top: "tank", face: "beard", hair: "#1c1a1c", back: "sunburst" };

function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function drawAngler(look) {
  const grid = new Grid(24, 24);
  const fill = (x0, y0, x1, y1, color) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grid.set(x, y, color);
  };
  const dot = (x, y, color) => grid.set(x, y, color);
  const skin = SKIN[look.skin];
  const skinShade = tint(skin, 0.86);
  const skinLit = tint(skin, 1.1);
  const hair = look.hair ?? "#3a2a1a";

  // Shoulders: a jacket with the shirt's collar, or a white vest on bare shoulders.
  if (look.top === "tank") {
    fill(6, 19, 17, 19, skin);
    fill(3, 20, 20, 23, skin);
    fill(3, 21, 4, 23, skinLit);
    fill(19, 21, 20, 23, skinShade);
    const vest = "#ecebe2";
    fill(7, 20, 16, 23, vest);
    fill(7, 18, 8, 19, vest);
    fill(15, 18, 16, 19, vest);
    fill(10, 20, 13, 20, skin);
    fill(15, 21, 16, 23, "#cfcdc0");
    dot(9, 22, "#d8d6ca");
  } else {
    const jacket = look.jacket;
    const jacketDark = tint(jacket, 0.78);
    const shirt = look.shirt ?? "#d8d4c0";
    fill(6, 19, 17, 19, jacket);
    fill(3, 20, 20, 23, jacket);
    fill(3, 21, 5, 23, tint(jacket, 1.14));
    fill(18, 21, 20, 23, jacketDark);
    fill(10, 19, 13, 19, shirt);
    fill(11, 20, 12, 21, shirt);
    fill(9, 19, 9, 20, jacketDark);
    fill(14, 19, 14, 20, jacketDark);
    dot(10, 20, jacketDark);
    dot(13, 20, jacketDark);
    dot(11, 22, jacketDark);
    dot(12, 23, jacketDark);
    fill(5, 22, 7, 22, jacketDark);
  }
  fill(9, 16, 14, 18, skinShade);
  if (look.long) {
    fill(4, 8, 6, 19, look.long);
    fill(17, 8, 19, 19, look.long);
    for (let y = 9; y <= 19; y += 2) {
      dot(5, y, tint(look.long, 0.82));
      dot(18, y, tint(look.long, 0.82));
    }
  }

  // The head, lit from the top left.
  fill(7, 6, 16, 6, skin);
  fill(6, 7, 17, 15, skin);
  fill(7, 16, 16, 16, skin);
  fill(16, 8, 17, 14, skinShade);
  dot(16, 15, skinShade);
  fill(8, 7, 10, 7, skinLit);
  fill(5, 10, 5, 12, skin);
  dot(5, 11, skinShade);
  fill(18, 10, 18, 12, skinShade);
  fill(8, 9, 10, 9, hair);
  fill(13, 9, 15, 9, hair);
  dot(8, 11, "#f0ece0");
  dot(9, 11, P.ink);
  dot(14, 11, P.ink);
  dot(15, 11, "#f0ece0");
  dot(11, 12, skinShade);
  dot(12, 12, skinShade);
  dot(11, 13, skinShade);
  dot(12, 13, tint(skin, 0.72));
  if (look.skin === "ruddy") {
    dot(8, 13, "#d88070");
    dot(15, 13, "#d88070");
  }
  fill(10, 15, 13, 15, tint(skin, 0.62));

  if (look.face === "beard") {
    const dark = tint(hair, 0.72);
    fill(6, 11, 6, 15, hair);
    fill(17, 11, 17, 15, hair);
    fill(7, 14, 16, 17, hair);
    fill(8, 18, 15, 18, hair);
    fill(10, 19, 13, 19, hair);
    for (let y = 15; y <= 18; y += 1) for (let x = 7; x <= 16; x += 1) if ((x + y * 2) % 4 === 0) dot(x, y, dark);
    fill(9, 14, 14, 14, dark);
    fill(10, 15, 13, 15, tint(skin, 0.55));
  } else if (look.face === "moustache") {
    fill(9, 14, 14, 14, hair);
    dot(9, 15, hair);
    dot(14, 15, hair);
  }
  if (look.glasses) {
    // A thin frame round each eye, the bridge between them; the eyes show through.
    const rim = "#4a4440";
    for (const x0 of [7, 13]) {
      fill(x0, 10, x0 + 3, 10, rim);
      dot(x0, 11, rim);
      dot(x0 + 3, 11, rim);
      fill(x0 + 1, 12, x0 + 2, 12, rim);
    }
    fill(11, 10, 12, 10, rim);
  }

  // The hat, or the hair.
  const hat = look.hatColor;
  const dark = hat && tint(hat, 0.72);
  const light = hat && tint(hat, 1.22);
  switch (look.hat) {
    case "bucket":
      fill(8, 1, 15, 1, hat);
      fill(7, 2, 16, 4, hat);
      fill(9, 2, 11, 2, light);
      fill(7, 5, 16, 5, dark);
      fill(3, 6, 20, 6, hat);
      fill(3, 7, 20, 7, dark);
      dot(4, 6, light);
      break;
    case "cap":
      fill(8, 1, 15, 1, hat);
      fill(7, 2, 16, 6, hat);
      fill(8, 2, 10, 3, light);
      for (let y = 2; y <= 6; y += 1) dot(12, y, dark);
      dot(11, 0, dark);
      dot(12, 0, dark);
      fill(5, 7, 18, 7, dark);
      fill(6, 8, 17, 8, tint(hat, 0.55));
      fill(6, 9, 6, 11, hair);
      fill(17, 9, 17, 11, hair);
      break;
    case "beanie":
      fill(8, 2, 15, 2, hat);
      fill(7, 3, 16, 6, hat);
      for (let x = 7; x <= 16; x += 2) for (let y = 3; y <= 6; y += 1) dot(x, y, dark);
      fill(6, 7, 17, 8, light);
      for (let x = 6; x <= 17; x += 2) dot(x, 8, hat);
      fill(10, 0, 13, 1, "#e2e2c8");
      dot(10, 1, "#c8c8b4");
      break;
    case "straw":
      fill(8, 2, 15, 5, hat);
      fill(2, 6, 21, 7, tint(hat, 0.92));
      for (let y = 2; y <= 7; y += 1) for (let x = 2; x <= 21; x += 1) if ((x + y) % 3 === 0 && grid.get(x, y)) dot(x, y, tint(hat, 0.78));
      fill(8, 5, 15, 5, "#8a3a2a");
      dot(14, 5, "#b85a3a");
      break;
    case "ushanka":
      fill(8, 0, 15, 0, hat);
      fill(7, 1, 16, 4, hat);
      for (let y = 1; y <= 4; y += 1) for (let x = 7; x <= 16; x += 1) if ((x * 3 + y) % 5 === 0) dot(x, y, dark);
      fill(5, 5, 18, 7, light);
      fill(4, 8, 6, 15, light);
      fill(17, 8, 19, 15, light);
      for (let y = 5; y <= 15; y += 1) for (let x = 4; x <= 19; x += 1) if ((x + y) % 3 === 0 && grid.get(x, y) === light) dot(x, y, tint(light, 0.88));
      dot(5, 16, dark);
      dot(18, 16, dark);
      break;
    case "scarf":
      fill(7, 2, 16, 2, hat);
      fill(6, 3, 17, 8, hat);
      fill(5, 8, 6, 17, hat);
      fill(17, 8, 18, 17, hat);
      for (let y = 2; y <= 17; y += 1) for (let x = 5; x <= 18; x += 1) if ((x + y * 2) % 5 === 0 && grid.get(x, y) === hat) dot(x, y, "#e2e2c8");
      fill(6, 8, 17, 8, dark);
      fill(10, 17, 13, 18, dark);
      dot(11, 19, hat);
      dot(12, 19, hat);
      break;
    case "none":
      fill(7, 3, 16, 3, hair);
      fill(6, 4, 17, 7, hair);
      for (let x = 7; x <= 16; x += 3) for (let y = 4; y <= 7; y += 1) dot(x, y, tint(hair, 1.35));
      fill(7, 8, 10, 8, hair);
      fill(6, 8, 6, 11, hair);
      fill(17, 8, 17, 11, hair);
      break;
    case "bald":
      fill(8, 3, 15, 3, skin);
      fill(7, 4, 16, 5, skin);
      fill(15, 4, 16, 6, skinShade);
      fill(9, 4, 11, 4, skinLit);
      dot(10, 3, skinLit);
      if (look.sides) {
        fill(6, 8, 6, 11, hair);
        fill(17, 8, 17, 11, hair);
      }
      break;
    default:
      break;
  }
  return grid;
}

/* The author's own background: quiet, in the game's greens, faint rays behind the head and a thin brass edge. */
function sunburst(grid) {
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      const dx = x - 11.5;
      const dy = y - 11;
      const ray = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 8)) % 2;
      const d = Math.hypot(dx, dy);
      grid.set(x, y, d < 10.5 ? (ray ? "#284640" : "#22403a") : ray ? "#1e3833" : "#19302b");
    }
  }
  for (const [x, y] of [[2, 3], [21, 2]]) grid.set(x, y, "#58726a");
  for (let i = 0; i < 24; i += 1) {
    grid.set(i, 0, P.goldDark);
    grid.set(i, 23, P.goldDark);
    grid.set(0, i, P.goldDark);
    grid.set(23, i, P.goldDark);
  }
}

/** One of the anglers above, or the author's own (an unknown pick is the first). */
export function avatarSprite(id = 0, scale = 3) {
  const look = id === SPECIAL_AVATAR ? SPECIAL_LOOK : AVATARS[id] ?? AVATARS[0];
  const figure = drawAngler(look).outline(P.ink);
  if (!look.back) return figure.toCanvas(scale);
  const grid = new Grid(24, 24);
  sunburst(grid);
  for (let y = 0; y < 24; y += 1) for (let x = 0; x < 24; x += 1) if (figure.get(x, y)) grid.set(x, y, figure.get(x, y));
  return grid.toCanvas(scale);
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

/*
 * The extras, on one 16-pixel square each, lit from the top left like the
 * rest: a light edge on the left and top, a shade on the right and bottom.
 */
const EXTRA_SPRITES = {
  // A float with a glowing tip for fishing at night.
  glowfloat: () => fromRows([
    "......gYg.......",
    ".....gYYYg......",
    "......oYo.......",
    "......oYo.......",
    ".....oRRRo......",
    "....oRrRRRo.....",
    "...oRrRRRRdo....",
    "...oRRRRRRdo....",
    "...oWwWWWWso....",
    "...oWwWWWWso....",
    "....oWWWWso.....",
    ".....oWWso......",
    "......oso.......",
    "......oDo.......",
    "......oDo.......",
    ".......o........",
  ], { o: P.ink, g: "#7ec86e", Y: "#d8ff9a", R: P.ember, r: "#e08a5e", d: "#9a4a2e", W: P.bone, w: "#f4f2e0", s: "#b8b6a2", D: P.mid }),
  // The angler's handbook: a red cloth cover with a gold fish on it, the pages showing below.
  handbook: () => fromRows([
    "................",
    "..ooooooooooooo.",
    ".oSRRRRRRRRRRRo.",
    ".oSRrrrrrrrrRRo.",
    ".oSRgggggggRRdo.",
    ".oSRgRYYRYgRRdo.",
    ".oSRgYYYYRgRRdo.",
    ".oSRgRYYRYgRRdo.",
    ".oSRgggggggRRdo.",
    ".oSRRRRRRRRRRdo.",
    ".oSRRRRRRRRRRdo.",
    ".oSdddddddddddo.",
    ".oSWWWWWWWWWWWo.",
    ".ooWwwwwwwwwwWo.",
    "...oooooooooooo.",
    "................",
  ], { o: P.ink, S: "#4a2418", R: "#8a3e2c", r: "#a8563a", d: "#64281c", g: P.goldDark, Y: P.gold, W: P.bone, w: "#c8c4b0" }),
  // A landing net: a round hoop of mesh, the bag hanging under it, on a wooden handle.
  net: () => {
    const grid = new Grid(16, 16);
    const cx = 10;
    const cy = 5.5;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const d = Math.hypot(x - cx, (y - cy) * 1.05);
        if (d >= 4 && d < 5.2) grid.set(x, y, d < 4.6 && x + y < 16 ? P.light : P.soft);
        else if (d < 4 && (x + y) % 2 === 0) grid.set(x, y, P.light);
        else if (y > 9 && y < 13 && Math.abs(x - cx - (y - 9) * 0.3) < 4 - (y - 9) && (x + y) % 2 === 0) grid.set(x, y, P.soft);
      }
    }
    for (let i = 0; i < 7; i += 1) {
      grid.set(6 - i, 9 + i, "#a0703e");
      grid.set(5 - i, 9 + i, "#7a5230");
    }
    return grid.outline(P.ink);
  },
  // A spool of braided line: the braid in two crossing colours, a loose end.
  braid: () => fromRows([
    "................",
    "..oooooooooooo..",
    ".oDDDDDDDDDDDDo.",
    ".oddddddddddddo.",
    "..oGgGgGgGgGgo..",
    "..ogGgGgGgGgGo..",
    "..oGgGgGgGgGgo..",
    "..ogGgGgGgGgGo..",
    "..oGgGgGgGgGgo..",
    "..ogGgGgGgGgGo..",
    ".oDDDDDDDDDDDDo.",
    ".oddddddddddddoo",
    "..oooooooooooogo",
    "..............og",
    "...............o",
    "................",
  ], { o: P.ink, D: P.mid, d: P.dark, G: P.gold, g: "#5e9a4a" }),
  // A spinning reel seen from the side: the foot that holds it to the rod, the spool wound with line, the crank and its knob.
  spinreel: () => fromRows([
    "................",
    "..oooooooooooo..",
    "..oddddddddddo..",
    "......oMMo......",
    "...ooooMMoooo...",
    "..oLLLLLLLLMMo..",
    ".oLGGGGGGGGGMMo.",
    ".oLgggggggggMMoo",
    ".oLGGGGGGGGGMMMo",
    ".oLgggggggggMMoH",
    "..oMMMMMMMMMMo.o",
    "...oooooooooo...",
    "................",
    "................",
    "................",
    "................",
  ], { o: P.ink, M: P.mid, L: P.light, G: P.soft, g: P.bone, H: P.gold, d: P.dark }),
  // A little brass bell on its loop, the clapper showing under the rim.
  bell: () => fromRows([
    "................",
    ".......oo.......",
    "......o..o......",
    ".......oo.......",
    "......oGGo......",
    ".....oGYYdo.....",
    "....oGYYYYdo....",
    "....oGYyYYdo....",
    "....oGYyYYdo....",
    "...oGYYyYYYdo...",
    "...oGYYYYYYdo...",
    "..oGYYYYYYYYdo..",
    "..oddddddddddo..",
    "...oooooooooo...",
    ".......oSo......",
    "........o.......",
  ], { o: P.ink, G: P.goldDark, Y: P.gold, y: "#f4dc9a", d: "#8a6a2c", S: P.soft }),
  // A feeder: a wire cage packed with groundbait, a lead weight at its foot, a swivel on top.
  feeder: () => fromRows([
    "................",
    ".......o........",
    "......oSo.......",
    ".......o........",
    ".....ooooo......",
    "....oMMMMMo.....",
    "....oMbMbMo.....",
    "....obMbMbo.....",
    "....oMbMbMo.....",
    "....obMbMbo.....",
    "....oMbMbMo.....",
    "....obMbMbo.....",
    "....oMMMMMo.....",
    "....oDDDDDo.....",
    ".....ooooo......",
    "................",
  ], { o: P.ink, S: P.soft, M: P.light, b: "#a07a48", D: P.mid }),
  // A bucket of water with a handle, small fish in it.
  bucket: () => fromRows([
    "................",
    "....HHHHHHHH....",
    "...H........H...",
    "..H..........H..",
    ".oooooooooooooo.",
    ".oLLLLLLLLLLLLo.",
    ".oWwWwWwWwWwWWo.",
    ".oWWWfWWWWfWWWo.",
    "..oLLLLLLLLLLo..",
    "..oLSLLLLLLSLo..",
    "..oLLLLLLLLLLo..",
    "...oLLLLLLLLo...",
    "...oLSLLLLSLo...",
    "...oLLLLLLLLo...",
    "....oooooooo....",
    "................",
  ], { o: P.ink, H: P.light, L: P.soft, S: P.mid, W: "#4a8a96", w: "#7ab8c0", f: P.bone }),
  // An echo sounder: fish as arcs over the bottom's line on its screen.
  sonar: () => fromRows([
    "................",
    ".oooooooooooooo.",
    ".oMLLLLLLLLLLMo.",
    ".oLkkkkkkkkkkdo.",
    ".oLkkkkkkkGGkdo.",
    ".oLkkkkkkkkkkdo.",
    ".oLkkGGGkkkkkdo.",
    ".oLkkkkkkkkkkdo.",
    ".oLsskkkkkkssdo.",
    ".oLssssskssssdo.",
    ".oMddddddddddMo.",
    ".oMHMMMMMMMMMMo.",
    ".oooooooooooooo.",
    ".....oMMMMo.....",
    "...oooooooooo...",
    "................",
  ], { o: P.ink, M: P.mid, L: P.light, d: P.dark, k: P.deep, G: P.gold, s: P.soft, H: P.ember }),
};

/* Each groundbait in its own sack (see GROUNDBAITS): the plain one sandy, the basic one sandy with corn on top, the predator one dark red, the premium one deep blue with gold; the carp, bream and trout ones are from before. */
const SACKS = {
  plain: { y: "#e0c068", T: "#c9a35a", R: P.ember, B: "#9a7a46", L: "#b8955a", b: "#6e5430" },
  carp: { y: "#f0d040", T: "#c9a35a", R: "#f0d040", B: "#5e7a3a", L: "#7e9a4e", b: "#3e5426" },
  bream: { y: "#e8e0b0", T: "#d8cca0", R: "#8a6a3a", B: "#b8ac84", L: "#d0c49a", b: "#867a58" },
  predator: { y: "#c84a3a", T: "#a07050", R: "#c84a3a", B: "#6e2e26", L: "#8e3e32", b: "#4a1e1a" },
  trout: { y: "#e88a8a", T: "#c9a35a", R: "#e88a8a", B: "#4e6a7a", L: "#6a8698", b: "#344a56" },
  basic: { y: "#f0d040", T: "#c9a35a", R: P.ember, B: "#9a7a46", L: "#b8955a", b: "#6e5430" },
  premium: { y: "#f4d870", T: "#e2b85e", R: "#f4d870", B: "#2a2e48", L: "#3e4468", b: "#181a2e" },
};
/** A tied sack of groundbait, crumbs spilling from the top, coloured for its kind. */
export function groundbaitSprite(scale = 3, kind = "plain") {
  return fromRows([
    "................",
    ".......y..y.....",
    ".....y..yy..y...",
    "......oooooo....",
    ".....oTTTTTTo...",
    "......oRRRRo....",
    ".....oBBBBBBo...",
    "....oBLBBBBBbo..",
    "...oBLBBBbBBBbo.",
    "...oBLBBBBBBBbo.",
    "...oBBBbBBBBBbo.",
    "...oBBBBBBbBBbo.",
    "...oBBBBBBBBBbo.",
    "....obbbbbbbbo..",
    ".....oooooooo...",
    "................",
  ], { o: P.ink, ...(SACKS[kind] ?? SACKS.plain) }).toCanvas(scale);
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
  return EXTRA_SPRITES[id]().trim().toCanvas(scale);
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
/*
 * Hooks by size (see HOOKS), each its own shape and metal so they tell apart
 * at a glance: a small fine-wire one, bright steel; the medium one, bronze; a
 * large forged one, dark, thick in the bend and with the barb showing.
 */
const HOOK_ROWS = {
  small: [
    "....oo..",
    "...oWo..",
    "...oLo..",
    "...oLo..",
    "...oLo..",
    ".o.oLo..",
    "oLooLo..",
    ".oLLo...",
    "..oo....",
  ],
  medium: [
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
  ],
  large: [
    ".......ooo....",
    "......oW.Wo...",
    "......oWWWo...",
    ".......oLLo...",
    ".......oLLo...",
    ".......oLLo...",
    ".......oLLo...",
    ".......oLLo...",
    ".oo....oLLo...",
    "oLWo...oLLo...",
    ".oLLo..oLLo...",
    ".oLLLooLLLo...",
    "..oLLLLLLo....",
    "...oLLLLo.....",
    "....oooo......",
  ],
};
const HOOK_METALS = {
  small: { L: "#c8d0d4", W: "#f2f6f8" },
  medium: { L: "#c89a52", W: "#f0d08a" },
  large: { L: "#6a737c", W: "#b4c0ca" },
};
export function hookSprite(scale = 3, size = "medium") {
  return fromRows(HOOK_ROWS[size] ?? HOOK_ROWS.medium, { o: P.ink, ...(HOOK_METALS[size] ?? HOOK_METALS.medium) }).toCanvas(scale);
}

/**
 * A float skin (see FLOAT_SKINS) for the shop and the backpack: its glyphs
 * stacked as on the water, each outlined dark, over a short ripple.
 */
export function floatSprite(rows, scale = 3) {
  const size = 16 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // As big as fits: the stack of rows (each 0.62 of a glyph above the last) within three quarters of the square.
  const px = Math.round(Math.min(size * 0.5, (size * 0.72) / (1 + 0.62 * (rows.length - 1))));
  ctx.font = `700 ${px}px "SFMono-Regular", Menlo, Consolas, monospace`;
  ctx.lineWidth = Math.max(2, scale);
  ctx.strokeStyle = P.ink;
  const step = px * 0.62;
  const waterline = size * 0.8;
  ctx.fillStyle = P.soft;
  ctx.fillText("~", size * 0.25, waterline + px * 0.35);
  ctx.fillText("~", size * 0.75, waterline + px * 0.35);
  rows.forEach(([glyph, color], index) => {
    const y = waterline - (rows.length - 1 - index) * step;
    ctx.strokeText(glyph, size / 2, y);
    ctx.fillStyle = color;
    ctx.fillText(glyph, size / 2, y);
  });
  return canvas;
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

/** Rain cloud for the clock while it's raining; flakes under it in winter. */
export function rainSprite(scale = 3, snow = false) {
  return fromRows([
    "....oooo....",
    "..ooLLLLoo..",
    ".oLLBBBBLLo.",
    "oLBBBBBBBBLo",
    "oBBBBBBBBBBo",
    ".oooooooooo.",
    snow ? "..s...s...s." : "..d..d..d...",
    snow ? "....s...s..." : ".d..d..d....",
  ], { o: P.ink, L: P.bone, B: P.light, d: "#8fb4d0", s: "#f2f6f8" }).toCanvas(scale);
}

/** Gusts of wind for the clock while it blows. */
export function windSprite(scale = 3) {
  return fromRows([
    "......ooo...",
    "oooooooLLo..",
    "LLLLLLLLLo..",
    "........o...",
    "ooooooooooo.",
    "LLLLLLLLLLLo",
    "..........o.",
    "ooooooo.....",
    "LLLLLLo.....",
  ], { o: P.ink, L: P.light }).toCanvas(scale);
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
