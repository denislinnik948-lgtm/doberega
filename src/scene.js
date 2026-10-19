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

/** Bank width on one side of the bridge river at a screen depth (0 top .. 1 bottom). */
function riverBank(depth, side) {
  const t = Math.max(0, (depth - 0.4) / 0.6);
  const center = 0.5 + 0.09 * (1 - t) ** 2;
  const half = 0.15 + 0.31 * t ** 0.9;
  const wobble = Math.sin(depth * 31 + side) * 0.008 + Math.sin(depth * 73 + side * 2) * 0.004;
  return side < 0 ? center - half + wobble : 1 - center - half + wobble;
}

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
  /**
   * Old bridge over a fast river: we stand at the wooden railing looking
   * downstream; willow banks converge on a bend and the current races away.
   */
  bridge: {
    horizon: 0.4,
    ridges: [
      { top: 0.33, amplitude: 0.05, seed: 1.3, fill: "#4a5960", glyph: "#68777c", texture: ".:'", density: 0.14 },
      { top: 0.375, amplitude: 0.025, seed: 3.8, fill: "#33433b", glyph: "#4a5b4c", texture: "^.*", density: 0.3 },
    ],
    forest: { heightScale: 1.25, spacingScale: 1, broadleaf: 0.7, round: 0.5, bankTrees: true },
    banks: {
      style: "willow",
      // The river narrows toward a bend just right of centre.
      left: (depth) => riverBank(depth, -1),
      right: (depth) => riverBank(depth, 1),
    },
    structures: {},
    water: { flow: 90, flowAway: true },
    foreground: { reeds: 0.35, rock: false, lilyPads: 0, bridge: 0.875 },
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
  if (active.foreground.bridge && y > active.foreground.bridge * height) return false;
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
