/**
 * Scene layouts, one per kind of fishing spot, expressed as fractions of the
 * viewport. The active profile drives the horizon, ridges, forest, banks,
 * man-made structures, water behaviour and foreground.
 */

/**
 * Current scene width, for landscape features laid out across it, and the
 * slice actually on screen (`left`, `frameWidth`), which is narrower on a phone.
 */
export const view = { width: 1600, left: 0, frameWidth: 1600 };

export const SUN = { x: 0.37, y: 0.252, radius: 0.03 };

/** Bank width on one side of the bridge river at a screen depth (0 top .. 1 bottom); negative means off screen. */
function riverBank(depth, side) {
  const t = Math.max(0, (depth - 0.4) / 0.6);
  // Far off the river swings right and leaves the view past the right edge.
  const center = 0.5 + 0.55 * (1 - t) ** 2.2;
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
      { top: 0.405, amplitude: 0.008, seed: 2.2, fill: "#4f6d40", glyph: "#6f8f52", texture: ",'.\"", density: 0.22, breeze: true },
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
    // We stand on a low grassy bank that rises into mounds at the corners.
    nearBank: 0.075,
    foreground: { reeds: 2.2, rock: false, lilyPads: 0 },
  },
  /** Quiet lake: an old, tall conifer forest, pines and spruces, stands along the far shore. */
  lake: {
    horizon: 0.47,
    ridges: [],
    forest: { heightScale: 2.2, spacingScale: 0.75, broadleaf: 0 },
    structures: {},
    water: {},
    nearBank: 0.055,
    foreground: { reeds: 1, rock: true, lilyPads: 5 },
  },
  /**
   * Castle lake: a dark wooded hill rising to a sheer cliff with an ancient
   * ruined castle on top, snowy mountains beyond, and calm emerald water.
   */
  castle: {
    horizon: 0.5,
    // On a narrow screen, keep the castle crag in view.
    focus: 0.3,
    ridges: [
      // Snowy alpine range, low behind the castle hill and high on the right.
      { top: 0.46, amplitude: 0.3, seed: 1.9, jagged: true, alpine: true, rise: [0.3, 0.66], snowline: 0.28, haze: 0.2, fill: "#5d7084", glyph: "#8193a5", texture: ".'", density: 0.05 },
      { top: 0.48, amplitude: 0.08, seed: 4.6, jagged: true, alpine: true, rise: [0.4, 0.8], haze: 0.12, fill: "#3e5160", glyph: "#56697a", texture: ".'", density: 0.05 },
    ],
    forest: { heightScale: 0.95, spacingScale: 0.95, broadleaf: 0.85, round: 0.6 },
    structures: {
      crag: { to: 0.66, peak: 0.26 },
      houses: { at: [0.82, 0.95], scale: 0.6, roof: "#b04a30", walls: "#d6cfbc" },
      archBridge: { from: 0.03, to: 0.2, arches: 3 },
    },
    // Glacial turquoise water over a pale stony bottom.
    water: { body: "#11423f" },
    foreground: { reeds: 0.5, rock: false, lilyPads: 0 },
  },
  /**
   * Pripyat: the cooling reservoir by the Chornobyl power plant, seen across
   * flat water. The plant stretches along the far shore over a low line of
   * willows, the woods are dry yellow and brown, the water murky, a rusting
   * ship lies half sunk near the far bank, and dry reeds frame the view.
   */
  reservoir: {
    horizon: 0.42,
    ridges: [
      // Barely a rise: a flat, hazy plain beyond the plant.
      { top: 0.405, amplitude: 0.006, seed: 2.6, fill: "#5e5640", glyph: "#7c7150", texture: ".:'", density: 0.16 },
    ],
    forest: { heightScale: 0.6, spacingScale: 1.4, broadleaf: 0.9, round: 0.7, dry: true, gaps: [[0.05, 0.98]] },
    structures: { chnpp: { from: 0.06, to: 0.97 } },
    shore: "reeds",
    // Sun-bleached reeds and dry grass rather than green.
    dry: true,
    // A weak current sets slowly toward the plant's outflow; the water is murky.
    // The wreck: a rusting ship listing near the far bank, bow up (centre, width as screen fractions).
    water: { drift: { x: 0.0016, y: 0 }, body: "#353120", wreck: { x: 0.3, y: 0.52, w: 0.15 } },
    // A rusty radiation sign leans among the reeds on the right.
    foreground: { reeds: 1.6, rock: false, lilyPads: 0, sign: { x: 0.84, lean: 0.2 } },
  },
  /**
   * Old bridge over a fast river: we stand at the wooden railing looking
   * downstream; the current runs away from us and swings right round a bend.
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
    // The current runs away from us, then turns right with the bend
    // (pivot and the depths where the turn starts and completes).
    water: { flow: 60, flowAway: true, bend: { x: 1.05, y: 0.68, from: 0.66, to: 0.43 }, drift: { away: 0.009 } },
    foreground: { reeds: 0, rock: false, lilyPads: 0, bridge: 0.875 },
    // Fast water carries no mist.
    mist: false,
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

/**
 * Top edge of the grassy bank we stand on (pond and lake), following the slice
 * on screen: low in the middle, rising into mounds at the corners. Without a
 * near bank it is below the view.
 */
export function nearBankY(x, height) {
  if (!active.nearBank) return Infinity;
  const u = (x - view.left) / view.frameWidth;
  const corner = Math.max(0, Math.abs(u - 0.5) * 2 - 0.35) / 0.65;
  const lift = active.nearBank * (1 + corner * corner * 1.9) + Math.sin(u * 17 + 1.3) * 0.006 + Math.sin(u * 41) * 0.003;
  return height * (1 - lift);
}

/**
 * The half-sunk ship at Pripyat, in screen pixels: the deck and keel lines
 * along the hull (u = 0 stern, under water .. 1 bow, raised high), the
 * wheelhouse toward the stern, and whether a point is part of it.
 */
export function wreckShape(width, height) {
  const wreck = active.water.wreck;
  if (!wreck) return null;
  const cx = wreck.x * width;
  const waterline = wreck.y * height;
  const half = (wreck.w * width) / 2;
  // Heights scale with the ship's width: far off, it is smaller all round.
  const size = (wreck.w / 0.2) * height;
  const deck = (u) => waterline - size * (0.012 + 0.075 * u ** 1.7);
  // The raked stem lifts the hull clear of the water at the bow.
  const keel = (u) => waterline - size * 0.004 - (u > 0.86 ? ((u - 0.86) / 0.14) * size * 0.055 : 0);
  const house = { from: 0.14, to: 0.4, height: size * 0.045 };
  const along = (x) => (x - (cx - half)) / (2 * half);
  return {
    cx, waterline, half, size, deck, keel, house, along,
    covers(x, y) {
      const u = along(x);
      if (u < 0 || u > 1) return false;
      const top = deck(u) - (u >= house.from && u <= house.to ? house.height : 0);
      return y > top && y < keel(u) + size * 0.012;
    },
  };
}

/** Is this screen point open water (not bank, rock or shore)? */
export function isOpenWater(x, y, width, height) {
  if (y < shorelineY(x, height)) return false;
  if (y > nearBankY(x, height)) return false;
  if (active.foreground.bridge && y > active.foreground.bridge * height) return false;
  const { left, right } = bankWidths(y / height);
  if (x < left * width || x > width * (1 - right)) return false;
  for (const rock of active.water.rocks ?? []) {
    const r = rock.r * Math.min(width, height * 1.6);
    if (((x - rock.x * width) / r) ** 2 + ((y - rock.y * height) / (r * 0.45)) ** 2 < 1.4) return false;
  }
  if (wreckShape(width, height)?.covers(x, y)) return false;
  return true;
}


/**
 * How fast the current carries a float at a normalized screen point, in
 * screen fractions per second. Still water returns zero. A downstream river
 * carries it away from the viewer, slower in the distance, and round the bend.
 */
export function currentAt(x, y) {
  const { drift, bend } = active.water;
  if (!drift) return { x: 0, y: 0 };
  if (!drift.away) return { x: drift.x ?? 0, y: drift.y ?? 0 };
  const distance = Math.min(1, Math.max(0.15, (y - active.horizon) / (1 - active.horizon)));
  const turn = bend ? Math.min(1, Math.max(0, (bend.from - y) / (bend.from - bend.to))) ** 1.4 * Math.PI * 0.5 : 0;
  return { x: Math.sin(turn) * drift.away * distance, y: -Math.cos(turn) * drift.away * distance };
}

export function sunPosition(width, height) {
  return {
    x: width * SUN.x,
    y: height * SUN.y,
    radius: Math.max(13, Math.min(width, height) * SUN.radius),
  };
}
