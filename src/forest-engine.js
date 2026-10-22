import { hash01 } from "./noise.js";
import { activeScene, shorelineY } from "./scene.js";
import { isAutumn, isDarkFantasy } from "./theme.js";

const FOREST_LAYERS = [
  { offset: 0.034, variation: 0.01, height: [0.03, 0.055], spacing: [30, 52], sway: 0.075 },
  { offset: 0.018, variation: 0.008, height: [0.046, 0.085], spacing: [30, 55], sway: 0.13 },
  { offset: 0.004, variation: 0.006, height: [0.06, 0.108], spacing: [34, 62], sway: 0.22 },
];

const FOLIAGE = [
  { shadow: "#3c4b45", middle: "#4d5c51", light: "#7f7c5f" },
  { shadow: "#2e3f33", middle: "#405241", light: "#878159" },
  { shadow: "#203026", middle: "#304431", light: "#857a4a" },
];

// Trees on the near banks are close and well lit, so their greens read brighter.
const BANK_FOLIAGE = { shadow: "#2a4a30", middle: "#47703f", light: "#9cac62" };

// Autumn crowns: blood red, rust, gold and brown, picked per tree.
const AUTUMN = [
  { share: 0.3, shadow: "#5c1a14", middle: "#962c1e", light: "#cc4a2a" },
  { share: 0.3, shadow: "#6a2c10", middle: "#ad4a1a", light: "#de7a2c" },
  { share: 0.22, shadow: "#6a4c12", middle: "#ab821c", light: "#e0b43e" },
  { share: 0.1, shadow: "#46220f", middle: "#743a1e", light: "#a15a32" },
];

/** A broadleaf tree's autumn palette, or null for the odd one still green. */
function autumnPalette(tree) {
  let pick = hash01(tree.seed * 83);
  for (const palette of AUTUMN) {
    if (pick < palette.share) return palette;
    pick -= palette.share;
  }
  return null;
}

function chooseSpecies(seed, layerIndex, broadleaf) {
  // Dark fantasy leaves about a third of the woods dead and bare.
  if (isDarkFantasy() && hash01(seed * 71) < 0.32) return "dead";
  const value = hash01(seed * 37);
  // A scene can force mostly conifers (0) or mostly broadleaf trees (1).
  if (broadleaf !== undefined) {
    if (value < broadleaf) return hash01(seed * 41) < 1 - (activeScene().forest.round ?? 0.4) ? "oak" : "round";
    return hash01(seed * 41) < 0.55 ? "pine" : "spruce";
  }
  const broadleafBias = [0.2, 0.32, 0.42][layerIndex];
  if (value < 0.43 - broadleafBias * 0.24) return "pine";
  if (value < 0.69 - broadleafBias * 0.12) return "spruce";
  if (value < 0.83 + broadleafBias * 0.08) return "oak";
  return "round";
}

function createTrees(width, height, sunX) {
  const trees = [];
  const { heightScale = 1, spacingScale = 1, broadleaf, gaps = [], poplar = 0, lift = 1 } = activeScene().forest;
  const inGap = (x) => gaps.some(([from, to]) => x > from * width && x < to * width);

  FOREST_LAYERS.forEach((layer, layerIndex) => {
    let index = 0;
    for (let x = -90; x < width + 90; index += 1) {
      const seed = 419 + layerIndex * 10000 + index;
      const species = chooseSpecies(seed, layerIndex, broadleaf);
      const centerX = x + (hash01(seed * 17) - 0.5) * 20;
      const terrain = Math.sin(centerX * 0.0033 + layerIndex * 1.7) * 0.006
        + Math.sin(centerX * 0.009 + layerIndex * 0.8) * 0.0025;
      // A low, flat bank (lift < 1) keeps distant trunks on the meadow instead of the sky.
      const baseOffset = lift * (layer.offset
        + hash01(seed * 19) * layer.variation
        + terrain);
      const baseY = shorelineY(centerX, height) - height * baseOffset;
      // Some scenes scatter tall, narrow poplars among the rounder crowns.
      const tall = species === "round" && hash01(seed * 61) < poplar;
      const treeHeight = heightScale * height * (tall ? 1.55 : 1) * (
        layer.height[0] + hash01(seed * 23) * (layer.height[1] - layer.height[0])
      );
      const broad = species === "oak" || species === "round";
      const maxWidth = treeHeight * (tall ? 0.2 + hash01(seed * 29) * 0.06 : broad
        ? 0.4 + hash01(seed * 29) * 0.2
        : 0.29 + hash01(seed * 29) * 0.2);

      if (!inGap(centerX)) trees.push({
        seed,
        centerX,
        baseY,
        topY: baseY - treeHeight,
        height: treeHeight,
        maxWidth,
        layer: layerIndex,
        species,
        // Mirror the lighting so every crown is lit on the side facing the sun.
        lightSide: centerX < sunX ? 1 : -1,
        swayPhase: hash01(seed * 43) * Math.PI * 2,
        swayScale: layer.sway * (0.78 + hash01(seed * 47) * 0.44),
      });

      const spacing = layer.spacing[0]
        + hash01(seed * 31) * (layer.spacing[1] - layer.spacing[0]);
      // Tight groups alternate with wider breaks, avoiding a picket-fence rhythm.
      const gapScale = index % 6 === 5
        ? 1.35 + hash01(seed * 53) * 0.52
        : 0.66 + hash01(seed * 59) * 0.5;
      x += spacing * gapScale * spacingScale;
    }
  });

  // Rows of trees along the near banks, growing larger toward the viewer.
  const { banks, horizon } = activeScene();
  if (activeScene().forest.bankTrees && banks) {
    for (const side of [-1, 1]) {
      let index = 0;
      for (let t = 0.03; t < 0.82; index += 1) {
        const seed = 8800 + (side + 1) * 300 + index;
        const depth = horizon + t * (0.9 - horizon);
        const edge = banks[side < 0 ? "left" : "right"](depth);
        const inland = 0.012 + hash01(seed * 3) * 0.05 * (0.3 + t);
        const centerX = side < 0 ? (edge - inland) * width : width * (1 - edge + inland);
        const treeHeight = height * (0.045 + 0.42 * t ** 1.25) * (0.75 + hash01(seed * 5) * 0.5);
        const species = hash01(seed * 7) < 0.6 ? "round" : "oak";
        if (hash01(seed * 9) > 0.15) trees.push({
          seed,
          centerX,
          baseY: depth * height,
          topY: depth * height - treeHeight,
          height: treeHeight,
          maxWidth: treeHeight * (0.42 + hash01(seed * 11) * 0.2),
          layer: 2,
          species,
          bank: true,
          lightSide: centerX < sunX ? 1 : -1,
          swayPhase: hash01(seed * 13) * Math.PI * 2,
          // Near trees are big on screen, so their sway reads clearly.
          swayScale: (0.5 + t * 0.6) * (0.78 + hash01(seed * 17) * 0.44),
        });
        t += 0.05 + hash01(seed * 19) * 0.07 + t * 0.08;
      }
    }
  }

  return trees;
}

function foliageColor(tree, lit, shadow = false) {
  const broad = tree.species === "oak" || tree.species === "round";
  const palette = (broad && isAutumn() && autumnPalette(tree)) || (tree.bank ? BANK_FOLIAGE : FOLIAGE[tree.layer]);
  // Distant autumn woods keep to their darker tones.
  if (AUTUMN.includes(palette) && tree.layer === 0) return shadow ? palette.shadow : palette.middle;
  if (shadow) return palette.shadow;
  return lit ? palette.light : palette.middle;
}

function makeSway(tree, progress, cellWidth) {
  return {
    swayAmount: tree.swayScale * cellWidth * (1 - progress) ** 1.15,
    swayPhase: tree.swayPhase,
  };
}

function coniferGlyph(tree, localX, progress, x, y, cellWidth) {
  const noise = hash01(tree.seed * 101 + Math.round(x) * 7 + Math.round(y) * 11);
  const tiers = tree.species === "spruce" ? 7 : 5;
  const tierPosition = progress * tiers;
  const tier = Math.min(tiers - 1, Math.floor(tierPosition));
  const tierProgress = tierPosition - tier;
  const normalizedX = Math.abs(localX) / tree.maxWidth;
  const widthFactor = tree.species === "spruce"
    ? 0.22 + tier * 0.105 + tierProgress * 0.12
    : 0.2 + tier * 0.145 + tierProgress * 0.13;
  const branchWidth = tree.maxWidth * Math.min(0.98, widthFactor) * Math.sqrt(Math.max(0.04, progress * 5));
  const irregularEdge = 1 + (noise - 0.5) * (tree.species === "spruce" ? 0.18 : 0.1);
  const halfWidth = branchWidth * irregularEdge;
  if (Math.abs(localX) > halfWidth) return null;

  const edge = Math.abs(localX) > halfWidth - cellWidth * 0.8;
  const sunwardX = -localX * tree.lightSide;
  const lit = sunwardX < -tree.maxWidth * 0.12 && progress < 0.76;
  const shadow = sunwardX > tree.maxWidth * 0.24 || progress > 0.8;
  let glyph;

  if (progress < 0.075 && Math.abs(localX) < cellWidth * 0.55) glyph = "^";
  else if (edge) glyph = localX < 0 ? "/" : "\\";
  else if (tierProgress < 0.075 && tier > 0 && Math.abs(localX) > cellWidth * 1.1) return null;
  else if (noise < [0.12, 0.085, 0.065][tree.layer]) return null;
  else if (tierProgress > 0.77 && noise > 0.43) glyph = noise > 0.78 ? "_" : "-";
  else if (tree.species === "spruce" && noise > 0.8) glyph = "Y";
  else glyph = ["*", "#", "+", "x"][Math.floor(noise * 4)];

  return {
    glyph,
    color: edge || (tierProgress < 0.13 && lit)
      ? foliageColor(tree, true)
      : foliageColor(tree, lit && noise > 0.3, shadow && noise < 0.76),
    ...makeSway(tree, progress, cellWidth),
  };
}

function broadleafGlyph(tree, localX, progress, x, y, cellWidth) {
  const normalizedX = localX / tree.maxWidth;
  const canopyY = tree.species === "oak" ? 0.43 : 0.41;
  const canopyHeight = tree.species === "oak" ? 0.34 : 0.39;
  const normalizedY = (progress - canopyY) / canopyHeight;
  const noise = hash01(tree.seed * 101 + Math.round(x) * 7 + Math.round(y) * 11);
  const undulation = 0.065 * Math.sin(normalizedX * 7.2 + tree.seed)
    + 0.035 * Math.sin(normalizedY * 8.5 - tree.seed * 0.7);

  let edgeDistance;
  if (tree.species === "oak") {
    const lobes = [
      { x: 0, rx: 0.7, ry: 0.86, y: 0 },
      { x: -0.43, rx: 0.48, ry: 0.62, y: 0.03 },
      { x: 0.43, rx: 0.48, ry: 0.62, y: 0.01 },
    ];
    edgeDistance = Math.min(...lobes.map((lobe) => (
      ((normalizedX - lobe.x) / lobe.rx) ** 2
      + ((normalizedY - lobe.y) / lobe.ry) ** 2
    )));
  } else {
    edgeDistance = (normalizedX / 0.95) ** 2 + normalizedY ** 2;
  }
  const inside = edgeDistance < 1 + undulation;
  if (!inside) return null;

  const isEdge = edgeDistance > 0.63 + undulation * 0.35;
  if (!isEdge && noise < [0.12, 0.085, 0.065][tree.layer]) return null;
  const sunwardX = -normalizedX * tree.lightSide;
  const lit = sunwardX < -0.12 && normalizedY < 0.36;
  const shadow = sunwardX > 0.25 || normalizedY > 0.48;
  let glyph;
  if (isEdge && noise > 0.44) glyph = noise > 0.78 ? "*" : "+";
  else if (Math.abs(normalizedX) < 0.11 && normalizedY > 0.48 && noise > 0.54) glyph = "Y";
  // Autumn crowns are heavy masses of round leaves.
  else glyph = (isAutumn() ? ["o", "O", "0", "@"] : ["o", "O", "*", "+"])[Math.floor(noise * 4)];

  return {
    glyph,
    color: foliageColor(tree, lit && noise > 0.24, shadow && noise < 0.78),
    ...makeSway(tree, progress, cellWidth),
  };
}

/** A dead tree: a bare, crooked trunk with twisted, forking branches and no leaves. */
function deadGlyph(tree, localX, progress, x, y, cellWidth) {
  const lean = Math.sin(progress * 3 + tree.seed) * cellWidth * 0.6 * (1 - progress);
  const offset = localX - lean;
  // Weathered, bone-grey wood, lighter on the side facing the light.
  const lit = offset * tree.lightSide < 0;
  const color = lit ? "#9a948a" : "#6e6962";
  const sway = { swayAmount: tree.swayScale * cellWidth * 0.3 * (1 - progress), swayPhase: tree.swayPhase };
  const trunk = cellWidth * (progress > 0.75 ? 1.05 : progress > 0.3 ? 0.8 : 0.55);
  if (Math.abs(offset) < trunk) return { glyph: progress < 0.06 ? "'" : progress > 0.92 ? "A" : "|", color, ...sway };
  // Branches fork off the upper trunk, reaching up and out, with a split twig at the tip.
  if (progress < 0.72) {
    const forks = [0.1, 0.2, 0.31, 0.42, 0.53, 0.64];
    for (const [index, at] of forks.entries()) {
      const side = (index + Math.floor(tree.seed)) % 2 ? 1 : -1;
      const reach = (progress - at) / 0.14;
      if (reach < 0 || reach > 1) continue;
      const along = side * offset;
      const span = tree.maxWidth * (1.05 - at * 0.7);
      const target = (1 - reach) * span;
      if (along > 0 && along < span && Math.abs(along - target) < cellWidth * 0.9) {
        const tip = along > span * 0.75;
        return { glyph: tip ? "v" : side > 0 ? "/" : "\\", color, ...sway };
      }
    }
  }
  return null;
}

/**
 * The lobes of foliage that make up a near tree's crown: overlapping clumps
 * spread over a rounded outline, a crowning one on top. `x` and `r` are in
 * crown half-widths, `y` in tree height from the top. Lower clumps are in front.
 */
function crownClumps(tree) {
  const count = 6 + Math.floor(hash01(tree.seed * 131) * 4);
  const clumps = [{ x: (hash01(tree.seed * 151) - 0.5) * 0.3, y: 0.13, r: 0.32 }];
  for (let i = 0; i < count; i += 1) {
    const y = 0.12 + hash01(tree.seed * 139 + i * 17) * 0.5;
    // The crown is widest a little below its middle.
    const spread = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, (y - 0.02) / 0.68));
    clumps.push({ x: (hash01(tree.seed * 137 + i * 13) - 0.5) * 1.5 * spread, y, r: 0.26 + hash01(tree.seed * 149 + i * 19) * 0.22 });
  }
  return clumps.sort((a, b) => a.y - b.y);
}

/**
 * A near tree on the river bank: a crown of separate clumps, each lit on the
 * side facing the sun and dark underneath, with sky-dark gaps between them,
 * over a trunk that forks into branches reaching up into the clumps.
 */
function bankTreeGlyph(tree, localX, progress, x, y, cellWidth) {
  const clumps = tree.clumps ?? (tree.clumps = crownClumps(tree));
  const nx = localX / tree.maxWidth;
  const aspect = tree.height / tree.maxWidth;
  const noise = hash01(tree.seed * 101 + Math.round(x) * 7 + Math.round(y) * 11);
  let front = null;
  for (const clump of clumps) {
    const dx = (nx - clump.x) / clump.r;
    const dy = ((progress - clump.y) * aspect) / clump.r;
    // A ragged edge of leaves rather than a clean circle.
    const ragged = 1 + (noise - 0.5) * 0.28;
    if (dx * dx + dy * dy < ragged * ragged) front = { clump, dx, dy };
  }
  if (front) {
    const { clump, dx, dy } = front;
    // Light from above and the sun's side; clumps low in the crown sit in shade.
    const light = (dx * tree.lightSide * 0.55 - dy * 0.8) + (noise - 0.5) * 0.5 - (clump.y - 0.3) * 0.9;
    const rim = dx * dx + dy * dy > 0.7;
    // Only the deepest shade between clumps opens into gaps.
    if (light < -0.65 && noise < 0.25) return null;
    const lit = light > 0.15;
    const shadow = light < -0.25 || (rim && light < 0);
    const glyphs = isAutumn() ? ["o", "O", "0", "@"] : ["o", "O", "*", "@"];
    return {
      glyph: shadow ? (noise > 0.4 ? "o" : "*") : glyphs[Math.floor(noise * 4)],
      color: foliageColor(tree, lit, shadow),
      ...makeSway(tree, progress, cellWidth),
    };
  }
  // Trunk and branches show through below and between the clumps.
  const bark = "#6c5c45";
  const lean = Math.sin(tree.seed) * 0.08 * (1 - progress);
  if (progress > 0.45 && Math.abs(nx - lean) < 0.12) {
    return { glyph: progress > 0.93 ? "|" : progress < 0.62 ? "Y" : "|", color: bark, swayAmount: 0, swayPhase: tree.swayPhase };
  }
  for (const clump of clumps) {
    if (clump.y < 0.3) continue;
    // A branch from the trunk at the fork up to the clump's heart.
    const t = (0.68 - progress) / (0.68 - clump.y);
    if (t < 0 || t > 1) continue;
    const bx = clump.x * t;
    if (Math.abs(nx - bx) < 0.07) return { glyph: clump.x * t > 0 ? "/" : "\\", color: bark, ...makeSway(tree, progress, cellWidth * 0.5) };
  }
  return null;
}

/** Is a screen point inside a bank tree's crown (any of its clumps)? Grass stays out of it. */
export function inCrown(tree, x, y) {
  if (!tree.bank || tree.species === "dead") return false;
  const progress = (y - tree.topY) / tree.height;
  if (progress < 0 || progress > 0.8) return false;
  const clumps = tree.clumps ?? (tree.clumps = crownClumps(tree));
  const nx = (x - tree.centerX) / tree.maxWidth;
  const aspect = tree.height / tree.maxWidth;
  return clumps.some((clump) => ((nx - clump.x) / clump.r) ** 2 + (((progress - clump.y) * aspect) / clump.r) ** 2 < 0.85);
}

function treeGlyph(tree, x, y, cellWidth) {
  const progress = (y - tree.topY) / tree.height;
  if (progress < 0 || progress > 1) return null;

  const localX = x - tree.centerX;
  if (tree.species === "dead") return deadGlyph(tree, localX, progress, x, y, cellWidth);
  if (tree.bank) return bankTreeGlyph(tree, localX, progress, x, y, cellWidth);
  const broad = tree.species === "oak" || tree.species === "round";
  const trunkStart = broad ? 0.78 : 0.86;
  const trunkWidth = cellWidth * (tree.layer === 0 ? 0.38 : 0.5);
  if (progress > trunkStart && Math.abs(localX) < trunkWidth) {
    return {
      glyph: progress > 0.95 ? "|" : (broad ? "Y" : "|"),
      color: ["#58533f", "#56493a", "#4a3e2f"][tree.layer],
      swayAmount: 0,
      swayPhase: tree.swayPhase,
    };
  }

  if (broad) return broadleafGlyph(tree, localX, progress, x, y, cellWidth);
  return coniferGlyph(tree, localX, progress, x, y, cellWidth);
}

/** Build a stable, three-depth ASCII forest with varied crowns and per-tree wind sway. */
export function createForestGlyphs(width, height, cellWidth, lineHeight, sunX = width / 2) {
  const trees = createTrees(width, height, sunX);
  const columns = Math.ceil(width / cellWidth);
  const rows = Math.ceil(height / lineHeight);
  const cells = new Map();

  for (const tree of trees) {
    const firstRow = Math.max(0, Math.floor(tree.topY / lineHeight));
    const lastRow = Math.min(rows - 1, Math.ceil(tree.baseY / lineHeight));
    // Clumpy bank crowns reach a little past their nominal width.
    const reach = tree.maxWidth * (tree.bank ? 1.4 : 1);
    const firstColumn = Math.max(0, Math.floor((tree.centerX - reach) / cellWidth) - 1);
    const lastColumn = Math.min(columns - 1, Math.ceil((tree.centerX + reach) / cellWidth) + 1);

    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = (row + 0.5) * lineHeight;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const x = (column + 0.5) * cellWidth;
        const shape = treeGlyph(tree, x, y, cellWidth);
        if (!shape) continue;

        const key = row * columns + column;
        const previous = cells.get(key);
        if (!previous || tree.baseY > previous.depth) {
          cells.set(key, { x, y, column, row, depth: tree.baseY, bank: tree.bank, dead: tree.species === "dead", ...shape });
        }
      }
    }
  }

  // The trees themselves come along too, for the shadows they cast.
  const result = [...cells.values()];
  result.trees = trees;
  return result;
}
