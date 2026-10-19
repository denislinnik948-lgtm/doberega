/**
 * Scene layouts, one per kind of fishing spot, expressed as fractions of the
 * viewport. The active profile drives the horizon, ridges, forest, banks,
 * man-made structures, water behaviour and foreground.
 */

export const SUN = { x: 0.37, y: 0.252, radius: 0.03 };

const LAKE_RIDGES = [
  { top: 0.335, amplitude: 0.085, seed: 1.6, fill: "#4c5961", glyph: "#6c787d", texture: ".:'", density: 0.16 },
  { top: 0.385, amplitude: 0.045, seed: 3.4, fill: "#34433f", glyph: "#4b5a52", texture: ".:;", density: 0.2 },
  { top: 0.42, amplitude: 0.022, seed: 5.2, fill: "#26352d", glyph: "#3a4c3d", texture: "^^*.", density: 0.34 },
];

export const SCENES = {
  /**
   * Village pond in open farmland: a low, flat far bank of meadows and a
   * ploughed strip, scattered groups of trees, a few small houses far off, a
   * line of reeds along the far edge, and thick reeds framing the near water.
   */
  pond: {
    horizon: 0.44,
    ridges: [
      // Distant meadows: almost flat, bright green, with a darker ploughed strip.
      { top: 0.405, amplitude: 0.008, seed: 2.2, fill: "#4f6d40", glyph: "#6f8f52", texture: ",'.\"", density: 0.22 },
      { top: 0.425, amplitude: 0.004, seed: 5.1, fill: "#5a4a34", glyph: "#7a6448", texture: "=-_", density: 0.4 },
    ],
    forest: {
      heightScale: 1.05, spacingScale: 2.6, broadleaf: 0.85, round: 0.6, poplar: 0.35,
      silhouette: "crowns", lift: 0.3,
      gaps: [[0.36, 0.47], [0.66, 0.74]],
    },
    structures: {
      houses: { at: [0.07, 0.31, 0.95], scale: 0.75 },
    },
    shore: "reeds",
    water: {},
    foreground: { reeds: 2.2, rock: false, lilyPads: 0 },
  },
  /** Quiet lake: layered mountains behind a forested shore. */
  lake: {
    horizon: 0.47,
    ridges: LAKE_RIDGES,
    forest: {},
    structures: {},
    water: {},
    foreground: { reeds: 1, rock: true, lilyPads: 5 },
  },
  /** Stony ford: a flowing river, rocks breaking the surface, a grassy near bank. */
  river: {
    horizon: 0.44,
    ridges: [
      { top: 0.37, amplitude: 0.06, seed: 0.7, fill: "#45555a", glyph: "#64747a", texture: ".:'", density: 0.14 },
      { top: 0.415, amplitude: 0.028, seed: 2.9, fill: "#2e3d38", glyph: "#45574b", texture: "^.*", density: 0.3 },
    ],
    forest: { heightScale: 1.2, spacingScale: 1.1, broadleaf: 0.45 },
    banks: { style: "grass", left: (depth) => Math.max(0, depth - 0.42) * 0.55, right: () => 0 },
    structures: {},
    water: {
      flow: 26,
      rocks: [
        { x: 0.26, y: 0.6, r: 0.034 }, { x: 0.37, y: 0.65, r: 0.028 }, { x: 0.48, y: 0.58, r: 0.024 },
        { x: 0.61, y: 0.67, r: 0.04 }, { x: 0.73, y: 0.6, r: 0.028 }, { x: 0.85, y: 0.7, r: 0.046 },
      ],
    },
    foreground: { reeds: 0.45, rock: false, lilyPads: 0 },
  },
  /** Reservoir bay: wide water, low far hills, a concrete dam and power lines. */
  reservoir: {
    horizon: 0.42,
    ridges: [
      { top: 0.37, amplitude: 0.04, seed: 0.3, fill: "#4a575e", glyph: "#66757a", texture: ".:'", density: 0.12 },
      { top: 0.405, amplitude: 0.02, seed: 2.6, fill: "#34433f", glyph: "#4b5a52", texture: ".:;", density: 0.2 },
    ],
    forest: { heightScale: 0.55, spacingScale: 1.7, broadleaf: 0.3, gaps: [[0.58, 1.02]] },
    structures: { dam: { from: 0.6, to: 0.97 }, pylons: [0.14, 0.33, 0.5] },
    water: {},
    foreground: { reeds: 0, rock: false, lilyPads: 0, blocks: true },
  },
  /** The old pit: steep rocky banks, dark spruce, a slow whirlpool and drowned snags. */
  pit: {
    horizon: 0.4,
    ridges: [
      { top: 0.33, amplitude: 0.1, seed: 4.4, fill: "#26302e", glyph: "#3a4642", texture: "^.:", density: 0.28 },
    ],
    forest: { heightScale: 1.5, spacingScale: 0.85, broadleaf: 0.03 },
    banks: {
      style: "cliff",
      left: (depth) => 0.2 + Math.max(0, depth - 0.4) * 0.38 + Math.sin(depth * 19) * 0.012,
      right: (depth) => 0.17 + Math.max(0, depth - 0.45) * 0.42 + Math.cos(depth * 23) * 0.012,
    },
    structures: {},
    water: { whirl: { x: 0.52, y: 0.66, r: 0.12 } },
    foreground: { reeds: 0.25, rock: false, lilyPads: 0, snags: true },
  },
};

let active = SCENES.lake;

export function setScene(kind) {
  active = SCENES[kind] ?? SCENES.lake;
  return active;
}

export function activeScene() {
  return active;
}

export function shorelineY(x, height) {
  return height * active.horizon
    + Math.sin(x * 0.007 + 0.8) * height * 0.006
    + Math.sin(x * 0.016 - 1.4) * height * 0.0025;
}

/** Fraction of the width covered by the near banks at a screen depth (0 top .. 1 bottom). */
export function bankWidths(depth) {
  const banks = active.banks;
  if (!banks || depth < active.horizon) return { left: 0, right: 0 };
  return { left: Math.max(0, banks.left(depth)), right: Math.max(0, banks.right(depth)) };
}

/** Is this screen point open water (not bank, rock or shore)? */
export function isOpenWater(x, y, width, height) {
  if (y < shorelineY(x, height)) return false;
  const { left, right } = bankWidths(y / height);
  if (x < left * width || x > width * (1 - right)) return false;
  for (const rock of active.water.rocks ?? []) {
    const r = rock.r * Math.min(width, height * 1.6);
    if (((x - rock.x * width) / r) ** 2 + ((y - rock.y * height) / (r * 0.45)) ** 2 < 1.4) return false;
  }
  return true;
}


export function sunPosition(width, height) {
  return {
    x: width * SUN.x,
    y: height * SUN.y,
    radius: Math.max(13, Math.min(width, height) * SUN.radius),
  };
}
