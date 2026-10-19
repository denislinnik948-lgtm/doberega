import { hash01 } from "./noise.js";
import { activeScene, shorelineY } from "./scene.js";

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

function chooseSpecies(seed, layerIndex, broadleaf) {
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
  const { heightScale = 1, spacingScale = 1, broadleaf, gaps = [] } = activeScene().forest;
  const inGap = (x) => gaps.some(([from, to]) => x > from * width && x < to * width);

  FOREST_LAYERS.forEach((layer, layerIndex) => {
    let index = 0;
    for (let x = -90; x < width + 90; index += 1) {
      const seed = 419 + layerIndex * 10000 + index;
      const species = chooseSpecies(seed, layerIndex, broadleaf);
      const centerX = x + (hash01(seed * 17) - 0.5) * 20;
      const terrain = Math.sin(centerX * 0.0033 + layerIndex * 1.7) * 0.006
        + Math.sin(centerX * 0.009 + layerIndex * 0.8) * 0.0025;
      const baseOffset = layer.offset
        + hash01(seed * 19) * layer.variation
        + terrain;
      const baseY = shorelineY(centerX, height) - height * baseOffset;
      const treeHeight = heightScale * height * (
        layer.height[0] + hash01(seed * 23) * (layer.height[1] - layer.height[0])
      );
      const broad = species === "oak" || species === "round";
      const maxWidth = treeHeight * (broad
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

  return trees;
}

function foliageColor(tree, lit, shadow = false) {
  const palette = FOLIAGE[tree.layer];
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
  else glyph = ["o", "O", "*", "+"][Math.floor(noise * 4)];

  return {
    glyph,
    color: foliageColor(tree, lit && noise > 0.24, shadow && noise < 0.78),
    ...makeSway(tree, progress, cellWidth),
  };
}

function treeGlyph(tree, x, y, cellWidth) {
  const progress = (y - tree.topY) / tree.height;
  if (progress < 0 || progress > 1) return null;

  const localX = x - tree.centerX;
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
    const firstColumn = Math.max(0, Math.floor((tree.centerX - tree.maxWidth) / cellWidth) - 1);
    const lastColumn = Math.min(columns - 1, Math.ceil((tree.centerX + tree.maxWidth) / cellWidth) + 1);

    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = (row + 0.5) * lineHeight;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const x = (column + 0.5) * cellWidth;
        const shape = treeGlyph(tree, x, y, cellWidth);
        if (!shape) continue;

        const key = row * columns + column;
        const previous = cells.get(key);
        if (!previous || tree.baseY > previous.depth) {
          cells.set(key, { x, y, column, row, depth: tree.baseY, ...shape });
        }
      }
    }
  }

  const willow = activeScene().forest.willow;
  if (willow) addWeepingWillow(cells, willow, width, height, cellWidth, lineHeight, columns);

  return [...cells.values()];
}

/**
 * A big weeping willow on the far bank: a broad dome of leaves with long
 * strands hanging to the water, swaying more toward their tips.
 */
/** Geometry of the scene's weeping willow (shared with the renderer's silhouette). */
export function willowShape(width, height) {
  const willow = activeScene().forest.willow;
  if (!willow) return null;
  const cx = width * willow.x;
  const base = shorelineY(cx, height);
  return { cx, base, crownTop: base - height * 0.2, crownBottom: base - height * 0.11, halfWidth: width * 0.085 };
}

function addWeepingWillow(cells, _willow, width, height, cellWidth, lineHeight, columns) {
  const { cx, base, crownTop, crownBottom, halfWidth } = willowShape(width, height);
  const put = (x, y, glyph, color, sway, phase) => {
    const column = Math.floor(x / cellWidth);
    const row = Math.floor(y / lineHeight);
    if (column < 0 || column >= columns || row < 0) return;
    cells.set(row * columns + column, {
      x: (column + 0.5) * cellWidth, y: (row + 0.5) * lineHeight, column, row,
      depth: base + 1, glyph, color, swayAmount: sway, swayPhase: phase, willow: true,
    });
  };

  // Trunk, leaning slightly.
  for (let y = base - lineHeight * 0.5; y > crownBottom; y -= lineHeight) {
    const lean = ((base - y) / (base - crownBottom)) * cellWidth * 1.2;
    put(cx - lean, y, "|", "#5a4a36", 0, 0);
    put(cx - lean + cellWidth, y, "(", "#4a3c2c", 0, 0);
  }
  // Crown: a flattened dome.
  for (let y = crownTop; y < crownBottom + lineHeight; y += lineHeight) {
    const t = (y - crownTop) / (crownBottom - crownTop);
    const span = halfWidth * Math.sqrt(Math.max(0, 1 - (1 - t) ** 2 * 0.95));
    for (let x = cx - span; x <= cx + span; x += cellWidth) {
      const noise = hash01(Math.round(x) * 31 + Math.round(y) * 17);
      if (noise < 0.12) continue;
      const lit = x < cx - span * 0.2 && t < 0.6;
      put(x, y, noise > 0.7 ? "*" : noise > 0.4 ? "(" : ")", lit ? "#8e9a5c" : noise > 0.5 ? "#5e7444" : "#465c36", cellWidth * 0.2 * (1 - t), x * 0.01);
    }
  }
  // Hanging strands from the crown's rim down to the water.
  for (let x = cx - halfWidth * 1.05; x <= cx + halfWidth * 1.05; x += cellWidth * 1.5) {
    const noise = hash01(Math.round(x) * 13);
    if (noise < 0.2) continue;
    const rim = crownBottom - lineHeight * (1 - Math.abs(x - cx) / halfWidth) * 2;
    const end = base - lineHeight * (0.3 + noise * 1.5);
    for (let y = rim; y < end; y += lineHeight) {
      const t = (y - rim) / Math.max(1, end - rim);
      put(x, y, t > 0.85 ? "'" : noise > 0.6 ? "!" : "|", t > 0.5 ? "#a2bc78" : "#86a062", cellWidth * (0.4 + t * 1.2), noise * 6);
    }
  }
}
