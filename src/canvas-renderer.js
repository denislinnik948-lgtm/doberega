import { sampleWater } from "./water-engine.js";
import { createForestGlyphs } from "./forest-engine.js";
import { activeScene, bankWidths, currentAt, isOpenWater, jettyShape, nearBankY, setScene, shorelineY, sunPosition, view, wreckShape } from "./scene.js";
import { skyAt, toHex, toInt } from "./daycycle.js";
import { clamp, hash01, hash2, hexToInt, mixColor, valueNoise } from "./noise.js";
import { createBankGlyphs, createRidgeGlyphs, createShoreGlyphs, createStructures, ridgeTop } from "./landscape-engine.js";
import { birdsAt, createSkyCells, discOffsets, lightSky, pushDisc, sampleSky, setCloudColors, setCloudiness } from "./sky-engine.js";
import { createLilyPads, createReeds, createRocks, rockGlyphs } from "./foreground-engine.js";
import { GlyphBatch, createBackend } from "./glyph-backend.js";
import { createAmbient, fillAmbient } from "./ambient-engine.js";
import { currentSeason, GRADE_MATRIX, gradeHex, gradeInt, gradeSky, isAutumn, isSpring, isWinter, seasonDeep, seasonWater, snowHex, snowImageData } from "./theme.js";
import { createGrass, fillGrass } from "./grass-engine.js";
import { ROD_LOOKS } from "./fishing/sprites.js";

// A little sparser than solid: dark water shows between the strokes.
const WATER_RAMP = "     ..,:;~-=+*#%@W";
const MONO_FONT = '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const GAME_ISOMETRIC_SLOPE = 0.5;
const WATER_BANDS = 10;
const REFLECTION_LEVELS = 3;
// Water from deep (0) to shallow (last): darker over the depths, lighter and clearer near the banks.
const DEPTH_LEVELS = 4;
const DEEP_WATER = "#142a32";
const SPRAY_COLOR = hexToInt("#d3e2dc");
// Winter ice, from the glassy open edge to snow lying on it; cracks darker.
const ICE = ["#7d95a2", "#a8bcc6", "#d6e0e5"].map((color) => hexToInt(gradeHex(color)));
const ICE_CRACK = hexToInt(gradeHex("#5c7482"));
// Dense characters for the solid parts of buildings, mostly heavy, a few light.
const STRUCTURE_GLYPHS = "#%&@$8MWQ#%&=:+*";
const STEAM = [hexToInt("#b8c6d0"), hexToInt("#eef3f6")];
const BIRD_COLOR = hexToInt("#1f272b");
// Clouds and stars drift slowly enough to resample a few times per second;
// everything else animates on every frame.
const SKY_INTERVAL = 1 / 15;
// Lighting (sky texture, water palette, glint path) refreshes this often;
// colours drift so slowly that the steps are invisible.
const LIGHT_INTERVAL = 0.25;
const SKY_SCALE = 0.25;
/*
 * Depth: each plane of the scene has its own grid, and its glyphs are sized to it.
 * The hills and mountains are the finest, the far shore and its woods a step
 * coarser, and the water and the banks grow from that at the horizon to `near`
 * at the bottom of the screen, thinned out as they grow so they never run
 * together. `?depth=hills,far,near` tries other sizes; `?depth=off` draws one even grid.
 */
const DEPTH = (() => {
  const value = new URLSearchParams(location.search).get("depth");
  if (value === "off") return null;
  const [hills, far, near] = (value ?? "").split(",").map(Number);
  const depth = { hills: hills || 0.4, far: far || 0.5, near: near || 1.6 };
  // The water at the horizon starts a little coarser than the shore: it looks much the
  // same, and the water, the costliest layer to animate, keeps to about the cells it had.
  return { ...depth, water: depth.far * 1.2 };
})();

export class CanvasWaterRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.backend = createBackend(canvas);
    // Reeds and the rock need strokes and paths, so they live on a light 2D overlay.
    this.overlay = document.createElement("canvas");
    this.overlay.className = "scene-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    canvas.after(this.overlay);
    this.overlayContext = this.overlay.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.projection = null;
    this.waterCells = [];
    this.forestCells = [];
    this.cellWidth = 8;
    this.lineHeight = 12;
    this.siteCount = 0;
    this.skyBatch = new GlyphBatch();
    this.starBatch = new GlyphBatch();
    this.discBatch = new GlyphBatch();
    this.lightBatch = new GlyphBatch();
    // Lit windows of buildings laid on the far shore's finer grid.
    this.fineLightBatch = new GlyphBatch();
    // Moving bits of the far landscape (wind in grass, smoke, mist) and lights that blink.
    this.ambientBatches = { ground: new GlyphBatch(), haze: new GlyphBatch(), glow: new GlyphBatch() };
    this.rainBatch = new GlyphBatch();
    this.boltBatch = new GlyphBatch();
    // Grass blades behind the bank trees, on the bank we stand on, and fireflies.
    this.grassBatches = { far: new GlyphBatch(16384), near: new GlyphBatch(16384), flies: new GlyphBatch() };
    this.ducks = [];
    this.glintBatch = new GlyphBatch();
    this.lightKey = null;
    this.forestBatch = new GlyphBatch();
    this.waterBatch = new GlyphBatch(32768);
    this.surfaceBatch = new GlyphBatch();
    // Winter: steam rising off the open water in the frost.
    this.steamBatch = new GlyphBatch();
    // The wreck's faint green glow at Pripyat after dark, drawn unlit over it.
    this.wreckGlowBatch = new GlyphBatch();
    this.skyTime = null;
    this.paletteKey = "";
  }

  /** Switch to another fishing spot's landscape and rebuild everything for it. */
  setScene(kind, config) {
    setScene(kind);
    if (this.width && this.height) this.resize(this.width, this.height, config, this.frame);
  }

  /**
   * `width` × `height` is the whole scene; `frame` is the slice of it actually
   * on screen (narrower on a phone held upright). The landscape is laid out
   * over the whole scene so nothing gets squeezed; the foreground and the rod
   * follow the frame.
   */
  resize(width, height, config, frame = { left: 0, width }) {
    this.width = width;
    this.height = height;
    this.frame = frame;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    for (const target of [this.canvas, this.overlay]) {
      target.width = Math.round(width * this.pixelRatio);
      target.height = Math.round(height * this.pixelRatio);
    }
    this.overlayContext.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.backend.resize(width, height, this.pixelRatio, frame);

    // Game-style 2:1 projection: each world axis rises 1 screen unit per 2 run.
    // This is atan(0.5) ≈ 26.6°, commonly used for isometric game tiles.
    const axisX = 1;
    const axisY = GAME_ISOMETRIC_SLOPE;
    this.projection = { centerX: width / 2, centerY: height / 2, axisX, axisY };
    this.sun = sunPosition(width, height);
    this.reeds = createReeds(width, height, frame);
    this.rocks = createRocks(width, height, this.sun.x, frame);
    view.width = width;
    view.left = frame.left;
    view.frameWidth = frame.width;
    this.ridgeOutlines = activeScene().ridges.map((ridge) => {
      const points = [];
      const step = Math.max(6, width / 240);
      for (let x = 0; x <= width + step; x += step) points.push(x, ridgeTop(ridge, x, height));
      return points;
    });
    this.rebuildGrid(config);
  }

  project(planeX, planeY) {
    const { centerX, centerY, axisX, axisY } = this.projection;
    return {
      x: centerX + (planeX - planeY) * axisX,
      y: centerY + (planeX + planeY) * axisY,
    };
  }

  screenToPlane(screenX, screenY) {
    const { centerX, centerY, axisX, axisY } = this.projection;
    const diagonalX = (screenX - centerX) / axisX;
    const diagonalY = (screenY - centerY) / axisY;
    return {
      x: (diagonalX + diagonalY) * 0.5,
      y: (diagonalY - diagonalX) * 0.5,
    };
  }

  shorelineY(screenX) {
    return shorelineY(screenX, this.height);
  }

  /** A random point on open water, used for fish jumps. */
  randomWaterPoint(random = Math.random) {
    const { x, y } = this.randomWaterScreen(random);
    return this.screenToPlane(x, y);
  }

  /** The same, in screen pixels. */
  randomWaterScreen(random = Math.random) {
    const { left, width } = this.frame;
    const horizon = this.shorelineY(left + width / 2);
    let x = left + width / 2;
    let y = horizon + (this.height - horizon) * 0.4;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const px = left + width * (0.12 + random() * 0.76);
      const py = horizon + (this.height - horizon) * (0.12 + random() * 0.55);
      if (isOpenWater(px, py, this.width, this.height) && !this.onIce(px, py)) {
        x = px;
        y = py;
        break;
      }
    }
    return { x, y };
  }

  isOpenWater(x, y) {
    return isOpenWater(x, y, this.width, this.height);
  }

  /**
   * Open water a duck can sit on: not under the crowns of the trees that lean
   * out from the river banks, anywhere along its body or its head.
   */
  isDuckWater(x, y) {
    if (!this.isOpenWater(x, y) || this.onIce(x, y)) return false;
    const { canopy, columns, rows, cellWidth, lineHeight } = this;
    return [[-36, 0], [0, 0], [36, 0], [0, -16]].every(([dx, dy]) => {
      const column = Math.floor((x + dx) / cellWidth);
      const row = Math.floor((y + dy) / lineHeight);
      return column < 0 || row < 0 || column >= columns || row >= rows || !canopy[row * columns + column];
    });
  }

  /**
   * Winter: a rim of ice along the shores, ragged and wider here and there,
   * while the open water stays open: along the far shore, our own bank and
   * the river banks. 0 is open water, rising to 1 at the shore.
   */
  iceAt(x, y) {
    const { width, height } = this;
    const ragged = valueNoise(x * 0.011, y * 0.006, 811);
    const shore = this.shorelineY(x);
    let ice = 1 - (y - shore) / (this.lineHeight * (1.2 + 2.4 * ragged) * this.waterScaleAt(y));
    const bank = nearBankY(x, height);
    if (Number.isFinite(bank)) ice = Math.max(ice, 1 - (bank - y) / (height * (0.035 + 0.04 * ragged)));
    const { left, right } = bankWidths(y / height);
    const reach = width * (0.012 + 0.03 * ragged);
    if (left) ice = Math.max(ice, 1 - Math.abs(x - left * width) / reach);
    if (right) ice = Math.max(ice, 1 - Math.abs(x - width * (1 - right)) / reach);
    return clamp(ice, 0, 1);
  }

  /** Whether a screen point is on the winter shore ice (no casting, ducks or splashes there). */
  onIce(x, y) {
    return Boolean(this.winterIce) && this.iceAt(x, y) > 0;
  }

  /**
   * How shallow the water is at a screen point, 0 (deep) to 1: shallow
   * toward the bank we stand on and beside river banks,
   * deepest out in the middle. A smooth gradient, no patches.
   */
  shallowAt(x, y) {
    const { width, height } = this;
    let shallow = 0;
    const bank = nearBankY(x, height);
    // Without a bank of our own, the water still shelves toward our feet.
    shallow = Math.max(shallow, Number.isFinite(bank) ? 1 - (bank - y) / (height * 0.16) : (y / height - 0.82) / 0.18);
    const { left, right } = bankWidths(y / height);
    if (left || right) {
      const edge = Math.min(Math.abs(x - left * width), Math.abs(x - width * (1 - right)));
      shallow = Math.max(shallow, 1 - edge / (width * 0.07));
    }
    return clamp(shallow, 0, 1);
  }

  rebuildGrid(config) {
    if (!this.width || !this.height) return;

    this.waterColor = config.waterColor;
    this.cellWidth = Math.max(4, Number(config.spacing));
    this.lineHeight = Math.max(Number(config.charSize) * 1.14, this.cellWidth * 1.22);
    const { width, height, cellWidth, lineHeight } = this;
    const columns = Math.ceil(width / cellWidth);
    const rows = Math.ceil(height / lineHeight);
    this.columns = columns;
    this.rows = rows;
    this.rowWobble = null;

    const scene = activeScene();
    const meanHorizon = height * scene.horizon;
    this.waterCells = [];
    // With depth on, the grid's rows and columns spread out toward the viewer as the glyphs grow.
    const scaleAt = (y) => (DEPTH ? DEPTH.far + (DEPTH.near - DEPTH.far) * clamp((y - meanHorizon) / (height - meanHorizon), 0, 1) : 1);
    this.scaleAt = scaleAt;
    const waterScaleAt = (y) => (DEPTH ? DEPTH.water + (DEPTH.near - DEPTH.water) * clamp((y - meanHorizon) / (height - meanHorizon), 0, 1) : 1);
    this.waterScaleAt = waterScaleAt;
    this.waterPerspective = DEPTH ? [meanHorizon, height, DEPTH.water, DEPTH.near] : undefined;
    // Lily pads float on the water, on its grid where each one lies; none in winter.
    this.lilyPads = isWinter() ? [] : createLilyPads(width, height, cellWidth, lineHeight, this.frame, (y) => ({ cellWidth: cellWidth * waterScaleAt(y), lineHeight: lineHeight * waterScaleAt(y) }));
    const covered = new Set();
    for (const pad of this.lilyPads) {
      for (const cell of [...pad.cells, ...pad.flower]) cell.colorValue = hexToInt(gradeHex(cell.color));
      for (const cell of pad.cells) covered.add(Math.floor(cell.y / lineHeight) * columns + Math.floor(cell.x / cellWidth));
    }
    this.charSize = Number(config.charSize);
    this.perspective = DEPTH ? [meanHorizon, height, DEPTH.far, DEPTH.near] : undefined;
    // Clouds overhead are nearer than those at the horizon.
    this.skyPerspective = DEPTH ? [0, meanHorizon, 1.15, DEPTH.hills] : undefined;
    // The far landscape is laid on a finer grid, as small as its glyphs.
    const far = DEPTH ? DEPTH.far : 1;
    const farWidth = cellWidth * far;
    const farLine = lineHeight * far;
    this.farCell = { width: farWidth, height: farLine };
    const hills = DEPTH ? DEPTH.hills : 1;
    this.hillScale = hills;
    this.hillCell = { width: cellWidth * hills, height: lineHeight * hills };
    // Cells from the finer grid answer to the main grid for every lookup by row and column.
    const regrid = (cells) => {
      if (DEPTH) for (const cell of cells) {
        cell.column = Math.floor(cell.x / cellWidth);
        cell.row = Math.floor(cell.y / lineHeight);
      }
      return cells;
    };
    // Glyphs that grow toward the viewer are thinned out to match, so they never run together.
    const thin = (cells, gridScale) => {
      if (!DEPTH) return cells;
      const kept = cells.filter((cell) => {
        const grow = scaleAt(cell.y) / gridScale;
        return grow <= 1 || hash2(Math.round(cell.x * 3), Math.round(cell.y * 3), 977) < 1 / (grow * grow);
      });
      return Object.assign(kept, { trees: cells.trees });
    };
    this.winterIce = isWinter();
    const rowYs = [];
    for (let y = 0.52 * lineHeight; y < height + lineHeight; y += lineHeight * (y < meanHorizon - lineHeight ? 1 : waterScaleAt(y))) rowYs.push(y);
    for (const [rowIndex, screenY] of rowYs.entries()) {
      const row = Math.floor(screenY / lineHeight);
      const step = cellWidth * waterScaleAt(screenY);
      const band = Math.min(WATER_BANDS - 1, Math.floor(clamp((screenY - meanHorizon) / (height - meanHorizon), 0, 1) ** 0.75 * WATER_BANDS));
      for (let index = 0; index * step < width; index += 1) {
        const screenX = (index + 0.5) * step;
        const column = Math.floor(screenX / cellWidth);
        // On a phone only a slice of the scene is on screen: water outside it is never seen.
        if (screenX < this.frame.left - cellWidth * 2 || screenX > this.frame.left + this.frame.width + cellWidth * 2) continue;
        const shore = this.shorelineY(screenX);
        if (screenY < shore + lineHeight * 0.35) continue;
        if (covered.has(row * columns + column)) continue;
        if (!isOpenWater(screenX, screenY, width, height)) continue;
        const plane = this.screenToPlane(screenX, screenY);
        const distance = (screenY - shore) / (height - shore);
        const noise = hash2(index, rowIndex, 61);
        this.waterCells.push({
          x: plane.x,
          y: plane.y,
          screenX,
          screenY,
          shore,
          depth: screenY / height,
          distance,
          band,
          noise,
          ice: this.winterIce ? this.iceGlyph(screenX, screenY, noise) : null,
          pathWidth: width * (0.016 + 0.11 * distance),
          sunPath: 0,
          reflectionLevel: Math.min(REFLECTION_LEVELS - 1, Math.floor(distance * 6)),
          depthLevel: Math.min(DEPTH_LEVELS - 1, Math.floor(this.shallowAt(screenX, screenY) * DEPTH_LEVELS)),
          // Filled in by the water model on first use (a river bend's turn here).
          bendCos: undefined,
          bendSin: 0,
          bendDepth: -1,
          column,
          row,
        });
      }
    }

    this.siteCount = this.waterCells.length;
    // Winter: a few cells of open water to send up steam, and the floes drifting about.
    this.steamCells = this.winterIce ? this.waterCells.filter((cell) => !cell.ice && cell.distance < 0.75 && cell.column % 2 === 0) : [];
    this.floes = [];
    if (this.winterIce) {
      for (let i = 0; i < (scene.water.flowAway ? 9 : 6); i += 1) {
        const floe = { seed: i * 0.37 + 0.11, size: this.frame.width * (0.035 + hash01(i * 31 + 7) ** 2 * 0.07), x: 0, y: 0, rx: 0, ry: 0 };
        this.placeFloe(floe, false);
        this.floes.push(floe);
      }
    }
    this.floeTime = null;
    this.waterClip = null;
    this.skyCells = createSkyCells(width, height, cellWidth, lineHeight);
    this.sunDisc = discOffsets(this.sun.radius, cellWidth, lineHeight);
    this.moonDisc = discOffsets(this.sun.radius * 0.8, cellWidth, lineHeight);
    this.ridgeCells = regrid(createRidgeGlyphs(width, height, this.hillCell.width, this.hillCell.height));
    this.forestCells = regrid(thin(createForestGlyphs(width, height, farWidth, farLine, this.sun.x), far));
    this.trees = this.forestCells.trees;
    // Where bank tree crowns hang, a cell or so wider: ducks keep out from under them.
    this.canopy = new Uint8Array(columns * rows);
    for (const cell of this.forestCells) {
      if (!cell.bank) continue;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const row = cell.row + dr;
          const column = cell.column + dc;
          if (row >= 0 && row < rows && column >= 0 && column < columns) this.canopy[row * columns + column] = 1;
        }
      }
    }
    // Each style's colour grade is baked into the scene's own colours.
    for (const cell of this.forestCells) cell.colorValue = hexToInt(gradeHex(cell.color));
    this.shoreCells = regrid(createShoreGlyphs(width, height, farWidth, farLine, this.sun.x));
    const structures = createStructures(width, height, cellWidth, lineHeight, DEPTH ? { cellWidth: farWidth, lineHeight: farLine, scale: far } : null);
    this.structureCells = regrid(structures.cells);
    this.structureShapes = structures.shapes;
    this.structureMask = null;
    this.lightBatch.clear();
    this.fineLightBatch.clear();
    for (const cell of structures.lights) (cell.scale ? this.fineLightBatch : this.lightBatch).push(cell.x, cell.y, cell.glyph, hexToInt(cell.color));
    // Cottage windows lit by a stove or a lamp flicker a little, each at its own pace.
    this.flickerLights = structures.lights.filter((cell) => cell.flicker && !cell.scale).map((cell, i) => ({ ...cell, colorValue: hexToInt(cell.color), seed: i * 1.7 }));
    this.farPerspective = [0, 1, far, far];
    this.bankCells = thin(createBankGlyphs(width, height, cellWidth, lineHeight, this.sun.x), 1);
    this.grassStale = true;
    this.grass = createGrass({ width, height, cellWidth, lineHeight, frame: this.frame, season: currentSeason(), trees: this.trees });
    this.ambient = createAmbient({
      // Plain grass on the banks is drawn as blades; the scrub along the water stays glyphs.
      scene, structures, ridgeCells: this.ridgeCells, bankCells: this.bankCells.filter((cell) => !cell.plain),
      width, height, cellWidth, lineHeight, shorelineY: (x) => this.shorelineY(x),
    });
    // Meadows drawn live by the ambient layer lie under the same snow as the painted land.
    const winter = isWinter();
    for (const cell of [...this.ambient.breeze, ...this.ambient.leaves]) {
      cell.colorValue = gradeInt(winter ? hexToInt(snowHex(`#${cell.colorValue.toString(16).padStart(6, "0")}`, 0.65)) : cell.colorValue);
    }
    this.waterRocks = this.createWaterRocks();
    const bend = scene.water.bend;
    this.waterParams = {
      flow: scene.water.flow ?? 0,
      flowAway: Boolean(scene.water.flowAway),
      bend: bend ? { ...this.screenToPlane(bend.x * width, bend.y * height), from: bend.from, to: bend.to } : null,
    };
    this.treeline = new Float32Array(columns + 1);
    for (let column = 0; column <= columns; column += 1) this.treeline[column] = this.shorelineY(column * cellWidth);
    // The sky only shows above the lowest point of the shore.
    this.skyBottom = Math.max(...this.treeline) + lineHeight;
    for (const cell of this.forestCells) {
      // Bank trees get no solid canopy behind them.
      if (cell.bank || cell.glyph === "|" || cell.y - lineHeight * 0.2 > this.treeline[cell.column]) continue;
      this.treeline[cell.column] = cell.y - lineHeight * 0.2;
    }
    // The land layer starts at whatever stands highest: hills, treetops or buildings.
    let landTop = Math.min(...this.treeline);
    for (const points of this.ridgeOutlines) for (let i = 1; i < points.length; i += 2) landTop = Math.min(landTop, points[i]);
    for (const cell of [...this.forestCells, ...this.structureCells]) landTop = Math.min(landTop, cell.y);
    for (const shape of this.structureShapes) for (const [, y] of shape.points) landTop = Math.min(landTop, y);
    this.landTop = landTop - lineHeight * 2;
    this.buildBackdrop();

    this.font = `${config.charSize}px ${MONO_FONT}`;
    this.reedSize = clamp(Number(config.charSize) * 2, 13, 28);
    this.backend.setFont(this.font, Number(config.charSize), DEPTH ? DEPTH.near : 1);
    // Graded as it is drawn (see the backend), not pixel by pixel here.
    this.backend.setLayer("land", this.createLayer((ctx) => this.paintLand(ctx)), GRADE_MATRIX);
    this.lightKey = null;
    this.rockImages = this.rocks.map((rock) => this.createRockImage(rock));
    this.bridgeImage = scene.foreground.bridge ? this.createBridgeImage(scene.foreground.bridge) : null;
    this.signImage = scene.foreground.sign ? this.createSignImage(scene.foreground.sign) : null;
    this.oak = scene.foreground.oak ? this.createOak() : null;
    // Where bullfinches can sit in winter: the oak's boughs, the bridge rail
    // and (added as the reeds are drawn, since they sway) the cattails.
    this.perches = [];
    if (this.winterIce) {
      this.perches.push(...(this.oak?.perches ?? []));
      if (scene.foreground.bridge) {
        const railY = height * scene.foreground.bridge - this.reedSize * 0.55;
        for (const k of [0.12, 0.3, 0.46, 0.62, 0.8]) this.perches.push({ x: this.frame.left + this.frame.width * k, y: railY });
      }
    }
    this.reedPerches = null;
    this.skyTime = null;
  }

  /** Map every on-shore cell to the color of whatever the water should mirror there. */
  buildBackdrop() {
    const { columns, rows } = this;
    this.backdrop = new Int16Array(columns * rows).fill(-1);
    this.backdropColors = [];
    const indexOf = new Map();
    const put = (cell, raw) => {
      if (cell.row < 0 || cell.row >= rows || cell.column < 0 || cell.column >= columns) return;
      // Reflections mirror the graded land, so the water matches the shore.
      const color = gradeHex(raw);
      if (!indexOf.has(color)) {
        indexOf.set(color, this.backdropColors.length);
        this.backdropColors.push(color);
      }
      this.backdrop[cell.row * columns + cell.column] = indexOf.get(color);
    };
    for (const cell of this.ridgeCells) put(cell, cell.fill);
    // What stands behind the forest is mirrored first, so the trees in front win.
    for (const cell of this.structureCells) if (cell.behind) put(cell, cell.color);
    // Bank trees stand on the near banks, not the far shore, so the water doesn't mirror them.
    for (const cell of this.forestCells) if (!cell.bank) put(cell, cell.color);
    for (const cell of this.structureCells) if (!cell.behind) put(cell, cell.color);
    for (const cell of this.shoreCells) put(cell, "#2a3128");
    this.paletteKey = "";
  }

  updatePalette(rawWater, sky) {
    const waterColor = gradeHex(seasonWater(rawWater));
    const horizon = toHex(sky.sky[3]);
    const key = `${waterColor}|${horizon}`;
    if (this.paletteKey === key) return;
    this.paletteKey = key;
    // Distant water mirrors the horizon sky; nearby water shows its own tone.
    const bands = Array.from({ length: WATER_BANDS }, (_, band) => (
      mixColor(waterColor, horizon, (1 - band / (WATER_BANDS - 1)) ** 1.6 * 0.62)
    ));
    this.waterBandColors = bands.map(hexToInt);
    // Each band again from deep (darker) to shallow (lighter, more of the water's own colour).
    this.waterDepthColors = Array.from({ length: DEPTH_LEVELS }, (_, level) => bands.map((band) => (
      hexToInt(mixColor(band, waterColor, level * 0.14, 0.82 + level * 0.12))
    )));
    this.reflectionColors = this.backdropColors.map((color) => Array.from(
      { length: REFLECTION_LEVELS },
      (_, level) => hexToInt(mixColor(color, bands[1], 0.16 + level * 0.2, 0.92)),
    ));
  }

  /** Re-light the scene for the current time of day (a few times per second). */
  refreshLight(sky, waterColor) {
    const { width, height } = this;
    setCloudColors(sky.cloudShade, sky.cloudLit);
    lightSky(this.skyCells, width, height, sky.light);
    this.glintColors = sky.glint.map(toInt);
    this.lightStrength = sky.light.strength * (sky.light.y < 0.5 ? 1 : 0);
    const lx = sky.light.x * width;
    for (const cell of this.waterCells) cell.sunPath = Math.exp(-(((cell.screenX - lx) / cell.pathWidth) ** 2));
    this.backend.setLayer("sky", this.paintSkyLayer(sky));
    this.updatePalette(waterColor, sky);
    this.skyTime = null;
  }

  /** Smooth sky gradient plus the glow around the sun or moon, at low resolution. */
  paintSkyLayer(sky) {
    const { width, height } = this;
    const layer = this.skyCanvas ?? (this.skyCanvas = document.createElement("canvas"));
    layer.width = Math.max(1, Math.round(width * SKY_SCALE));
    layer.height = Math.max(1, Math.round(height * SKY_SCALE));
    const ctx = layer.getContext("2d");
    ctx.setTransform(SKY_SCALE, 0, 0, SKY_SCALE, 0, 0);
    const [top, mid, low, horizon] = sky.sky.map(toHex);
    const gradient = ctx.createLinearGradient(0, 0, 0, height * 0.48);
    gradient.addColorStop(0, top);
    gradient.addColorStop(0.35, mid);
    gradient.addColorStop(0.8, low);
    gradient.addColorStop(1, horizon);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const [r, g, b, a] = sky.glow;
    const lx = sky.light.x * width;
    const ly = sky.light.y * height;
    if (sky.light.kind !== "none" && a > 0) {
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(width, height) * 0.5);
      const rgba = (alpha) => `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`;
      glow.addColorStop(0, rgba(a));
      glow.addColorStop(0.08, rgba(a * 0.57));
      glow.addColorStop(0.35, rgba(a * 0.19));
      glow.addColorStop(1, rgba(0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height * 0.5);
    }
    return layer;
  }

  /** Rasterize a static, full-screen layer once per rebuild (the backend grades it). */
  createLayer(paint) {
    const layer = document.createElement("canvas");
    layer.width = Math.round(this.width * this.pixelRatio);
    layer.height = Math.round(this.height * this.pixelRatio);
    const ctx = layer.getContext("2d");
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.font = this.font;
    ctx.depthSize = null;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    paint(ctx);
    return layer;
  }

  /** The water body beneath the glyphs, following the irregular shoreline. */
  paintWaterBody(ctx) {
    const { width, height } = this;
    const scene = activeScene();
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, this.shorelineY(x) + this.lineHeight * 0.3);
    ctx.lineTo(width, height);
    ctx.closePath();
    // Dark over the depths so the strokes stand out, lighter and greener over the shallows.
    const deep = seasonDeep(scene.water.body ?? DEEP_WATER);
    ctx.fillStyle = deep;
    ctx.fill();
    for (const ice of this.winterIce ? [false, true] : [false]) {
      // A coarse map of the shallows, smoothed as it is stretched over the water;
      // in winter another of the shore ice, dark between its glyphs.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt((ice ? "#25333b" : mixColor(deep, seasonWater(this.waterColor ?? "#3f7f86"), 0.3)).slice(i, i + 2), 16));
      const map = document.createElement("canvas");
      map.width = Math.ceil(width / (this.cellWidth * 2));
      map.height = Math.ceil(height / this.lineHeight);
      const mapContext = map.getContext("2d");
      const image = mapContext.createImageData(map.width, map.height);
      for (let row = 0; row < map.height; row += 1) {
        for (let column = 0; column < map.width; column += 1) {
          const i = (row * map.width + column) * 4;
          image.data[i] = r;
          image.data[i + 1] = g;
          image.data[i + 2] = b;
          const x = ((column + 0.5) * width) / map.width;
          const y = ((row + 0.5) * height) / map.height;
          image.data[i + 3] = Math.round(255 * (ice ? clamp((this.iceAt(x, y) - 0.1) * 3, 0, 1) : this.shallowAt(x, y)));
        }
      }
      mapContext.putImageData(image, 0, 0);
      ctx.save();
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(map, 0, 0, width, height);
      ctx.restore();
    }
  }

  /** With depth on, the land layer's font for a glyph at height `y` (sizes rounded to keep font changes few). */
  glyphFont(ctx, y, scale = this.scaleAt(y)) {
    if (!DEPTH) return;
    const size = Math.round(this.charSize * scale * 4) / 4;
    if (size !== ctx.depthSize) {
      ctx.depthSize = size;
      ctx.font = `${size}px ${MONO_FONT}`;
    }
  }

  /** Ridges, the forest silhouette, shore, mist and the near banks. */
  paintLand(ctx) {
    const { width, height } = this;
    const scene = activeScene();
    const horizon = height * scene.horizon;
    const ridges = scene.ridges;

    ridges.forEach((ridge, index) => {
      const points = this.ridgeOutlines[index];
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
      ctx.lineTo(width, horizon + height * 0.03);
      ctx.lineTo(0, horizon + height * 0.03);
      ctx.closePath();
      if (ridge.alpine) {
        // A dark ground under each glyph cell, clipped to the ridgeline.
        ctx.save();
        ctx.clip();
        for (const cell of this.ridgeCells) {
          if (cell.ridge !== index) continue;
          ctx.fillStyle = cell.fill;
          ctx.fillRect(cell.x - this.hillCell.width / 2, cell.y - this.hillCell.height / 2, this.hillCell.width + 0.5, this.hillCell.height + 0.5);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = mixColor(ridge.fill, "#0a0e14", 0.3);
        ctx.fill();
      }

      ctx.fillStyle = ridge.glyph;
      for (const cell of this.ridgeCells) {
        // Breezy meadows are drawn every frame by the ambient layer instead.
        if (cell.ridge !== index || !cell.glyph || this.ambient.breezyRidges.has(index)) continue;
        if (ridge.alpine) ctx.fillStyle = cell.color;
        this.glyphFont(ctx, cell.y, this.hillScale);
        ctx.fillText(cell.glyph, cell.x, cell.y);
      }

      // Valley haze settles between the layers.
      if (index < ridges.length - 1) {
        const hazeTop = horizon - height * 0.07;
        const haze = ctx.createLinearGradient(0, hazeTop, 0, horizon);
        haze.addColorStop(0, "rgba(168, 150, 124, 0)");
        haze.addColorStop(1, `rgba(168, 150, 124, ${0.2 - index * 0.08})`);
        ctx.fillStyle = haze;
        ctx.fillRect(0, hazeTop, width, horizon - hazeTop);
      }
    });

    // Anything standing back in the woods (the fire tower) goes under the forest.
    ctx.font = this.font;
    ctx.depthSize = null;
    this.paintStructures(ctx, true);

    // A dark canopy silhouette keeps the forest legible against the hazy hills.
    ctx.fillStyle = "#111a14";
    ctx.beginPath();
    if (scene.forest.silhouette === "crowns") {
      // Scattered trees: back each glyph with a soft blob so crowns keep their own shape.
      // Bare winter crowns are mostly sky: only a thin backing behind their twigs.
      const radius = Math.max(this.farCell.width, this.farCell.height) * (isWinter() ? 0.3 : 0.62);
      for (const cell of this.forestCells) {
        ctx.moveTo(cell.x + radius, cell.y);
        ctx.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
      }
    } else {
      // Flat out to both screen edges at the outermost treetops, so no sky shows at the sides.
      // (The treeline holds one column past the screen, which no tree reaches: leave it out.)
      const tops = this.treeline.subarray(0, this.columns);
      ctx.moveTo(0, tops[0]);
      tops.forEach((top, column) => ctx.lineTo((column + 0.5) * this.cellWidth, top));
      ctx.lineTo(width, tops[tops.length - 1]);
      // Back along the wavy shoreline itself, a little into the water, so no sky shows under the trees.
      for (let x = width; x >= 0; x -= 8) ctx.lineTo(x, this.shorelineY(x) + this.lineHeight * 0.4);
      ctx.closePath();
    }
    ctx.fill();

    // Cottages, the dam and pylons stand on the far shore.
    this.paintStructures(ctx, false);

    for (const cell of this.shoreCells) {
      ctx.fillStyle = cell.color;
      this.glyphFont(ctx, cell.y);
      ctx.fillText(cell.glyph, cell.x, cell.y);
    }
    ctx.font = this.font;

    const mist = ctx.createLinearGradient(0, horizon - height * 0.035, 0, horizon + height * 0.02);
    mist.addColorStop(0, "rgba(190, 176, 150, 0)");
    mist.addColorStop(0.65, "rgba(190, 176, 150, 0.11)");
    mist.addColorStop(1, "rgba(190, 176, 150, 0)");
    ctx.fillStyle = mist;
    ctx.fillRect(0, horizon - height * 0.035, width, height * 0.055);

    // Winter: snow over everything painted so far (hills, meadows, the far shore, roofs), not the water.
    const winter = isWinter();
    if (winter) {
      // Only the part ever on screen: a phone shows a slice of a wider scene, and nothing stands above landTop.
      const ratio = this.pixelRatio;
      const left = Math.max(0, Math.floor((this.frame.left - 4) * ratio));
      const right = Math.min(ctx.canvas.width, Math.ceil((this.frame.left + this.frame.width + 4) * ratio));
      const top = Math.max(0, Math.floor(this.landTop * ratio));
      if (right > left && ctx.canvas.height > top) {
        const image = ctx.getImageData(left, top, right - left, ctx.canvas.height - top);
        snowImageData(image.data, 0.72);
        ctx.putImageData(image, left, top);
      }
    }

    this.paintWaterBody(ctx);
    this.paintWreckHull(ctx);

    // The grassy bank we stand on: dark earth under the blades, fading into the
    // water over a few soft steps instead of a hard edge.
    if (scene.nearBank) {
      const steps = 6;
      for (let step = steps; step >= 0; step -= 1) {
        const rise = step * this.lineHeight * 0.35;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, nearBankY(x, height) - rise + this.lineHeight * 0.8);
        ctx.lineTo(width, height);
        ctx.closePath();
        // Under snow in winter.
        ctx.fillStyle = winter ? (step ? "rgba(176, 190, 198, 0.16)" : "#b0bec6") : step ? `rgba(20, 34, 26, ${0.16})` : "#14221a";
        ctx.fill();
      }
    }

    // Near banks (grass or rock) cover the water at the sides.
    if (scene.banks) {
      const cliff = scene.banks.style === "cliff";
      for (const side of ["left", "right"]) {
        ctx.beginPath();
        const edgeX = (depth) => {
          const widths = scene.banks[side](depth);
          return side === "left" ? Math.max(0, widths) * width : width * (1 - Math.max(0, widths));
        };
        const outer = side === "left" ? 0 : width;
        ctx.moveTo(outer, horizon);
        for (let y = horizon; y <= height + 8; y += 8) ctx.lineTo(edgeX(y / height), y);
        ctx.lineTo(outer, height);
        ctx.closePath();
        // Near black between the blades, like earth in deep grass.
        ctx.fillStyle = cliff ? (winter ? "#5e666a" : "#121614") : winter ? "#a6b3ba" : "#111c14";
        ctx.fill();
      }
      if (!this.ambient.grassBanks) {
        for (const cell of this.bankCells) {
          ctx.fillStyle = winter ? snowHex(cell.color, 0.6) : cell.color;
          this.glyphFont(ctx, cell.y);
          ctx.fillText(cell.glyph, cell.x, cell.y);
        }
        ctx.font = this.font;
      }
      // Trees on the banks get a dark backing that follows their own leaves, so they stand out from the grass;
      // bare in winter, only a grey-brown haze of twigs against the snow.
      ctx.fillStyle = winter ? "rgba(92, 82, 72, 0.4)" : "#0c140e";
      for (const cell of this.forestCells) {
        if (cell.bank) ctx.fillRect(cell.x - this.cellWidth * 0.6, cell.y - this.lineHeight * 0.6, this.cellWidth * 1.2, this.lineHeight * 1.2);
      }
    }
  }

  /** A dark hull under the wreck's glyphs, so the ship reads as one solid shape on the water. */
  paintWreckHull(ctx) {
    const ship = wreckShape(this.width, this.height);
    if (!ship) return;
    const { cx, half, keel, top, funnel, funnelFoot, funnelX, mast, mastFoot, mastX } = ship;
    const steps = 96;
    const xAt = (u) => cx - half + 2 * half * u;
    // Dark, the gaps between its glyphs rather than a painted hull.
    ctx.fillStyle = this.winterIce ? "#1a1412" : "#1c110b";
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      if (i) ctx.lineTo(xAt(u), top(u));
      else ctx.moveTo(xAt(u), top(u));
    }
    for (let i = steps; i >= 0; i -= 1) ctx.lineTo(xAt(i / steps), keel(i / steps));
    ctx.closePath();
    ctx.fill();
    const peak = funnelFoot - funnel.height;
    ctx.beginPath();
    ctx.moveTo(funnelX(funnelFoot) - funnel.half, funnelFoot);
    ctx.lineTo(funnelX(peak) - funnel.half, peak);
    ctx.lineTo(funnelX(peak) + funnel.half, peak);
    ctx.lineTo(funnelX(funnelFoot) + funnel.half, funnelFoot);
    ctx.closePath();
    ctx.fill();
    // The mast gets a dark backing too, so it stands out against the water.
    const tip = mastFoot - mast.height;
    ctx.beginPath();
    ctx.moveTo(mastX(mastFoot) - mast.half, mastFoot);
    ctx.lineTo(mastX(tip) - mast.half, tip);
    ctx.lineTo(mastX(tip) + mast.half * 2.5, tip);
    ctx.lineTo(mastX(mastFoot) + mast.half * 2.5, mastFoot);
    ctx.closePath();
    ctx.fill();
  }

  /** Structure silhouettes and glyphs: those behind the forest (`behind`), or the rest. */
  /** The fine-grid cells under a structure's own detail glyphs (left clear of filler). */
  maskStructureCells() {
    const { width: cellWidth, height: lineHeight } = this.farCell;
    const mask = new Set();
    for (const cell of this.structureCells) {
      // A glyph on the main grid covers several fine cells.
      const halfW = (this.cellWidth * (cell.scale ?? 1)) / 2;
      const halfH = (this.lineHeight * (cell.scale ?? 1)) / 2;
      for (let column = Math.floor((cell.x - halfW) / cellWidth); column * cellWidth < cell.x + halfW - 0.5; column += 1) {
        for (let row = Math.floor((cell.y - halfH) / lineHeight); row * lineHeight < cell.y + halfH - 0.5; row += 1) mask.add(column * 65536 + row);
      }
    }
    return mask;
  }

  paintStructures(ctx, behind) {
    // Every solid part is built of glyphs too: a dark ground under a dense field of fine
    // characters in its own colour, wherever its detail glyphs leave room.
    const mask = this.structureMask ?? (this.structureMask = this.maskStructureCells());
    const far = DEPTH ? DEPTH.far : 1;
    const { width: cellWidth, height: lineHeight } = this.farCell;
    for (const shape of this.structureShapes) {
      if (Boolean(shape.behind) !== behind) continue;
      const path = new Path2D();
      shape.points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      path.closePath();
      ctx.fillStyle = mixColor(shape.color, "#000000", 0.45);
      ctx.fill(path);
      const xs = shape.points.map(([x]) => x);
      const ys = shape.points.map(([, y]) => y);
      ctx.save();
      ctx.clip(path);
      // A touch lighter than the old flat fill, so with the dark ground between them the whole reads the same.
      const tones = [mixColor(shape.color, "#ffffff", 0.45), mixColor(shape.color, "#ffffff", 0.3), mixColor(shape.color, "#ffffff", 0.15)];
      for (let row = Math.floor(Math.min(...ys) / lineHeight); row * lineHeight < Math.max(...ys) + lineHeight; row += 1) {
        const y = (row + 0.5) * lineHeight;
        this.glyphFont(ctx, y, far);
        for (let column = Math.floor(Math.min(...xs) / cellWidth); column * cellWidth < Math.max(...xs) + cellWidth; column += 1) {
          if (mask.has(column * 65536 + row)) continue;
          const noise = hash2(column, row, 3301);
          ctx.fillStyle = tones[Math.floor(hash2(column, row, 3303) * 3)];
          ctx.fillText(STRUCTURE_GLYPHS[Math.floor(noise * STRUCTURE_GLYPHS.length)], (column + 0.5) * cellWidth, y);
        }
      }
      ctx.restore();
    }
    for (const cell of this.structureCells) {
      // Rustling leaves are drawn every frame by the ambient layer.
      if (cell.rustle || Boolean(cell.behind) !== behind) continue;
      ctx.fillStyle = cell.color;
      if (cell.scale) this.glyphFont(ctx, cell.y, cell.scale);
      else if (ctx.depthSize) {
        ctx.font = this.font;
        ctx.depthSize = null;
      }
      ctx.fillText(cell.glyph, cell.x, cell.y);
    }
    ctx.font = this.font;
    ctx.depthSize = null;
  }

  /**
   * Mystic nights: wisps over the far water, a pale figure on the far
   * shore and red eyes near the bank. Positions are fractions of the visible
   * slice of the scene; fading mixes each colour toward the night water.
   */
  drawNightEvents(night, time) {
    const { glow } = this.ambientBatches;
    const { cellWidth, lineHeight } = this;
    const { left, width } = this.frame;
    const mix = (from, to, t) => {
      const channel = (shift) => Math.round(((from >> shift) & 255) * (1 - t) + ((to >> shift) & 255) * t);
      return (channel(16) << 16) | (channel(8) << 8) | channel(0);
    };
    const NIGHT = 0x101820;
    for (const wisp of night.wisps) {
      const x = left + wisp.x * width;
      const y = this.shorelineY(x) + lineHeight * (0.8 + wisp.rise * 1.6);
      const strength = night.depth * wisp.flicker;
      // A bright core with a soft halo either side, bright enough to read through the cold grade.
      glow.push(x, y, wisp.flicker > 0.8 ? "@" : "O", mix(NIGHT, 0xb8ffc8, strength));
      glow.push(x - cellWidth, y, "(", mix(NIGHT, 0x4cf078, strength * 0.85));
      glow.push(x + cellWidth, y, ")", mix(NIGHT, 0x4cf078, strength * 0.85));
      glow.push(x, y - lineHeight * 0.9, "'", mix(NIGHT, 0x4cf078, strength * 0.6));
      // A trembling reflection beneath it.
      glow.push(x + Math.sin(time * 4 + wisp.x * 40) * 1.5, y + lineHeight * 1.3, "~", mix(NIGHT, 0x3cd868, strength * 0.75));
    }
    if (night.figure && night.figure.alpha > 0.02) this.drawApparition(night.figure, night.depth, time, mix, NIGHT);
    if (night.eyes && night.eyes.alpha > 0.02) {
      const x = left + night.eyes.x * width;
      const y = this.height * night.eyes.y;
      const color = mix(NIGHT, 0xff1408, night.eyes.alpha);
      const halo = mix(NIGHT, 0xa01810, night.eyes.alpha);
      for (const ex of [x, x + cellWidth * 2.2]) {
        glow.push(ex, y, "@", color);
        glow.push(ex, y + lineHeight * 0.9, "~", halo);
      }
    }
  }

  /**
   * A lure hanging from the tip or flying out, each as itself: the spinner's
   * blade turning round in front of a red bead, the wobbler a little green
   * fish with a yellow belly and a clear lip, the spoon a flashing blade.
   */
  drawLureInAir(ctx, angler, end, size) {
    const time = angler.time;
    if (angler.lureId === "spinner") {
      // The blade spins: edge on, then face on, round and round.
      const blade = "|)|("[Math.floor(time * 18) % 4];
      ctx.fillStyle = "#e6ebe4";
      ctx.fillText(blade, end.x, end.y - size * 0.3);
      ctx.fillStyle = "#c4643e";
      ctx.fillText("o", end.x, end.y + size * 0.35);
      return;
    }
    if (angler.lureId === "wobbler") {
      ctx.fillStyle = "#5f9a56";
      ctx.fillText("<", end.x - size * 0.3, end.y);
      ctx.fillStyle = "#e2b85e";
      ctx.fillText("=", end.x + size * 0.25, end.y);
      ctx.fillStyle = "rgba(200, 220, 214, 0.8)";
      ctx.fillText(",", end.x + size * 0.7, end.y + size * 0.2);
      return;
    }
    ctx.fillStyle = Math.sin(time * 7) > 0 ? "#e6ebe4" : "#b7c2bd";
    ctx.fillText("0", end.x, end.y);
    ctx.fillStyle = "#c4643e";
    ctx.fillText("'", end.x, end.y + size * 0.55);
  }

  /** A lure being reeled in under the surface, with its own action and wake. */
  drawLureInWater(ctx, angler, end, size) {
    const time = angler.time;
    if (angler.lureId === "spinner") {
      // A steady buzz: the blade a blur of flashes, a straight line of bubbles behind.
      ctx.fillStyle = Math.sin(time * 40) > 0 ? "#f2f4ee" : "#aab8b4";
      ctx.fillText("*", end.x, end.y);
      ctx.fillStyle = "rgba(200, 220, 214, 0.55)";
      ctx.fillText(":", end.x, end.y - size * 0.55);
      ctx.fillText(".", end.x, end.y - size * 1.05);
      return;
    }
    if (angler.lureId === "wobbler") {
      // It swims: rocking side to side as it dives, a dark green back with a yellow flash.
      const rock = Math.sin(time * 14) * size * 0.22;
      ctx.fillStyle = "#5f9a56";
      ctx.fillText("<", end.x + rock - size * 0.3, end.y);
      ctx.fillStyle = Math.sin(time * 14) > 0 ? "#e2b85e" : "#8a7a3a";
      ctx.fillText("=", end.x + rock + size * 0.25, end.y);
      ctx.fillStyle = "rgba(200, 220, 214, 0.5)";
      ctx.fillText("~", end.x - rock * 0.5, end.y - size * 0.6);
      return;
    }
    // The spoon flashes as it wobbles through the water, a little wake behind it.
    ctx.fillStyle = Math.sin(time * 26) > 0 ? "#eef2ec" : "#9fb0ae";
    ctx.fillText("o", end.x, end.y);
    ctx.fillStyle = "rgba(200, 220, 214, 0.6)";
    ctx.fillText("~", end.x, end.y - size * 0.55);
  }

  /** The night's apparition by the far shore (see night-events.js), drawn as glowing glyphs. */
  drawApparition(figure, depth, time, mix, NIGHT) {
    const { glow } = this.ambientBatches;
    const { cellWidth, lineHeight } = this;
    const { left, width } = this.frame;
    const x = left + figure.x * width;
    const shore = this.shorelineY(x);
    const strength = figure.alpha * depth;
    const pale = mix(NIGHT, 0xdfe6ee, strength);
    const dim = mix(NIGHT, 0x8a96a4, strength * 0.8);
    const warm = mix(NIGHT, 0xffcf78, strength);
    const warmDim = mix(NIGHT, 0xc08a3c, strength * 0.7);
    // Rows of a glyph picture, bottom row on `base`; spaces are left empty.
    const draw = (rows, cx, base, color, clip = Infinity) => {
      rows.forEach((row, index) => {
        const y = base - (rows.length - 1 - index) * lineHeight;
        if (y > clip) return;
        [...row].forEach((glyph, k) => {
          if (glyph !== " ") glow.push(cx + (k - (row.length - 1) / 2) * cellWidth, y, glyph, color);
        });
      });
    };
    if (figure.kind === "boat") {
      // On the far water just off the shore; the hull dark, the lantern warm, its light trembling below.
      const y = shore + lineHeight * (1.4 + figure.sink * 0.8);
      const fade = 1 - figure.sink;
      draw(["\\_____/"], x, y, mix(NIGHT, 0x8a94a0, strength * 0.8 * fade));
      // The boatman, hooded and still, standing at the stern.
      draw([" ^", "/|", " |"], x - cellWidth * 2, y - lineHeight, mix(NIGHT, 0xc8d0da, strength * 0.85 * fade));
      draw(["o", "|"], x + cellWidth * 3, y - lineHeight, mix(NIGHT, 0xffcf78, strength * fade));
      for (let k = 1; k <= 3; k += 1) glow.push(x + cellWidth * 2 + Math.sin(time * 3 + k) * 2, y + lineHeight * k * 0.8, k === 1 ? "~" : "-", mix(NIGHT, 0xc08a3c, strength * fade * (0.7 - k * 0.15)));
      return;
    }
    if (figure.kind === "lantern") {
      const y = shore - lineHeight * 1.2;
      const lx = x + figure.sway * 2;
      glow.push(lx, y, "o", warm);
      glow.push(lx - cellWidth, y, "(", warmDim);
      glow.push(lx + cellWidth, y, ")", warmDim);
      glow.push(lx, y - lineHeight * 0.8, "'", warmDim);
      for (let k = 1; k <= 3; k += 1) glow.push(lx + Math.sin(time * 4 + k * 2) * 2, shore + lineHeight * (0.6 + k * 0.7), k === 1 ? "~" : "-", mix(NIGHT, 0xc08a3c, figure.alpha * depth * (0.6 - k * 0.12)));
      return;
    }
    if (figure.kind === "angler") {
      // Sitting on the far bank, rod out over the water; at a third of the way through he casts.
      const base = shore - lineHeight * 0.4;
      const dir = figure.dir;
      draw([" o", "/|", "_|\\"], x, base, pale);
      const cast = figure.progress > 0.33;
      // The rod: raised high before the cast, out over the water after it.
      const steps = 4;
      for (let k = 1; k <= steps; k += 1) {
        const rise = cast ? 0.6 : 1.4;
        glow.push(x + dir * (k + 0.5) * cellWidth, base - lineHeight * (1 + k * rise * 0.5), dir > 0 ? "/" : "\\", dim);
      }
      if (cast) {
        // The line drops to a float that glows faintly green.
        const tipX = x + dir * (steps + 0.5) * cellWidth;
        const floatX = tipX + dir * cellWidth * 2;
        const settle = Math.min(1, (figure.progress - 0.33) / 0.1);
        glow.push(floatX, shore + lineHeight * (0.9 + 0.3 * Math.sin(time * 2)), "|", mix(NIGHT, 0x9cf0a0, strength * settle));
        if (settle < 1) glow.push(floatX, shore + lineHeight * 1.3, "o", mix(NIGHT, 0x8ab0c0, strength * (1 - settle)));
      }
      return;
    }
    // The mavka: pale, long hair down her back; past the halfway mark she walks into the water.
    const sinking = Math.max(0, (figure.progress - 0.45) / 0.25);
    const base = shore - lineHeight * 0.4 + sinking * lineHeight * 4.2;
    // Whatever has gone under the waterline isn't drawn.
    draw([" @ ", "(|)", "/|\\", "/ \\"], x, base, mix(NIGHT, 0xe4f0ee, strength), shore - lineHeight * 0.1);
    if (sinking > 0) glow.push(x, shore + lineHeight * 0.7, sinking < 1 ? "~" : "-", mix(NIGHT, 0x9fc0c8, strength * (1 - sinking * 0.5)));
  }

  /** A static foreground rock, cropped to its bounds so the overlay copies only a small image. */
  createRockImage(rock) {
    const { pixelRatio } = this;
    const left = Math.floor(rock.cx - rock.rx * 1.15);
    const top = Math.floor(rock.baseY - rock.ry * 1.4);
    const width = Math.ceil(rock.rx * 2.3);
    const height = Math.ceil(this.height - top);
    const image = document.createElement("canvas");
    image.width = Math.max(1, Math.round(width * pixelRatio));
    image.height = Math.max(1, Math.round(height * pixelRatio));
    const ctx = image.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, -left * pixelRatio, -top * pixelRatio);
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    rock.outline.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.closePath();
    ctx.fillStyle = rock.kind === "block" ? "#262b29" : "#18201d";
    ctx.fill();
    for (const cell of rockGlyphs(rock, this.cellWidth, this.lineHeight)) {
      ctx.fillStyle = cell.color;
      ctx.fillText(cell.glyph, cell.x, cell.y);
    }
    return { image, left, top, width, height };
  }

  /**
   * A rusty radiation warning sign leaning on its post among the reeds,
   * pre-rendered once per layout: a yellow triangle with the black trefoil,
   * flaking at the edges. `x` is its place across the visible view.
   */
  createSignImage({ x: fx, lean }) {
    const { height, cellWidth, lineHeight, pixelRatio } = this;
    const size = Math.min(this.frame.width, height * 1.5);
    const footY = height + lineHeight;
    const post = height * 0.3;
    // On a narrow phone screen the plate keeps enough glyphs to read.
    const side = Math.max(size * 0.08, height * 0.065);
    // The leaning plate stays clear of the right edge.
    const footX = Math.min(this.frame.left + this.frame.width * fx, this.frame.left + this.frame.width - side * 0.75 - post * Math.sin(lean));
    const left = Math.floor(footX - post * 0.6);
    const top = Math.floor(footY - post - side * 1.2);
    const width = Math.ceil(post * 1.2);
    const imageHeight = Math.ceil(height - top);
    const image = document.createElement("canvas");
    image.width = Math.max(1, Math.round(width * pixelRatio));
    image.height = Math.max(1, Math.round(imageHeight * pixelRatio));
    const ctx = image.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, -left * pixelRatio, -top * pixelRatio);
    ctx.translate(footX, footY);
    ctx.rotate(lean);
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // The post: an old steel pipe, rusted through in places.
    ctx.fillStyle = "#1a120a";
    ctx.fillRect(-cellWidth * 0.55, -post, cellWidth * 1.1, post);
    for (let y = -lineHeight * 0.5, r = 0; y > -post; y -= lineHeight, r += 1) {
      ctx.fillStyle = hash2(r, 1, 1801) > 0.6 ? "#8a4a24" : "#5a3a24";
      ctx.fillText(hash2(r, 2, 1801) > 0.8 ? ":" : "|", 0, y);
    }
    // The plate, hung a little crooked on the post: a triangle of glyphs on a
    // dark backing, like the rocks, the trefoil picked out in dark glyphs.
    ctx.translate(0, -post);
    ctx.rotate(-lean * 0.4);
    const h = side * 0.87;
    const apex = -h * 0.62;
    const foot = h * 0.38;
    const halfAt = (y) => (side / 2) * ((y - apex) / (foot - apex));
    ctx.beginPath();
    ctx.moveTo(0, apex - lineHeight * 0.6);
    ctx.lineTo(halfAt(foot) + cellWidth * 0.9, foot + lineHeight * 0.5);
    ctx.lineTo(-halfAt(foot) - cellWidth * 0.9, foot + lineHeight * 0.5);
    ctx.closePath();
    ctx.fillStyle = "#1c140b";
    ctx.fill();
    // Dark under the glyphs, inside the rim: the paint is all in the glyphs.
    ctx.beginPath();
    ctx.moveTo(0, apex + lineHeight * 0.2);
    ctx.lineTo(halfAt(foot) - cellWidth * 0.3, foot - lineHeight * 0.3);
    ctx.lineTo(-halfAt(foot) + cellWidth * 0.3, foot - lineHeight * 0.3);
    ctx.closePath();
    ctx.fillStyle = "#2a200c";
    ctx.fill();
    const hubY = h * 0.08;
    const outer = side * 0.22;
    for (let row = 0, y = apex + lineHeight * 0.3; y <= foot; y += lineHeight, row += 1) {
      const half = halfAt(y);
      const columns = Math.max(0, Math.floor(half / cellWidth));
      for (let c = -columns; c <= columns; c += 1) {
        const x = c * cellWidth;
        const noise = hash2(c + 50, row, 1804);
        const edge = Math.abs(c) === columns || y + lineHeight > foot;
        // Around the hub: three blades 120 degrees apart (one pointing down), a gap, the dot in the middle.
        const r = Math.hypot(x, y - hubY) / outer;
        const angle = (Math.atan2(y - hubY, x) * 180) / Math.PI + 90;
        const blade = ((angle % 120) + 120) % 120;
        const inTrefoil = r < 0.22 || (r > 0.36 && r < 1 && blade > 30 && blade < 90);
        let glyph;
        let color;
        if (edge) {
          glyph = y + lineHeight > foot ? (noise > 0.5 ? "=" : "_") : c < 0 ? "/" : c > 0 ? "\\" : "^";
          color = noise > 0.55 ? "#8a4a22" : "#5e3818";
        } else if (inTrefoil) {
          // A dark backing cell under each trefoil glyph, so the symbol reads as a shape.
          ctx.fillStyle = "#2a1d0e";
          ctx.fillRect(x - cellWidth / 2, y - lineHeight / 2, cellWidth, lineHeight);
          glyph = r < 0.22 ? "@" : "#%#"[Math.floor(noise * 3)];
          color = "#4a3418";
        } else if (noise < 0.22) {
          // Rust eating through the paint.
          glyph = ".:,;"[Math.floor(noise * 18) % 4];
          color = noise < 0.1 ? "#7a4320" : "#93582a";
        } else {
          glyph = "#%&#@%"[Math.floor(noise * 6)];
          color = noise > 0.7 ? "#e0bc4c" : "#c49a32";
        }
        ctx.fillStyle = color;
        ctx.fillText(glyph, x, y);
      }
    }
    // The bolt it hangs from.
    ctx.fillStyle = "#3a2a1a";
    ctx.fillText("o", 0, apex + lineHeight * 0.3);
    return { image, left, top, width, height: imageHeight };
  }

  /**
   * A big old oak on our own bank at the left, close up: the trunk rising from
   * the bottom corner, a heavy limb reaching out over the water and the crown
   * filling the top-left corner (cut off by the edges, it's that near). Drawn
   * once per layout like the rocks: a dark backing under ASCII bark and
   * leaves, lit from the sun's side. In autumn the crown turns rust and gold.
   * Returns the image and the crown cells leaves can fall from.
   */
  createOak() {
    const { height, pixelRatio } = this;
    const { left: frameLeft, width: frameWidth } = this.frame;
    const size = Math.min(frameWidth * 1.05, height * 1.25);
    // On a tall phone screen the tree is laid out taller than it is wide, so
    // the crown still comes down toward the water instead of perching at the top.
    const tall = Math.max(size, height * 0.95);
    const autumn = isAutumn();
    const winter = isWinter();
    // It stands close, so its glyphs are larger than the far landscape's.
    const glyphSize = Math.round(this.reedSize * 0.72);
    const cellWidth = glyphSize * 0.62;
    const lineHeight = glyphSize * 0.9;
    const at = (fx, fy) => ({ x: frameLeft + fx * size, y: fy * tall });
    const stretch = (size + tall) / 2 / size;
    // The crown's outline: overlapping masses (centre and radius, in `size` units).
    const masses = [
      [0.0, 0.02, 0.17], [0.15, -0.01, 0.14], [0.27, 0.06, 0.1], [0.07, 0.15, 0.12],
      [0.2, 0.15, 0.085], [0.31, 0.19, 0.06], [-0.02, 0.26, 0.09], [0.12, 0.25, 0.055], [0.24, 0.25, 0.04],
    ].map(([fx, fy, r]) => ({ ...at(fx, fy), r: r * size, ry: r * size * stretch }));
    // Each mass is lumpy round its rim, not a clean circle.
    const envelope = (x, y) => Math.max(...masses.map((mass, i) => {
      const angle = Math.atan2(y - mass.y, x - mass.x);
      const r = mass.r * (1 + 0.13 * Math.sin(angle * 5 + i * 1.7) + 0.07 * Math.sin(angle * 11 + i * 3.1));
      return 1 - Math.hypot(x - mass.x, ((y - mass.y) * mass.r) / mass.ry) / r;
    }));
    // Inside it, many smaller clusters of leaves, each lit on its upper right
    // and shaded below, so the crown reads as heaped foliage, not a flat blob.
    const clusters = [];
    for (let i = 0; clusters.length < 80 && i < 1200; i += 1) {
      const x = frameLeft + (hash01(i * 7 + 1) * 0.6 - 0.2) * size;
      const y = (hash01(i * 11 + 3) * 0.42 - 0.12) * tall;
      if (envelope(x, y) < 0.12) continue;
      clusters.push({ x, y, r: (0.035 + hash01(i * 13 + 5) * 0.04) * size });
    }
    const right = Math.max(...masses.map((mass) => mass.x + mass.r)) + cellWidth * 3;
    const left = frameLeft;
    const top = 0;
    const width = Math.ceil(right - left);
    const image = document.createElement("canvas");
    image.width = Math.max(1, Math.round(width * pixelRatio));
    image.height = Math.max(1, Math.round(height * pixelRatio));
    const ctx = image.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, -left * pixelRatio, -top * pixelRatio);
    ctx.font = `600 ${glyphSize}px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Trunk and limbs: tapering bands along gentle curves, from the root up.
    const curve = (from, bend, to) => (t) => ({
      x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * bend.x + t * t * to.x,
      y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * bend.y + t * t * to.y,
    });
    const limbs = [];
    const limb = (from, bend, to, w0, w1) => {
      const point = curve(from, bend, to);
      const steps = Math.max(8, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (lineHeight * 0.4)));
      ctx.fillStyle = "#140d08";
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const p = point(t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ((w0 + (w1 - w0) * t) * size) / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      limbs.push({ point, w0, w1, steps });
    };
    const base = { x: frameLeft + 0.045 * size, y: height + lineHeight * 2 };
    const fork = at(0.075, 0.3);
    // Roots flaring into the bank, then the trunk.
    limb({ x: base.x - 0.09 * size, y: height + lineHeight }, { x: base.x - 0.03 * size, y: height - lineHeight }, { x: base.x, y: height - 0.08 * size }, 0.03, 0.06);
    limb({ x: base.x + 0.1 * size, y: height + lineHeight }, { x: base.x + 0.04 * size, y: height - lineHeight * 0.5 }, { x: base.x + 0.01 * size, y: height - 0.07 * size }, 0.025, 0.06);
    limb(base, { x: frameLeft + 0.015 * size, y: (base.y + fork.y) * 0.55 }, fork, 0.12, 0.065);
    // The long limb over the water, curving up at its end, and the boughs into the crown.
    const reach = at(0.07, 0.37);
    limb(reach, at(0.19, 0.38), at(0.31, 0.22), 0.04, 0.012);
    limb(at(0.15, 0.36), at(0.2, 0.31), at(0.22, 0.26), 0.014, 0.006);
    limb(at(0.25, 0.3), at(0.27, 0.32), at(0.25, 0.27), 0.01, 0.005);
    limb(fork, at(0.14, 0.2), at(0.17, 0.04), 0.042, 0.015);
    limb(fork, at(0.02, 0.17), at(-0.02, 0.05), 0.048, 0.02);
    limb(at(0.11, 0.2), at(0.2, 0.15), at(0.26, 0.08), 0.02, 0.008);
    // Bark over the dark limbs: furrowed, lit on the sun's side (the right), with a knot or two.
    const bark = new Set();
    for (const { point, w0, w1, steps } of limbs) {
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const p = point(t);
        const half = ((w0 + (w1 - w0) * t) * size) / 2;
        const row = Math.round(p.y / lineHeight);
        for (let column = Math.round((p.x - half) / cellWidth); column <= Math.round((p.x + half) / cellWidth); column += 1) {
          const key = column * 8192 + row;
          if (bark.has(key)) continue;
          bark.add(key);
          const across = half > cellWidth * 0.7 ? (column * cellWidth - p.x) / half : 0.4;
          const noise = hash2(column, row, 2201);
          const knot = half > cellWidth * 3 && noise > 0.965;
          const glyph = knot ? "@" : Math.abs(across) > 0.8 ? (across < 0 ? "(" : ")") : "||!|:{}|"[Math.floor(noise * 8)];
          ctx.fillStyle = knot ? "#2a1e14" : across > 0.25 ? (noise > 0.5 ? "#8e7656" : "#75603f") : across < -0.35 ? "#33271b" : noise > 0.55 ? "#5c4a35" : "#4a3b2a";
          ctx.fillText(glyph, column * cellWidth, row * lineHeight + lineHeight / 2);
        }
      }
    }

    // The crown, cell by cell. Leaf clusters on top; where none reaches, the
    // deep shade inside the crown; a fringe of loose leaves round the edge.
    const summer = { deep: "#102016", shadow: "#1d3622", middle: "#31552f", light: "#62853d", glint: "#a3b058" };
    const fall = { deep: "#2a130a", shadow: "#55240f", middle: "#8c4218", light: "#c4762a", glint: "#e4b84a" };
    const spring = { deep: "#0f2414", shadow: "#244a26", middle: "#3f7a36", light: "#7cae4a", glint: "#c4d870" };
    const palette = autumn ? fall : isSpring() ? spring : summer;
    const crown = [];
    // Winter: where snow lies on the twigs (a gust can shake a clump of it down).
    const snowy = [];
    const bottom = Math.max(...masses.map((mass) => mass.y + mass.ry));
    for (let row = 0; row * lineHeight < bottom + lineHeight; row += 1) {
      const y = row * lineHeight + lineHeight / 2;
      for (let column = Math.floor(left / cellWidth); column * cellWidth < right; column += 1) {
        const x = column * cellWidth;
        const noise = hash2(column, row, 2203);
        const fill = envelope(x, y) + (noise - 0.5) * 0.12;
        if (fill < -0.06) continue;
        // Winter: the crown is bare, a web of dark twigs with snow along the upper ones.
        if (winter) {
          if (fill < 0.02 || noise < 0.6) continue;
          const up = y < 0.16 * tall && hash2(column, row, 2207) > 0.55;
          if (up) snowy.push({ x, y });
          ctx.fillStyle = up ? "#e2e9ec" : noise > 0.8 ? "#5a4c3e" : "#3e342a";
          ctx.fillText(up ? "-" : "/\\|'`,"[Math.floor(hash2(column, row, 2211) * 6)], x, y);
          continue;
        }
        // The fringe: loose single leaves just outside the crown.
        if (fill < 0.03) {
          if (hash2(column, row, 2205) > 0.45) continue;
          ctx.fillStyle = palette[noise > 0.5 ? "middle" : "shadow"];
          ctx.fillText(".,'`*"[Math.floor(noise * 5)], x, y);
          continue;
        }
        let best = 0;
        let lit = 0;
        for (const cluster of clusters) {
          const dx = (x - cluster.x) / cluster.r;
          const dy = (y - cluster.y) / (cluster.r * stretch);
          const inside = 1 - Math.hypot(dx, dy);
          if (inside > best) {
            best = inside;
            lit = 0.5 + (dx * 0.55 - dy * 0.85) * 0.5;
          }
        }
        // The lower crown and its left side are in its own shadow.
        const depth = Math.max(0, (y - 0.1 * tall) / tall) * 1.1 + Math.max(0, (frameLeft + 0.05 * size - x) / size) * 0.8;
        const shade = best > 0 ? lit - depth + (noise - 0.5) * 0.3 : -1;
        const tone = shade > 0.72 ? "glint" : shade > 0.42 ? "light" : shade > 0.12 ? "middle" : shade > -0.25 ? "shadow" : "deep";
        // A dark backing hides the sky between the leaves, except at the ragged rim.
        if (fill > 0.12) {
          ctx.fillStyle = autumn ? "#170c06" : "#0c140e";
          ctx.fillRect(x - cellWidth / 2, y - lineHeight / 2, cellWidth + 0.6, lineHeight + 0.6);
        }
        // An autumn crown keeps a few patches of green.
        const green = autumn && hash2(Math.floor(column / 4), Math.floor(row / 3), 2209) < 0.1;
        ctx.fillStyle = (green ? summer : palette)[tone];
        ctx.fillText(tone === "deep" ? "%&*;"[Math.floor(noise * 4)] : "&%@#*8&%"[Math.floor(noise * 8)], x, y);
        if (fill < 0.5 && best > 0) crown.push({ x, y });
      }
    }
    // Winter: places along the thinner boughs where a small bird can sit.
    const perches = [];
    if (winter) {
      // Only where a bough runs nearly level, so a bird sits on top of it, not against it.
      for (const { point, w0, w1 } of limbs) {
        if (w1 > 0.02) continue;
        for (let t = 0.15; t < 0.96; t += 0.2) {
          const p = point(t);
          const next = point(t + 0.04);
          if (Math.abs(next.y - p.y) > Math.abs(next.x - p.x) * 0.7) continue;
          perches.push({ x: p.x, y: p.y - ((w0 + (w1 - w0) * t) * size) / 2 - lineHeight * 0.5 });
        }
      }
    }
    return { image, left, top, width, height, crown, autumn, winter, perches, snowy, leaves: [], landings: [], spawn: 0 };
  }

  /**
   * Leaves letting go of the oak: they tumble down and sideways on the wind,
   * settle on the water (where `landings` lets the caller ripple it), float a
   * while and sink. Now and then in summer, often in autumn.
   */
  drawOakLeaves(ctx, time) {
    const oak = this.oak;
    const step = Math.min(0.5, Math.max(0, time - (oak.time ?? time)));
    oak.time = time;
    // No leaves left to fall in winter.
    const rate = (oak.winter ? 0 : oak.autumn ? 0.9 : 0.12) * (1 + this.rain);
    oak.spawn += step * rate;
    while (oak.spawn >= 1 && oak.crown.length) {
      oak.spawn -= 1;
      if (oak.leaves.length > 40) break;
      const from = oak.crown[Math.floor(Math.random() * oak.crown.length)];
      const shore = this.shorelineY(from.x);
      const colors = oak.autumn ? ["#d08a2c", "#c4642a", "#e0b448", "#a0522a", "#b8742a"] : ["#a6ad4c", "#c8b04a", "#7f9a44"];
      oak.leaves.push({
        x: from.x,
        y: from.y,
        landY: Math.max(from.y + this.lineHeight * 4, shore + (this.height - shore) * (0.08 + Math.random() * 0.85)),
        fall: this.height * (0.04 + Math.random() * 0.03),
        drift: this.cellWidth * (1.2 + Math.random() * 2.5),
        sway: this.cellWidth * (1 + Math.random() * 1.6),
        phase: Math.random() * Math.PI * 2,
        spin: 2.2 + Math.random() * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        afloat: 0,
      });
    }
    ctx.font = `700 ${this.reedSize}px ${MONO_FONT}`;
    const tumble = ["/", "-", "\\", "~"];
    oak.leaves = oak.leaves.filter((leaf) => {
      if (!leaf.afloat) {
        leaf.y += leaf.fall * step;
        leaf.x += leaf.drift * step;
        leaf.phase += leaf.spin * step;
        if (leaf.y >= leaf.landY) {
          leaf.afloat = time;
          if (this.isOpenWater(leaf.x, leaf.y)) oak.landings.push({ x: leaf.x, y: leaf.y });
        }
      } else {
        leaf.x += leaf.drift * 0.08 * step;
      }
      const age = leaf.afloat ? time - leaf.afloat : 0;
      // Afloat it lies flat and darkens as it soaks, then sinks.
      const fade = leaf.afloat ? Math.min(1, Math.max(0, (14 - age) / 6)) : 1;
      if (fade <= 0) return false;
      const x = leaf.x + (leaf.afloat ? 0 : Math.sin(leaf.phase) * leaf.sway);
      ctx.globalAlpha = fade;
      ctx.fillStyle = leaf.color;
      ctx.fillText(leaf.afloat ? "~" : tumble[Math.floor(((leaf.phase % (Math.PI * 2)) / (Math.PI * 2)) * 4) % 4], x, leaf.y);
      return true;
    });
    ctx.globalAlpha = 1;
  }

  /** Where leaves touched the water since the last call (for ripples). */
  takeLeafLandings() {
    if (!this.oak?.landings.length) return [];
    const landed = this.oak.landings;
    this.oak.landings = [];
    return landed;
  }

  /** The wooden railing of the bridge we fish from, pre-rendered once per layout. */
  createBridgeImage(railFraction) {
    const { width, height, cellWidth, lineHeight, pixelRatio } = this;
    const top = Math.floor(height * railFraction - lineHeight);
    const image = document.createElement("canvas");
    image.width = Math.max(1, Math.round(width * pixelRatio));
    image.height = Math.max(1, Math.round((height - top) * pixelRatio));
    const ctx = image.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, -top * pixelRatio);
    ctx.font = `600 ${this.reedSize}px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = this.reedSize;
    const railY = height * railFraction;
    const lowY = railY + (height - railY) * 0.55;
    const beam = size * 1.1;
    const fill = "#1c140e";
    // Posts reach down past the bottom edge; two rails run between them.
    const posts = [];
    for (let x = width * 0.04; x < width; x += width * (0.17 + hash2(Math.round(x), 3, 41) * 0.04)) posts.push(x);
    ctx.fillStyle = fill;
    for (const x of posts) ctx.fillRect(x - size * 0.9, railY - size * 0.9, size * 1.8, height - railY + size);
    ctx.fillRect(0, railY - beam / 2, width, beam);
    ctx.fillRect(0, lowY - beam * 0.4, width, beam * 0.8);
    const wood = (x, y, glyph, row) => {
      const noise = hash2(Math.round(x / cellWidth), row, 77);
      ctx.fillStyle = row === 0 ? (noise > 0.3 ? "#8c6c4a" : "#6e543a") : noise > 0.5 ? "#5e4632" : "#4a382a";
      ctx.fillText(glyph, x, y);
    };
    const step = size * 0.62;
    for (let x = step / 2; x < width; x += step) {
      const noise = hash2(Math.round(x), 1, 91);
      wood(x, railY - size * 0.18, noise > 0.86 ? "-" : "=", 0);
      wood(x, lowY, noise > 0.8 ? "_" : "=", 1);
    }
    for (const x of posts) {
      for (let y = railY - size * 0.55; y < height + size; y += size * 0.8) {
        for (const dx of [-0.42, 0.42]) {
          const lit = dx < 0;
          ctx.fillStyle = y < railY + size * 0.4 ? "#9a7a54" : lit ? "#6e543a" : "#3e2f22";
          ctx.fillText(y < railY + size * 0.4 ? "#" : "|", x + dx * size, y);
        }
      }
    }
    return { image, top };
  }

  fillForest(time) {
    const batch = this.forestBatch;
    batch.clear();
    // Trees sway harder in the wind, and lean a little downwind.
    const { strength, dir, gust } = this.wind;
    const swing = 0.6 + 1.8 * strength * gust;
    const lean = dir * strength * gust * 0.7;
    for (const cell of this.forestCells) {
      const sway = (Math.sin(time * 0.42 + cell.swayPhase) * swing + lean) * cell.swayAmount;
      batch.push(cell.x + sway, cell.y, cell.glyph, cell.colorValue);
    }
  }

  /** A shore-ice cell's look (null for open water): snow on it by the shore, glassy at its ragged edge. */
  iceGlyph(x, y, noise) {
    const ice = this.iceAt(x, y);
    // The edge is lacy: open water shows between the last pieces.
    if (ice <= 0 || (ice < 0.25 && noise < 0.4)) return null;
    if (noise > 0.94) return { glyph: noise > 0.97 ? "/" : "\\", color: ICE_CRACK };
    // Snow lying on the ice by the shore in dense strokes, the bare ice farther out lighter in weight.
    if (ice > 0.6) return { glyph: "#%=&#="[Math.floor(noise * 6)], color: ICE[noise > 0.3 ? 2 : 1] };
    if (ice > 0.25) return { glyph: "=%=+"[Math.floor(noise * 4)], color: ICE[1] };
    return { glyph: "-_~"[Math.floor(noise * 3)], color: ICE[0] };
  }

  /**
   * Put a floe on open water: anywhere at first; later back in where the
   * water comes from (a river's near reach, or the upwind side of a lake).
   */
  placeFloe(floe, returning) {
    const { width, height } = this;
    const { left, width: frameWidth } = this.frame;
    const flowing = Boolean(activeScene().water.flowAway);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const shore = this.shorelineY(left + frameWidth / 2);
      let x = left + frameWidth * (0.05 + Math.random() * 0.9);
      let y = shore + (height - shore) * (0.12 + Math.random() * 0.6);
      if (returning && flowing) y = height * (0.78 + Math.random() * 0.08);
      else if (returning) x = this.wind.dir >= 0 ? left - floe.size : left + frameWidth + floe.size;
      if (returning && !flowing ? isOpenWater(this.wind.dir >= 0 ? left + 4 : left + frameWidth - 4, y, width, height) : isOpenWater(x, y, width, height) && !this.onIce(x, y)) {
        floe.x = x;
        floe.y = y;
        return;
      }
    }
  }

  /** Drift the floes on the current, or on still water slowly before the wind. */
  moveFloes(time) {
    const step = clamp(time - (this.floeTime ?? time), 0, 0.1);
    this.floeTime = time;
    const { width, height, lineHeight } = this;
    const { left, width: frameWidth } = this.frame;
    const wind = this.wind;
    for (const floe of this.floes) {
      const flow = currentAt(floe.x / width, floe.y / height);
      floe.x += (flow.x * width + (this.waterParams.flowAway ? 0 : wind.dir * wind.strength * 7)) * step;
      floe.y += flow.y * height * step;
      const shore = this.shorelineY(floe.x);
      if (floe.y < shore + lineHeight * 1.5 || floe.x < left - floe.size * 1.5 || floe.x > left + frameWidth + floe.size * 1.5) this.placeFloe(floe, true);
      // Smaller and flatter in the distance.
      const distance = clamp((floe.y - shore) / (height - shore), 0, 1);
      floe.rx = floe.size * (0.25 + 0.75 * distance);
      floe.ry = Math.max(this.gridAt(floe.y).lineHeight * 1.7, floe.rx * (0.32 + 0.22 * distance));
    }
    return this.floes;
  }

  /**
   * Steam off the open water in the frost: most on a cold still morning,
   * thin by afternoon, again at night; a wind tears it away.
   */
  fillSteam(time, dayTime) {
    const batch = this.steamBatch;
    batch.clear();
    if (!this.steamCells?.length) return;
    const hour = (dayTime * 24) % 24;
    const wind = this.wind;
    const strength = (0.35 + 0.75 * Math.exp(-(((hour - 8) / 2.5) ** 2)) + (hour < 6 || hour > 20 ? 0.3 : 0)) * (1 - 0.7 * wind.strength);
    const { lineHeight } = this;
    // Patches of it drift downwind and lift off the water as they go.
    const drift = time * 0.05 * wind.dir * (0.4 + wind.strength);
    const lift = time * 0.22;
    for (const cell of this.steamCells) {
      const density = valueNoise(cell.screenX * 0.006 - drift, cell.screenY * 0.03 + lift, 71) * strength * (1 - cell.distance * 0.5);
      if (density < 0.5) continue;
      const thick = density > 0.62;
      batch.push(cell.screenX, cell.screenY - lineHeight * 0.4, thick ? "~" : "-", STEAM[thick ? 1 : 0]);
    }
  }

  fillWater(time, config, ripples) {
    const { cellWidth, lineHeight, columns, backdrop, reflectionColors } = this;
    const { centerX, centerY, axisX, axisY } = this.projection;
    const batch = this.waterBatch;
    const waveConfig = { ...config, ...this.waterParams };
    // Flowing water keeps reflections trembling even when the surface is calm.
    const amplitudeScale = Math.max(config.waveAmplitude / 1.3, this.waterParams.flow ? 0.7 : 0);
    const wobbleTime = time * (0.5 + config.waveSpeed * 2 + (this.waterParams.flow ? 2.5 : 0));
    const flickerSpeed = 1.4 + config.waveSpeed * 5;
    const glintStrength = 4.2 * (0.45 + config.shimmer) * this.lightStrength * (1 - this.rain);
    const glintColors = this.glintColors;
    // Glints are light, not water: drawn on their own so night doesn't dim them.
    const glints = this.glintBatch;
    batch.clear();
    glints.clear();
    // The reflection wobble depends only on the row: one sine per row, not per cell.
    const rowWobble = this.rowWobble ?? (this.rowWobble = new Float32Array(this.rows + 1));
    for (let row = 0; row <= this.rows; row += 1) rowWobble[row] = Math.sin(row * 0.83 + wobbleTime) * cellWidth * 0.7 * amplitudeScale;

    for (const cell of this.waterCells) {
      // Ice lies still on the water.
      if (cell.ice) {
        batch.push(cell.screenX, cell.screenY, cell.ice.glyph, cell.ice.color);
        continue;
      }
      const sample = sampleWater(cell, time, waveConfig, cell.depth, ripples);
      const rampPosition = clamp((sample.density - 0.58) / 0.32, 0, 0.9999);
      const glyph = WATER_RAMP[Math.floor(rampPosition * WATER_RAMP.length)];
      if (glyph === " ") continue;

      // A small fraction of the physical wave displacement lets the text breathe
      // while keeping the underlying character grid clearly aligned.
      const shiftX = centerX + (sample.x - sample.y) * axisX - cell.screenX;
      const shiftY = centerY + (sample.x + sample.y) * axisY - cell.screenY;
      const x = cell.screenX + clamp(shiftX * 0.22, -1.5, 1.5);
      const y = cell.screenY + clamp(shiftY * 0.22, -1.5, 1.5);

      // The low sun lays a path of glints that widens toward the viewer.
      if (cell.sunPath > 0.05 && glintStrength > 0) {
        const flicker = 0.55 + 0.45 * Math.sin(time * flickerSpeed + cell.noise * 40);
        const glint = cell.sunPath * (sample.density - 0.6) * glintStrength * flicker;
        if (glint > 0.5) {
          glints.push(x, y, cell.noise > 0.6 ? "*" : "+", glintColors[1]);
          continue;
        }
        if (glint > 0.22) {
          glints.push(x, y, glyph, glintColors[0]);
          continue;
        }
      }

      // Mirror the shore, wobbling the sampled column with waves and ripples.
      const mirrorY = 2 * cell.shore - cell.screenY - lineHeight * 0.3;
      if (mirrorY > 0) {
        const wobble = rowWobble[cell.row] * (0.25 + cell.distance * 4);
        const column = cell.column + Math.round((shiftX * 1.4 + wobble) / cellWidth);
        const source = column >= 0 && column < columns
          ? backdrop[Math.floor(mirrorY / lineHeight) * columns + column]
          : -1;
        if (source >= 0) {
          batch.push(x, y, glyph, reflectionColors[source][cell.reflectionLevel]);
          continue;
        }
      }

      batch.push(x, y, glyph, this.waterDepthColors[cell.depthLevel][cell.band]);
    }
  }

  /** Lily pads, splash droplets and passing birds. */
  /** The grid at a height on the water: as fine as the water glyphs drawn there. */
  gridAt(y) {
    const scale = this.waterScaleAt(y);
    return { cellWidth: this.cellWidth * scale, lineHeight: this.lineHeight * scale };
  }

  /** Rocks breaking the river surface, with a ring of foam cells around each. */
  createWaterRocks() {
    const { width, height } = this;
    const wreck = activeScene().water.wreck;
    const rocks = (activeScene().water.rocks ?? []).map((rock, index) => {
      const cx = rock.x * width;
      const cy = rock.y * height;
      // Laid on a grid as fine as the water around it.
      const { cellWidth, lineHeight } = this.gridAt(cy);
      const rx = rock.r * Math.min(width, height * 1.6);
      const ry = rx * 0.45;
      const stone = [];
      const foam = [];
      for (let row = Math.floor((cy - ry * 1.6) / lineHeight); row <= Math.ceil((cy + ry * 1.6) / lineHeight); row += 1) {
        const y = (row + 0.52) * lineHeight;
        for (let column = Math.floor((cx - rx * 1.5) / cellWidth); column <= Math.ceil((cx + rx * 1.5) / cellWidth); column += 1) {
          const x = (column + 0.5) * cellWidth;
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          const noise = hash2(column, row, 1200 + index);
          if (d < 1) {
            const top = (y - cy) / ry < -0.3;
            const wet = (y - cy) / ry > 0.45;
            stone.push(x, y, top ? (noise > 0.5 ? "_" : "n") : "#%@&"[Math.floor(noise * 4)], top ? 0xc2bea8 : wet ? 0x3a3f3a : noise > 0.5 ? 0x8a8c80 : 0x63675e);
          } else if (d < 2.6) {
            foam.push({ x, y, noise, downstream: x < cx });
          }
        }
      }
      return { stone, foam };
    });
    if (wreck) rocks.push(this.createWreck());
    if (activeScene().water.jetty) rocks.push(...this.createJetty());
    return rocks;
  }

  /**
   * A rusting river freighter half sunk in the bay, stern under and bow raised:
   * riveted hull plates with seams, a row of portholes weeping rust, patches of
   * its old green paint, weed along the waterline, the hawse hole and its chain,
   * draft marks at the bow; on deck a broken railing, a cargo hatch, the
   * deckhouse and the wheelhouse with their windows gone, a leaning funnel with
   * its faded red band, and a mast with sagging rigging.
   */
  createWreck() {
    const { width, height } = this;
    const ship = wreckShape(width, height);
    const { cx, waterline, half, deck, keel, house, bridge, funnel, funnelFoot, funnelX } = ship;
    const { cellWidth, lineHeight } = this.gridAt(waterline);
    const stone = [];
    const foam = [];
    const rust = [0xb05a2c, 0x8c4422, 0xc8703a, 0x9c5228];
    const snap = (x, y) => [(Math.floor(x / cellWidth) + 0.5) * cellWidth, (Math.floor(y / lineHeight) + 0.52) * lineHeight];
    const put = (x, y, glyph, color) => {
      const [sx, sy] = snap(x, y);
      stone.push(sx, sy, glyph, color);
    };
    const xAt = (u) => cx - half + 2 * half * u;
    const span = Math.round((2 * half) / cellWidth);
    // Seams between the hull plates, rows of rivets, and a few rust streaks under the portholes.
    const seamEvery = 7;
    const porthole = (column) => column % 5 === 2;
    for (let column = 0; column <= span; column += 1) {
      const x = xAt(column / span);
      const u = column / span;
      const deckY = deck(u);
      const bottom = keel(u);
      const streak = porthole(column) && hash2(column, 1, 1704) > 0.45 ? 2 + Math.floor(hash2(column, 2, 1704) * 5) : 0;
      for (let y = deckY, r = 0; y <= bottom; y += lineHeight, r += 1) {
        const noise = hash2(column, r, 1700);
        const fromBottom = (bottom - y) / lineHeight;
        // Patches of the old dark green paint still cling to the plates.
        const paint = hash2(Math.floor(column / 6), Math.floor(r / 3), 1705) < 0.22;
        let glyph;
        let color;
        if (r === 0) {
          // The gunwale, its edge catching the light; the stem rakes forward at the bow.
          glyph = u > 0.96 ? "/" : noise > 0.25 ? "=" : "_";
          color = 0xe0904c;
        } else if (fromBottom < 1) {
          // The waterline: dark slime and weed.
          glyph = noise > 0.55 ? "~" : noise > 0.25 ? "=" : "%";
          color = noise > 0.6 ? 0x5a6a34 : 0x4a3620;
        } else if (fromBottom < 2) {
          glyph = noise > 0.5 ? "%" : "#";
          color = 0x6a4428;
        } else if (r === 1 && porthole(column) && u > 0.06 && u < 0.92) {
          glyph = "o";
          color = 0x140e0a;
        } else if (streak && r > 1 && r <= 1 + streak) {
          // Rust weeps down from the porthole above.
          glyph = r === 1 + streak ? "," : "|";
          color = 0x6a2e14;
        } else if (column % seamEvery === 0) {
          glyph = "|";
          color = 0x6a3418;
        } else if (r % 3 === 0 && column % 2 === 0) {
          glyph = ".";
          color = 0xe09a5c;
        } else if (paint) {
          glyph = noise > 0.5 ? ":" : "=";
          color = noise > 0.4 ? 0x6e8266 : 0x56684e;
        } else {
          glyph = "#%=#&"[Math.floor(noise * 5)];
          // Lower plates sit in shade.
          color = rust[Math.floor(noise * rust.length)] - (fromBottom < 3 ? 0x201008 : 0);
        }
        put(x, y, glyph, color);
      }
      // A broken railing along the foredeck: posts, and the rail where it still holds.
      if (u > 0.42 && u < 0.94) {
        if (column % 4 === 0 && hash2(column, 9, 1701) > 0.2) put(x, deckY - lineHeight, "|", 0xa86030);
        if (hash2(Math.floor(column / 3), 10, 1701) > 0.3) put(x, deckY - lineHeight * 2, column % 4 === 0 ? "+" : "-", 0xb86a38);
      }
    }
    // The hawse hole at the bow, and the anchor chain hanging into the water.
    {
      const u = 0.9;
      const x = xAt(u);
      put(x, deck(u) + lineHeight * 1.2, "@", 0x140e0a);
      for (let y = deck(u) + lineHeight * 2.2; y < waterline + lineHeight * 0.5; y += lineHeight) put(x + cellWidth, y, ":", 0xb0a084);
      // Draft marks, faded white ticks up the stem.
      const mx = xAt(0.95);
      for (let y = keel(0.95) - lineHeight; y > deck(0.95) + lineHeight * 1.5; y -= lineHeight * 2) put(mx, y, "-", 0xd8d0b8);
    }
    // A cargo hatch on the foredeck.
    {
      const [a, b] = [xAt(0.5), xAt(0.66)];
      for (let x = a; x <= b; x += cellWidth) {
        const u = ship.along(x);
        const edge = x === a || x + cellWidth > b;
        put(x, deck(u) - lineHeight, edge ? (x === a ? "[" : "]") : "=", 0x9a5430);
        put(x, deck(u) - lineHeight * 2, "_", 0xc87040);
      }
    }
    // The deckhouse and, on top of it, the wheelhouse: dirty white walls run with rust, the windows dark holes.
    const block = (part, base, rows, { windowRow, wall, roof }) => {
      const [a, b] = [xAt(part.from), xAt(part.to)];
      for (let x = a, c = 0; x <= b; x += cellWidth, c += 1) {
        const u = ship.along(x);
        const edge = x === a || x + cellWidth > b;
        for (let r = 1; r <= rows; r += 1) {
          const y = base(u) - r * lineHeight;
          const noise = hash2(c, r, 1706);
          let glyph;
          let color;
          if (r === rows) {
            glyph = "_";
            color = roof;
          } else if (edge) {
            glyph = "|";
            color = 0x7a7262;
          } else if (r === windowRow && c % 3 !== 0) {
            glyph = noise > 0.3 ? "#" : "o";
            color = 0x120e0c;
          } else if (r < windowRow && hash2(c, 3, 1707) > 0.6) {
            // Rust running down the wall from the window frames.
            glyph = "|";
            color = 0x9a5430;
          } else {
            glyph = noise > 0.55 ? "=" : ":";
            color = noise > 0.25 ? wall : 0x9a9482;
          }
          put(x, y, glyph, color);
        }
      }
      // The roof overhangs a cell at each end.
      put(a - cellWidth, base(part.from) - rows * lineHeight, "_", roof);
      put(b + cellWidth, base(part.to) - rows * lineHeight, "_", roof);
    };
    const houseRows = Math.max(3, Math.round(house.height / lineHeight));
    block(house, deck, houseRows, { windowRow: Math.ceil(houseRows / 2), wall: 0xbab4a0, roof: 0xc07040 });
    const bridgeRows = Math.max(3, Math.round(bridge.height / lineHeight));
    block(bridge, (u) => deck(u) - houseRows * lineHeight, bridgeRows, { windowRow: bridgeRows - 1, wall: 0xcac4b0, roof: 0xc87848 });
    // The funnel, leaning back, black at the top over a faded red band.
    {
      const rows = Math.max(4, Math.round(funnel.height / lineHeight));
      const halfCells = Math.max(1, Math.round(funnel.half / cellWidth));
      for (let r = 0; r < rows; r += 1) {
        const y = funnelFoot - (r + 0.5) * lineHeight;
        const centre = funnelX(y);
        const band = r >= Math.round(rows * 0.55) && r < Math.round(rows * 0.72);
        for (let c = -halfCells; c <= halfCells; c += 1) {
          const edge = Math.abs(c) === halfCells;
          const color = r >= rows - 2 ? 0x4a4038 : band ? 0xd0503a : edge ? 0x7a4020 : rust[(r + c + 8) % rust.length];
          put(centre + c * cellWidth, y, edge ? (c < 0 ? "(" : ")") : r === rows - 1 ? "_" : band ? "=" : "#", color);
        }
      }
    }
    // The mast on the foredeck leaning back toward the stern, with its crosstree and sagging stays.
    {
      const { mast, mastFoot, mastX } = ship;
      const rows = Math.max(4, Math.round(mast.height / lineHeight));
      let tipX = mastX(mastFoot);
      let tipY = mastFoot;
      for (let r = 1; r <= rows; r += 1) {
        tipY = mastFoot - r * lineHeight;
        tipX = mastX(tipY);
        // Two glyphs thick, so the mast holds up against the water behind it.
        put(tipX, tipY, r % 3 === 2 ? "\\" : "|", 0xb88058);
        put(tipX + cellWidth, tipY, "|", 0x7a5030);
        if (r === Math.round(rows * 0.72)) for (let c = -3; c <= 4; c += 1) if (c && c !== 1) put(tipX + c * cellWidth, tipY, "-", 0xa07048);
      }
      // Stays from the masthead down to the stem and back to the wheelhouse roof, dotted and slack.
      const stay = (toX, toY) => {
        const steps = Math.round(Math.hypot(toX - tipX, toY - tipY) / (cellWidth * 1.6));
        for (let i = 1; i < steps; i += 1) {
          const t = i / steps;
          put(tipX + (toX - tipX) * t, tipY + (toY - tipY) * t + Math.sin(t * Math.PI) * lineHeight * 1.2, ".", 0xb0a088);
        }
      };
      stay(xAt(0.99), deck(0.99) - lineHeight);
      stay(xAt(bridge.to), deck(bridge.to) - (houseRows + bridgeRows) * lineHeight);
    }
    // Foam laps along the hull at the waterline.
    for (let x = cx - half - cellWidth * 3; x <= cx + half + cellWidth * 3; x += cellWidth) {
      const [sx, sy] = snap(x, waterline + lineHeight * 0.6);
      foam.push({ x: sx, y: sy, noise: hash2(Math.round(x / cellWidth), 3, 1702), downstream: x < cx });
    }
    if (this.winterIce) return { stone: this.iceOver(stone, waterline, cellWidth, lineHeight, cx, half), foam: [], wreck: true };
    return { stone, foam, wreck: true };
  }

  /**
   * The wreck in winter: snow lying only on what faces up (the gunwale, the
   * roofs, the rail, the funnel's rim), patches of rime over the rust, which
   * still shows through everywhere else, icicles under every overhang above
   * the water, and a collar of ice frozen round the hull at the waterline.
   */
  iceOver(stone, waterline, cellWidth, lineHeight, cx, half) {
    const key = (x, y) => `${Math.round(x / cellWidth)},${Math.round(y / lineHeight)}`;
    const taken = new Set();
    for (let i = 0; i < stone.length; i += 4) taken.add(key(stone[i], stone[i + 1]));
    const rime = (color, amount) => {
      const mixed = (shift, target) => Math.round(((color >> shift) & 255) * (1 - amount) + target * amount);
      return (mixed(16, 0xb8) << 16) | (mixed(8, 0xc8) << 8) | mixed(0, 0xd2);
    };
    const out = [];
    const at = new Map();
    for (let i = 0; i < stone.length; i += 4) {
      const [x, y, glyph, color] = [stone[i], stone[i + 1], stone[i + 2], stone[i + 3]];
      const noise = hash2(Math.round(x / cellWidth), Math.round(y / lineHeight), 1731);
      const top = !taken.has(key(x, y - lineHeight));
      // Snow on what faces up, drifted a row deeper here and there.
      const drift = !top && !taken.has(key(x, y - lineHeight * 2)) && noise > 0.55;
      at.set(key(x, y), out.length);
      if ((top && noise > 0.12) || drift) {
        out.push(x, y, noise > 0.55 ? "=" : noise > 0.3 ? "~" : "_", noise > 0.65 ? 0xe6eef1 : 0xc6d4dc);
      } else if (glyph !== "o" && hash2(Math.floor(x / (cellWidth * 3)), Math.floor(y / (lineHeight * 2)), 1733) < 0.45) {
        // A patch of rime: the rust paled and frosted, not covered.
        out.push(x, y, noise > 0.7 ? "*" : glyph, rime(color, 0.5 + noise * 0.25));
      } else out.push(x, y, glyph, color);
    }
    // Icicles: down the hull from the deck edge and under every overhang, kept above the water.
    const icicles = [];
    for (let i = 0; i < stone.length; i += 4) {
      const [x, y] = [stone[i], stone[i + 1]];
      const column = Math.round(x / cellWidth);
      if (taken.has(key(x, y - lineHeight)) || hash2(column, 7, 1737) < 0.45) continue;
      const length = 1 + Math.floor(hash2(column, 8, 1737) * 3);
      for (let k = 1; k <= length; k += 1) {
        const py = y + k * lineHeight;
        if (py > waterline - lineHeight) break;
        const glyph = k === length ? "'" : "|";
        const index = at.get(key(x, py));
        if (index === undefined) icicles.push(x, py, glyph, 0xd4e6ee);
        else if (out[index + 2] !== "o") {
          out[index + 2] = glyph;
          out[index + 3] = 0xd4e6ee;
        }
      }
    }
    // Ice frozen round the hull, a little wider than the ship.
    for (let x = cx - half - cellWidth * 4; x <= cx + half + cellWidth * 4; x += cellWidth) {
      const noise = hash2(Math.round(x / cellWidth), 5, 1735);
      const y = (Math.floor((waterline + lineHeight * 0.6) / lineHeight) + 0.52) * lineHeight;
      const sx = (Math.floor(x / cellWidth) + 0.5) * cellWidth;
      if (noise > 0.15) out.push(sx, y, noise > 0.6 ? "=" : noise > 0.35 ? "-" : "_", noise > 0.75 ? 0xd6e0e5 : 0xa8bcc6);
    }
    return out.concat(icicles);
  }

  /**
   * The jetty on the far shore, planks over a row of posts, and the rowing
   * boat tied up beside it (the boat bobs: `bob` marks it for fillSurface).
   */
  createJetty() {
    const { width, height } = this;
    const shape = jettyShape(width, height);
    const { cellWidth, lineHeight } = this.gridAt((shape.top + shape.bottom) / 2);
    const snap = (x, y) => [(Math.floor(x / cellWidth) + 0.5) * cellWidth, (Math.floor(y / lineHeight) + 0.52) * lineHeight];
    const deck = [];
    const put = (list, x, y, glyph, color) => {
      const [sx, sy] = snap(x, y);
      list.push(sx, sy, glyph, color);
    };
    for (let y = shape.top + lineHeight * 0.5, r = 0; y <= shape.bottom; y += lineHeight, r += 1) {
      const { left, right } = shape.at(y);
      for (let x = left; x <= right; x += cellWidth) {
        const column = Math.round(x / cellWidth);
        const noise = hash2(column, r, 1901);
        const edge = x === left || x + cellWidth > right;
        put(deck, x, y, edge ? "|" : noise > 0.85 ? "-" : "=", edge ? 0x5a4632 : noise > 0.5 ? 0x9a7a52 : 0x846642);
      }
    }
    // Posts under the near end, standing in the water.
    const end = shape.at(shape.bottom);
    for (let x = end.left; x <= end.right + 1; x += Math.max(cellWidth, (end.right - end.left) / 2)) {
      put(deck, x, shape.bottom + lineHeight, "!", 0x3a2a1c);
    }
    const foam = [];
    for (let x = end.left - cellWidth; x <= end.right + cellWidth; x += cellWidth) {
      const [sx, sy] = snap(x, shape.bottom + lineHeight * 1.6);
      foam.push({ x: sx, y: sy, noise: hash2(Math.round(x / cellWidth), 5, 1903), downstream: true });
    }
    // The boat: a gunwale with its seats, the hull below, a rope to the jetty.
    const boat = [];
    const { x: bx, y: by, half } = shape.boat;
    const cells = Math.max(3, Math.round(half / cellWidth));
    for (let c = -cells; c <= cells; c += 1) {
      const x = bx + c * cellWidth;
      const end = Math.abs(c) === cells;
      put(boat, x, by - lineHeight, end ? (c < 0 ? "\\" : "/") : c % 3 === 0 ? "#" : "=", end ? 0x6a4a30 : c % 3 === 0 ? 0x5a3e28 : 0x9a7048);
      if (Math.abs(c) < cells) put(boat, x, by, Math.abs(c) === cells - 1 ? (c < 0 ? "\\" : "/") : "_", 0x4a3424);
    }
    put(boat, bx - (cells + 1) * cellWidth, by - lineHeight * 1.2, "~", 0x8a7a5a);
    return [{ stone: deck, foam }, { stone: boat, foam: [], bob: true }];
  }

  fillSurface(time, ripples) {
    const batch = this.surfaceBatch;
    batch.clear();

    // River rocks and the foam the current piles against them.
    for (const rock of this.waterRocks) {
      // A moored boat rocks gently on the water.
      const bob = rock.bob ? Math.sin(time * 1.1) * 1.3 : 0;
      for (let i = 0; i < rock.stone.length; i += 4) batch.push(rock.stone[i], rock.stone[i + 1] + bob, rock.stone[i + 2], rock.stone[i + 3]);
      for (const cell of rock.foam) {
        const wave = Math.sin(time * 4 + cell.noise * 30 + cell.x * 0.05);
        if (wave > (cell.downstream ? -0.2 : 0.4)) batch.push(cell.x, cell.y, wave > 0.7 ? "~" : "-", wave > 0.7 ? 0xdde8e4 : 0x9fb8b6);
      }
    }

    // Fast water: flecks of foam race away from the bridge toward the bend.
    if (this.waterParams.flowAway) {
      const { width, height } = this;
      const horizon = this.shorelineY(width / 2);
      const bottom = height * activeScene().foreground.bridge;
      for (let i = 0; i < 70; i += 1) {
        const s = (hash2(i, 1, 811) + time * (0.034 + hash2(i, 2, 811) * 0.026)) % 1;
        const y = bottom - (bottom - horizon) * (1 - (1 - s) ** 2.2);
        const { left, right } = bankWidths(y / height);
        const from = left * width;
        const to = width * (1 - right);
        const x = from + (to - from) * (0.06 + hash2(i, 3, 811) * 0.88) + Math.sin(time * 1.3 + i) * 3;
        const near = 1 - s;
        const fade = Math.min(1, s * 12, (1 - s) * 6);
        if (fade < 0.3) continue;
        const color = near > 0.55 ? 0xdde8e4 : 0xa9c0bd;
        const glyphs = near > 0.6 ? "~~-" : near > 0.3 ? "~-" : "-";
        for (let k = 0; k < glyphs.length; k += 1) batch.push(x + (k - glyphs.length / 2) * this.cellWidth, y, glyphs[k], color);
      }
    }

    for (const pad of this.lilyPads) {
      const bob = Math.sin(time * 0.8 + pad.phase) * 1.2;
      for (const cell of pad.cells) batch.push(cell.x, cell.y + bob, cell.glyph, cell.colorValue);
      for (const petal of pad.flower) batch.push(petal.x, petal.y + bob, petal.glyph, petal.colorValue);
    }

    for (const ripple of ripples) {
      const age = time - ripple.time;
      if (age < 0 || age > 0.75) continue;
      const origin = this.project(ripple.x, ripple.y);
      const size = ripple.size ?? 1;
      for (let i = 0; i < 7; i += 1) {
        const seed = Math.round(ripple.time * 1000) + i * 31;
        const vx = (hash2(seed, 1, 7) - 0.5) * 70 * size;
        const vy = -(55 + hash2(seed, 2, 7) * 70) * Math.sqrt(size);
        const dy = vy * age + 260 * age * age;
        if (dy > 0) continue;
        batch.push(origin.x + vx * age, origin.y + dy, i % 3 === 0 ? "'" : ".", SPRAY_COLOR);
      }
    }

    for (const bird of birdsAt(time, this.width, this.height, currentSeason())) batch.push(bird.x, bird.y, bird.glyph, BIRD_COLOR);
  }

  /**
   * After dark the wreck at Pripyat glows a faint, sickly green: a few of its
   * plates at a time, breathing slowly, and a pale sheen on the water around it.
   */
  fillWreckGlow(time, night) {
    const batch = this.wreckGlowBatch;
    batch.clear();
    const strength = clamp((night - 0.25) / 0.5, 0, 1);
    const wreck = this.waterRocks.find((rock) => rock.wreck);
    if (!wreck || strength < 0.02) return;
    const breath = 0.75 + 0.25 * Math.sin(time * 0.45);
    const { stone } = wreck;
    for (let i = 0, k = 0; i < stone.length; i += 4, k += 1) {
      const pulse = Math.sin(time * (0.5 + hash2(k, 1, 1803) * 0.6) + hash2(k, 2, 1803) * 20);
      if (pulse < -0.3) continue;
      const alpha = Math.round(255 * strength * breath * (0.4 + 0.45 * pulse));
      batch.push(stone[i], stone[i + 1], stone[i + 2], pulse > 0.85 ? 0xb6f08a : 0x6fd060, 0, alpha);
    }
    for (const cell of wreck.foam) {
      const wave = Math.sin(time * 1.1 + cell.noise * 30);
      if (wave > 0.2) batch.push(cell.x, cell.y, wave > 0.8 ? "~" : "-", 0x58b050, 0, Math.round(255 * strength * breath * 0.45 * wave));
    }
  }

  /** Vertical bob of the water surface at a screen point, for things floating on it. */
  surfaceOffset(x, y, time, config, ripples) {
    const plane = this.screenToPlane(x, y);
    const sample = sampleWater({ x: plane.x, y: plane.y }, time, { ...config, ...this.waterParams }, y / this.height, ripples);
    const moved = this.project(sample.x, sample.y);
    return { x: clamp((moved.x - x) * 0.35, -3, 3), y: clamp((moved.y - y) * 0.35, -3, 3) };
  }

  /** Rod from the angler's hands (bottom right) toward the cast; it bends under tension. */
  /**
   * The rod's swing through a cast, as offsets of the tip (in screen fractions)
   * and extra bend: overhead, the rod goes up and back over the shoulder, then
   * whips forward; underhand, it dips toward the water and swings up.
   */
  castSwing(style, t) {
    // [time, tip dx, tip dy, bend]: a slow lift, an easy swing, a long settle.
    // One smooth curve runs through the keys (a monotone cubic), so the rod
    // never stops dead at a key: it only rests at the start and the end.
    const keys = style === "over"
      ? [[0, 0, 0, 0], [0.34, 0.07, -0.35, -0.055], [0.66, -0.02, 0.06, 0.1], [0.84, 0, 0.02, 0.03], [1, 0, 0, 0]]
      : [[0, 0, 0, 0], [0.34, -0.03, 0.145, 0.06], [0.6, 0, -0.07, -0.03], [0.8, 0, -0.01, 0], [1, 0, 0, 0]];
    t = clamp(t, 0, 1);
    let i = 1;
    while (i < keys.length - 1 && t > keys[i][0]) i += 1;
    const k0 = keys[i - 1];
    const k1 = keys[i];
    const span = k1[0] - k0[0];
    const u = (t - k0[0]) / span;
    // Slope at a key: the mean of its neighbours' slopes, flat at a turning point and at both ends.
    const slope = (index, channel) => {
      if (index === 0 || index === keys.length - 1) return 0;
      const before = (keys[index][channel] - keys[index - 1][channel]) / (keys[index][0] - keys[index - 1][0]);
      const after = (keys[index + 1][channel] - keys[index][channel]) / (keys[index + 1][0] - keys[index][0]);
      return before * after <= 0 ? 0 : (before + after) / 2;
    };
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    const [dx, dy, bend] = [1, 2, 3].map((c) => h00 * k0[c] + h10 * span * slope(i - 1, c) + h01 * k1[c] + h11 * span * slope(i, c));
    return { dx, dy, bend };
  }

  rodGeometry(angler) {
    const { height } = this;
    const { left, width } = this.frame;
    const aimX = angler.target ? angler.target.x : left + width * 0.5;
    const base = { x: left + width * 0.66, y: height + 24 };
    const tip = { x: left + width * 0.5 + (aimX - left - width * 0.5) * 0.3, y: height * 0.6 };
    // A willow switch bows even at rest; manufactured rods stay straight.
    const look = ROD_LOOKS[(angler.rodTier ?? 1) - 1];
    let bend = look.reel ? 0.03 : 0.09;
    if (angler.phase === "fight" && angler.fish) {
      const pull = angler.tension * (angler.pulling ? 1 : 0.55);
      tip.x += (angler.fish.x - tip.x) * 0.12 * pull;
      tip.y += height * 0.09 * pull;
      bend += 0.22 * pull;
      // Under a hard pull the tip quivers.
      const quiver = Math.max(0, angler.tension - 0.45) * 1.8;
      tip.x += Math.sin(angler.time * 53) * height * 0.0035 * quiver;
      tip.y += Math.sin(angler.time * 41 + 1) * height * 0.003 * quiver;
    } else if (angler.phase === "bite" || angler.phase === "nibble") {
      tip.y += height * 0.004 * Math.sin(angler.time * 30) * (angler.phase === "bite" ? 1 : 0.4);
    } else if (angler.phase === "casting") {
      const swing = this.castSwing(angler.castStyle, angler.castProgress);
      tip.x += swing.dx * width;
      tip.y += swing.dy * height;
      bend += swing.bend;
    } else if (angler.phase === "retrieving" && angler.pulling) {
      // Reeling the spoon in: the rod leans down and loads a little.
      tip.y += height * 0.03;
      bend += 0.06;
    } else if (angler.phase === "reeling") {
      // Reeling an empty line in: the rod loads a little as it skims, then lifts the rig out.
      const p = angler.reelProgress;
      const skim = Math.min(1, p / angler.reelSkim);
      const lift = p > angler.reelSkim ? (p - angler.reelSkim) / (1 - angler.reelSkim) : 0;
      const load = Math.sin(skim * Math.PI) * (1 - lift);
      tip.y += height * (0.02 * load - 0.07 * Math.sin(lift * Math.PI * 0.5) * (1 - lift * 0.6));
      bend += 0.05 * load;
    }
    // Control point pushed sideways from the shaft makes the curve.
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const control = { x: (base.x + tip.x) / 2 - dy * bend, y: (base.y + tip.y) / 2 + dx * bend };
    return { base, control, tip };
  }

  renderAngler(ctx, angler, phase) {
    const { width, height } = this;
    const rod = this.rodGeometry(angler);
    const size = clamp(this.reedSize * 0.8, 12, 22);

    if (phase === "line") {
      this.floatMark = null;
      // A fresh wake for every fight.
      if (angler.phase !== "fight") this.fishTrail = null;
      // Float or hooked fish at the end of the line.
      let end = null;
      if (angler.phase === "ready" || angler.phase === "landed") {
        end = { x: rod.tip.x, y: rod.tip.y + height * 0.06 };
      } else if (angler.phase === "casting") {
        // The bait hangs from the tip through the swing, then flies off on its own arc:
        // high from an overhead cast, low and flat from an underhand one.
        const t = angler.castProgress;
        const over = angler.castStyle === "over";
        const release = over ? 0.52 : 0.48;
        // On the line the bait trails the tip a moment behind, as a weight would.
        const hanging = (progress) => {
          const tip = this.rodGeometry({ ...angler, castProgress: Math.max(0, progress - 0.05) }).tip;
          return { x: tip.x, y: tip.y + height * 0.04 };
        };
        if (t < release) {
          end = hanging(t);
        } else {
          const from = hanging(release);
          // Eased out: quick off the rod, gently slowing as it drops onto the water.
          const linear = (t - release) / (1 - release);
          const u = 1 - (1 - linear) ** 2;
          const flight = {
            x: from.x + (angler.target.x - from.x) * u,
            y: from.y + (angler.target.y - from.y) * u - Math.sin(u * Math.PI) * height * (over ? 0.3 : 0.08),
          };
          // Just after release the bait still carries the swing's motion, then the flight takes over.
          const follow = hanging(t);
          const w = linear < 0.22 ? (linear / 0.22) ** 2 * (3 - 2 * (linear / 0.22)) : 1;
          end = { x: follow.x + (flight.x - follow.x) * w, y: follow.y + (flight.y - follow.y) * w };
        }
      } else if (angler.phase === "fight") {
        end = angler.fish;
      } else if (angler.phase === "reeling" && angler.reelProgress > angler.reelSkim) {
        // At the bank the rig leaves the water and swings up to hang from the tip.
        const u = (angler.reelProgress - angler.reelSkim) / (1 - angler.reelSkim);
        const s = u * u * (3 - 2 * u);
        const hang = { x: rod.tip.x, y: rod.tip.y + height * 0.04 };
        end = {
          x: angler.target.x + (hang.x - angler.target.x) * s,
          y: angler.target.y + (hang.y - angler.target.y) * s - Math.sin(s * Math.PI) * height * 0.03,
        };
      } else {
        // The float rides the surface plus a slow bob of its own on still water.
        const drift = Math.sin(angler.time * 1.7) * 0.8;
        end = { x: angler.target.x + angler.bob.x, y: angler.target.y + angler.bob.y + angler.float.offset + drift };
      }

      const taut = angler.phase === "fight" ? Math.min(1, angler.tension * 1.6 + (angler.pulling ? 0.4 : 0))
        : (angler.phase === "retrieving" && angler.pulling) || angler.phase === "reeling" ? 0.8 : 0;
      const sag = angler.phase === "casting" ? 0 : (1 - taut) * height * 0.035;
      // Strained near breaking, the line sings: it hums sideways, bright and thin.
      const sing = angler.phase === "fight" ? Math.max(0, angler.tension - 0.7) / 0.3 : 0;
      const hum = Math.sin(angler.time * 90) * 2.5 * sing;
      ctx.beginPath();
      ctx.moveTo(rod.tip.x, rod.tip.y);
      ctx.quadraticCurveTo((rod.tip.x + end.x) / 2 + hum, (rod.tip.y + end.y) / 2 + sag, end.x, end.y);
      ctx.lineWidth = 0.9 + sing * 0.4;
      ctx.strokeStyle = `rgba(${226 + sing * 20}, ${232 + sing * 14}, ${222 + sing * 20}, ${0.32 + taut * 0.3 + sing * 0.2})`;
      ctx.stroke();

      ctx.font = `600 ${size}px ${MONO_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (angler.lure && (angler.phase === "retrieving" || angler.phase === "bite")) {
        if (angler.phase === "bite") {
          // A fish hit the spoon: the water boils where it struck.
          ctx.fillStyle = "#e6efe9";
          for (let i = 0; i < 4; i += 1) {
            const a = angler.time * 9 + i * 1.6;
            ctx.fillText(i % 2 ? "*" : "~", end.x + Math.cos(a) * size * 0.6, end.y + Math.sin(a * 1.4) * size * 0.25);
          }
        } else if (angler.pulling) {
          this.drawLureInWater(ctx, angler, end, size);
        } else if (angler.lureId === "wobbler") {
          // Paused, the wobbler floats up and hangs still just under the surface.
          ctx.fillStyle = "rgba(122, 170, 110, 0.7)";
          ctx.fillText("<=", end.x, end.y);
        } else {
          // Paused, it flutters down out of sight: just a glint.
          ctx.fillStyle = "rgba(200, 214, 210, 0.55)";
          ctx.fillText(".", end.x, end.y);
        }
      } else if (angler.lure && angler.phase !== "fight") {
        this.drawLureInAir(ctx, angler, end, size);
      } else if (angler.phase === "fight" && (angler.snag || angler.junk)) {
        // A snag or an old boot doesn't thrash: the line just goes tight.
      } else if (angler.phase === "fight") {
        // Thrashing water where the fish fights: wider and wilder the bigger the fish.
        const heft = Math.min(1.5, (angler.fishWeight ?? 0) / 8);
        const thrash = (angler.pulling ? 1 : 0.6) * (1 + heft);
        const count = 5 + Math.round(heft * 6);
        for (let i = 0; i < count; i += 1) {
          const a = angler.time * (5 + i) + i * 1.7;
          ctx.fillStyle = i % 2 ? "#cfe0da" : "#8fb3ad";
          ctx.fillText(i % 3 === 2 ? "*" : i % 2 ? "~" : "^", end.x + Math.cos(a) * size * 0.7 * thrash, end.y + Math.sin(a * 1.3) * size * 0.25 * (1 + heft * 0.5));
        }
        // A running fish leaves a wake behind it.
        const trail = (this.fishTrail ??= []);
        if (!trail.length || Math.hypot(trail[0].x - end.x, trail[0].y - end.y) > 4) trail.unshift({ x: end.x, y: end.y });
        if (trail.length > 10) trail.length = 10;
        if (angler.running && (angler.fishWeight ?? 0) >= 1) {
          trail.forEach((point, i) => {
            if (i < 1) return;
            ctx.fillStyle = `rgba(200, 220, 214, ${0.6 - i * 0.055})`;
            ctx.fillText(i % 2 ? "~" : "-", point.x + Math.sin(i * 2.1) * 3, point.y);
          });
        }
        if (angler.distance < 0.25) {
          ctx.fillStyle = "#c9d6c6";
          ctx.fillText("><(((°>", end.x, end.y + size * 0.6);
        }
      } else if (angler.phase !== "bite" && angler.float.sink < 0.95) {
        const sink = angler.float.sink;
        const below = size * 0.45 * sink;
        this.floatMark = { x: end.x, y: end.y, below, sink, size };
        // A plain float all but vanishes in the dark.
        ctx.globalAlpha = clamp(1 - (this.shade ?? 0) * 1.45, 0.12, 1);
        if (sink < 0.55) {
          ctx.fillStyle = "#e8573a";
          ctx.fillText("|", end.x, end.y - size * 0.55 + below);
        }
        if (sink < 0.25) {
          ctx.fillStyle = "#f1e9d8";
          ctx.fillText("o", end.x, end.y + below);
        }
        ctx.globalAlpha = 1;
      }
      return;
    }

    // The rod itself, in front of everything; its look depends on the tier.
    const look = ROD_LOOKS[(angler.rodTier ?? 1) - 1];
    const tier = angler.rodTier ?? 1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(rod.base.x, rod.base.y);
    ctx.quadraticCurveTo(rod.control.x, rod.control.y, rod.tip.x, rod.tip.y);
    ctx.lineWidth = Math.max(2.5, width * (0.0025 + tier * 0.0003));
    ctx.strokeStyle = "#0a110e";
    ctx.stroke();
    ctx.lineWidth = 1 + tier * 0.12;
    ctx.strokeStyle = look.blank;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = `600 ${size}px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const point = (t) => ({
      x: (1 - t) ** 2 * rod.base.x + 2 * (1 - t) * t * rod.control.x + t * t * rod.tip.x,
      y: (1 - t) ** 2 * rod.base.y + 2 * (1 - t) * t * rod.control.y + t * t * rod.tip.y,
    });
    const steps = Math.max(6, Math.round(Math.hypot(rod.tip.x - rod.base.x, rod.tip.y - rod.base.y) / (size * 0.9)));
    const guideEvery = look.guides ? Math.max(2, Math.round(steps / (look.guides + 1))) : Infinity;
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const a = point(t);
      const b = point(t + 1 / steps);
      const slope = (b.x - a.x) / (a.y - b.y);
      let glyph = Math.abs(slope) < 0.25 ? "|" : slope > 0 ? "/" : "\\";
      let color = look.blank;
      if (t < 0.2) {
        glyph = look.reel ? "#" : glyph;
        color = look.handle;
      } else if (t > 0.3 && i % guideEvery === 0) {
        glyph = "o";
        color = "#d8d6c4";
      }
      ctx.fillStyle = color;
      ctx.fillText(glyph, a.x, a.y);
    }
    if (look.reel) {
      const reel = point(0.24);
      ctx.fillStyle = look.reel >= 3 ? "#e2b85e" : "#c6c0ae";
      ctx.fillText(look.reel >= 2 ? "@" : "o", reel.x + size * 0.5, reel.y);
    }
  }

  renderOverlay(time, angler) {
    const ctx = this.overlayContext;
    const dt = clamp(time - (this.overlayTime ?? time), 0, 0.1);
    this.overlayTime = time;
    // Only the slice on screen is ever seen (a phone shows part of a wider canvas).
    ctx.clearRect(this.frame.left, 0, this.frame.width, this.height);
    this.spawnLife(time, dt);
    this.drawBubbles(ctx, time, dt);
    for (const rock of this.rockImages) ctx.drawImage(rock.image, rock.left, rock.top, rock.width, rock.height);
    this.drawDucks(ctx, time, this.ducks);
    if (this.floes?.length) this.drawFloes(ctx);
    if (this.critters) this.drawCritters(ctx, time, this.critters);
    if (angler && !angler.hidden) this.renderAngler(ctx, angler, "line");

    // Reeds are close to the viewer, so they use larger glyphs and sway harder.
    const size = this.reedSize;
    const step = size * 0.92;
    ctx.font = `600 ${size}px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineCap = "round";
    // The reeds swing harder in the wind and bow downwind.
    const wind = this.wind;
    const gust = (0.6 + 0.4 * Math.sin(time * 0.21)) * (0.6 + 1.6 * wind.strength * wind.gust);
    const bow = wind.dir * wind.strength * wind.gust * 0.22;
    const winter = isWinter();
    const spring = !winter && isSpring() && !activeScene().dry;
    const dry = activeScene().dry || winter;
    // The sign stands among the reeds: the farther two thirds behind it, the nearest in front.
    let sign = this.signImage;
    const drawSign = () => {
      ctx.drawImage(sign.image, sign.left, sign.top, sign.width, sign.height);
      sign = null;
    };

    // The first time through in winter, a perch on top of each cattail (moved with it every frame).
    if (winter && !this.reedPerches) {
      this.reedPerches = new Map(this.reeds.filter((reed) => reed.kind === "cattail").map((reed) => [reed, { x: 0, y: 0 }]));
      this.perches.push(...this.reedPerches.values());
    }
    for (const reed of this.reeds) {
      if (sign && reed.depth > 0.66) drawSign();
      const segments = Math.max(2, Math.round(reed.length / step));
      const swing = (Math.sin(time * 0.95 + reed.phase) * 0.65 + Math.sin(time * 0.37 + reed.baseX * 0.01) * 0.35) * gust;
      const at = (t) => ({
        x: reed.baseX + reed.length * (reed.lean * t + reed.curve * t * t + (swing + bow) * reed.flex * t * t),
        y: reed.baseY - reed.length * t,
      });
      // Dry reeds at Pripyat (and everywhere in winter): straw and old brown instead of green;
      // fresh green in spring; frost on the tips in winter.
      const shade = dry ? (reed.depth < 0.5 ? "#4a3b22" : "#3a2e1a") : spring ? (reed.depth < 0.5 ? "#2e4a2c" : "#243a24") : reed.depth < 0.5 ? "#2c3b2c" : "#223024";
      const rim = winter ? (reed.lit ? "#d8d4c0" : "#9a8c68") : dry ? (reed.lit ? "#c9a85e" : "#8c7242") : spring ? (reed.lit ? "#8fb05a" : "#557040") : reed.lit ? "#71804f" : "#46573c";
      const points = Array.from({ length: segments + 1 }, (_, i) => at(i / segments));

      // A solid silhouette hides the water glyphs behind each stalk.
      ctx.beginPath();
      points.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.lineWidth = size * (reed.kind === "grass" ? 0.3 : 0.4);
      ctx.strokeStyle = dry ? "#150f08" : "#0b1410";
      ctx.stroke();
      if (reed.kind === "cattail") {
        const top = at(0.86);
        const bottom = at(0.62);
        const perch = this.reedPerches?.get(reed);
        if (perch) {
          perch.x = top.x;
          perch.y = top.y - size * 0.45;
        }
        ctx.beginPath();
        ctx.moveTo(bottom.x, bottom.y);
        ctx.lineTo(top.x, top.y);
        ctx.lineWidth = size * 0.85;
        ctx.strokeStyle = "#2a1d14";
        ctx.stroke();
      }

      let fill = null;
      for (let i = 0; i < segments; i += 1) {
        const t = i / segments;
        const point = points[i];
        const next = points[i + 1];
        const slope = (next.x - point.x) / (point.y - next.y);
        let glyph = Math.abs(slope) < 0.2 ? "|" : Math.abs(slope) > 2.5 ? "=" : slope > 0 ? "/" : "\\";
        let color = t > 0.45 ? rim : shade;

        if (reed.kind === "cattail" && t > 0.62 && t < 0.86) {
          glyph = "#";
          color = reed.lit ? "#9a7148" : "#6a4c32";
        } else if (i === segments - 1 && reed.kind !== "cattail") {
          glyph = reed.kind === "grass" ? "," : "'";
        }
        // Setting a colour makes the canvas parse it: only when it changes.
        if (color !== fill) {
          ctx.fillStyle = color;
          fill = color;
        }
        ctx.fillText(glyph, point.x, point.y);
      }
    }

    if (sign) drawSign();

    // The oak on our bank, in front of the water and the far shore, and its falling leaves.
    if (this.oak) {
      ctx.drawImage(this.oak.image, this.oak.left, this.oak.top, this.oak.width, this.oak.height);
      this.drawOakLeaves(ctx, time);
    }

    // The railing stands between us and the reeds by the far abutments.
    if (this.bridgeImage) {
      // Only the slice on screen: on a phone the railing image is far wider than the view.
      const { image, top } = this.bridgeImage;
      const { left, width } = this.frame;
      const ratio = image.width / this.width;
      ctx.drawImage(image, left * ratio, 0, width * ratio, image.height, left, top, width, this.height - top);
    }
    if (angler && !angler.hidden) this.renderAngler(ctx, angler, "rod");
    if (this.critters?.finches.length) this.drawFinches(ctx, time, this.critters.finches);
    this.drawParticles(ctx, dt, false);

    // Darken the close-up foreground at dusk and night, only where it's drawn.
    if (this.shade > 0.01) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = `rgba(6, 10, 22, ${this.shade.toFixed(3)})`;
      ctx.fillRect(this.frame.left, 0, this.frame.width, this.height);
      ctx.globalCompositeOperation = "source-over";
    }

    // After the shade, so they shine in the dark: anything glowing, and a falling star.
    this.drawParticles(ctx, dt, true);
    this.drawMeteor(ctx, time, dt);

    // A glowing float shines through the dark: off by day, fading in at dusk, full at night.
    const mark = this.floatMark;
    const glow = clamp((this.shade - 0.2) / 0.25, 0, 1);
    if (angler && !angler.hidden && angler.glowFloat && mark && mark.sink < 0.55 && glow > 0.02) {
      const pulse = 0.75 + 0.25 * Math.sin(time * 3);
      ctx.save();
      ctx.font = `600 ${mark.size}px ${MONO_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = `rgba(170, 255, 140, ${(0.9 * glow).toFixed(3)})`;
      ctx.shadowBlur = (10 + 6 * pulse) * glow;
      ctx.fillStyle = `rgba(214, 255, 160, ${((0.85 + 0.15 * pulse) * glow).toFixed(3)})`;
      ctx.fillText("|", mark.x, mark.y - mark.size * 0.55 + mark.below);
      ctx.restore();
    }
  }

  /** Slanted rain streaks over everything, and drops splashing on the water. */
  fillRain(time, intensity) {
    const batch = this.rainBatch;
    batch.clear();
    if (intensity < 0.02) return;
    const { height } = this;
    // Rain falls only over the visible slice, just as densely.
    const { left, width } = this.frame;
    if (this.winter) {
      // In winter the showers come down as snow: slow flakes, each drifting and swaying on its own.
      const flakes = Math.round(intensity * 520 * (width / this.width));
      for (let i = 0; i < flakes; i += 1) {
        const near = hash2(i, 5, 79);
        const speed = 28 + near * 46;
        const span = height * 1.15;
        const y = ((hash2(i, 2, 79) * span + time * speed) % span) - height * 0.05;
        const sway = Math.sin(time * (0.6 + near) + i) * (6 + near * 10);
        // The wind carries the flakes sideways.
        const x = left + ((((hash2(i, 1, 79) * width + y * (0.04 + 0.6 * this.wind.strength) * this.wind.dir + sway) % width) + width) % width);
        batch.push(x, y, near > 0.75 ? "*" : near > 0.4 ? "+" : ".", near > 0.5 ? 0xf2f6f8 : 0xc4d0d6);
      }
      return;
    }
    const drops = Math.round(intensity * 900 * (width / this.width));
    for (let i = 0; i < drops; i += 1) {
      const speed = 380 + hash2(i, 3, 77) * 220;
      const span = height * 1.2;
      const y = ((hash2(i, 2, 77) * span + time * speed) % span) - height * 0.1;
      // The rain slants with the wind.
      const slant = (0.06 + 0.45 * this.wind.strength) * this.wind.dir;
      const x = left + ((((hash2(i, 1, 77) * width + y * slant) % width) + width) % width);
      batch.push(x, y, hash2(i, 4, 77) > 0.35 && Math.abs(slant) > 0.12 ? (slant > 0 ? "\\" : "/") : "|", 0xa8bcc6);
    }
    const cells = this.waterCells;
    if (!cells.length) return;
    const bucket = Math.floor(time * 8);
    const splashes = Math.round(intensity * 170 * (this.frame.width / this.width));
    for (let i = 0; i < splashes; i += 1) {
      const cell = cells[Math.floor(hash2(i, bucket, 91) * cells.length)];
      batch.push(cell.screenX, cell.screenY, hash2(i, bucket, 13) > 0.6 ? "o" : ".", 0xc8d6dc);
    }
  }

  /**
   * A lightning bolt: a jagged stroke of glyphs from the top of the sky down to
   * the far treeline, with a branch or two, drawn behind the land.
   */
  fillBolt(bolt) {
    const batch = this.boltBatch;
    batch.clear();
    if (!bolt) return;
    const { cellWidth, lineHeight } = this;
    const draw = (column, row, rows, seed, branch) => {
      for (let i = 0; i < rows; i += 1, row += 1) {
        const y = (row + 0.5) * lineHeight;
        const ground = this.treeline[Math.max(0, Math.min(this.treeline.length - 1, column))] ?? this.skyBottom;
        if (y > ground + lineHeight * 0.5) return;
        const roll = hash2(seed, i, 4401);
        const shift = roll < 0.38 ? -1 : roll < 0.76 ? 1 : 0;
        const x = (column + 0.5) * cellWidth;
        const glyph = shift < 0 ? "/" : shift > 0 ? "\\" : "|";
        // A doubled stroke reads as a bright line; a faint blue glow either side.
        if (!branch) {
          batch.push(x - cellWidth, y, ".", 0x7f96d8);
          batch.push(x + cellWidth, y, ".", 0x7f96d8);
          batch.push(x - cellWidth * 0.15, y, glyph, 0xffffff);
        }
        batch.push(x + (branch ? 0 : cellWidth * 0.15), y, glyph, branch ? 0xc4d2ff : 0xffffff);
        column += shift;
        if (!branch && i > 3 && hash2(seed, i, 4402) < 0.07) draw(column + (shift || 1), row + 1, 4 + Math.floor(hash2(seed, i, 4403) * 6), seed * 7 + i, true);
      }
    };
    draw(Math.round((this.frame.left + bolt.x * this.frame.width) / cellWidth), 0, Math.ceil(this.skyBottom / lineHeight), bolt.seed, false);
  }

  /**
   * Ducks on the overlay: larger, outlined glyphs so they read clearly over the
   * water texture, with a fading wake behind each.
   */
  drawDucks(ctx, time, ducks) {
    if (!ducks.length) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const duck of ducks) {
      // Every duck is drawn at the same size, near or far.
      const size = 15;
      ctx.font = `700 ${size}px ${MONO_FONT}`;
      duck.wake.forEach((point, i) => {
        if (i < 2 || i % 2) return;
        ctx.fillStyle = `rgba(190, 210, 206, ${0.55 - i * 0.035})`;
        ctx.fillText(i < 7 ? "~" : "-", point.x, point.y + size * 0.35);
      });
      const bob = Math.sin(time * 2.4 + duck.phase) * 1.2;
      const right = duck.heading > 0;
      const step = size * 0.6;
      const head = right ? ["", "", "_", "(", "o", ">"] : ["<", "o", ")", "_", "", ""];
      const headColors = right ? ["", "", "#7a6a50", "#3f7a4a", "#4f8f5a", "#e2b85e"] : ["#e2b85e", "#4f8f5a", "#3f7a4a", "#7a6a50", "", ""];
      const body = right ? ["\\", "_", "_", "_", "/", ""] : ["", "\\", "_", "_", "_", "/"];
      // A dark hull hides the water glyphs under the bird.
      ctx.beginPath();
      ctx.ellipse(duck.x + (right ? -step * 0.5 : step * 0.5), duck.y + bob + size * 0.05, step * 2.3, size * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#1d1912";
      ctx.fill();
      for (let c = 0; c < 6; c += 1) {
        const x = duck.x + (c - 2.5) * step;
        for (const [glyph, color, y] of [[head[c], headColors[c], duck.y - size * 0.75 + bob], [body[c], "#9a8462", duck.y + bob]]) {
          if (!glyph) continue;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#141109";
          ctx.strokeText(glyph, x, y);
          ctx.fillStyle = color;
          ctx.fillText(glyph, x, y);
        }
      }
    }
    ctx.restore();
  }

  /**
   * Floes drifting on the open water: flat slabs of ice with snow on top,
   * their wet edge showing darker below, smaller and flatter in the distance.
   */
  drawFloes(ctx) {
    ctx.save();
    // Kept to the water: never over a river bank or our own.
    if (!this.waterClip) {
      const { width, height } = this;
      const clip = new Path2D();
      clip.moveTo(0, this.shorelineY(0));
      for (let x = 8; x <= width + 8; x += 8) clip.lineTo(x, this.shorelineY(x));
      for (let y = this.shorelineY(width); y <= height; y += 8) clip.lineTo(width * (1 - bankWidths(y / height).right), y);
      for (let x = width; x >= -8; x -= 8) clip.lineTo(x, Math.min(height, nearBankY(x, height) + this.lineHeight * 0.5));
      for (let y = height; y >= this.shorelineY(0); y -= 8) clip.lineTo(width * bankWidths(y / height).left, y);
      clip.closePath();
      this.waterClip = clip;
    }
    ctx.clip(this.waterClip);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const floe of this.floes) {
      // A slab of glyphs on the water's own grid there: packed snow on top, its wet rim darker below.
      const { cellWidth, lineHeight } = this.gridAt(floe.y);
      ctx.font = `700 ${Math.max(7, lineHeight * 1.15)}px ${MONO_FONT}`;
      for (let row = -Math.ceil(floe.ry / lineHeight); row <= Math.ceil(floe.ry / lineHeight); row += 1) {
        for (let column = -Math.ceil(floe.rx / cellWidth); column <= Math.ceil(floe.rx / cellWidth); column += 1) {
          const x = floe.x + column * cellWidth;
          const y = floe.y + row * lineHeight;
          const dx = (x - floe.x) / floe.rx;
          const dy = (y - floe.y) / floe.ry;
          const noise = hash01(floe.seed * 131 + column * 17 + row * 7);
          const d = dx * dx + dy * dy;
          // A ragged rim, different on every floe.
          if (d > 0.8 + 0.25 * noise) continue;
          const rim = dy > 0.35 && d > 0.3;
          ctx.fillStyle = rim ? "#6f8794" : noise > 0.55 ? "#e8eff2" : noise > 0.2 ? "#c8d5dc" : "#a3b6c0";
          ctx.fillText(rim ? "_" : "#%=&=#"[Math.floor(noise * 6)], x, y);
        }
      }
    }
    ctx.restore();
  }

  /**
   * Small glyphs thrown about: spray, sparks and smoke, snow and leaves shaken
   * off the trees, a bird starting from the woods. Each one: position, speed,
   * gravity, a life, its glyphs (by age, or flapping), a colour, and whether
   * it glows (drawn after the night shade) or not.
   */
  addParticle(particle) {
    const list = (this.particles ??= []);
    list.push({ age: 0, gravity: 0, drag: 0, fade: true, glow: false, size: 12, ...particle });
    if (list.length > 300) list.shift();
  }

  drawParticles(ctx, step, glow) {
    const list = this.particles;
    if (!list?.length) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let font = "";
    for (const p of list) {
      if (p.glow !== glow) continue;
      p.age += step;
      p.vy += p.gravity * step;
      p.vx *= 1 - p.drag * step;
      p.vy *= 1 - p.drag * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      if (p.age >= p.life) continue;
      const k = p.age / p.life;
      const glyph = p.flap ? (Math.sin(p.age * 24 + p.x) > 0 ? "v" : "^") : p.glyphs[Math.min(p.glyphs.length - 1, Math.floor(k * p.glyphs.length))];
      const next = `700 ${Math.round(p.size)}px ${MONO_FONT}`;
      if (next !== font) ctx.font = font = next;
      ctx.globalAlpha = p.fade ? 1 - k * k : 1;
      ctx.fillStyle = p.color;
      ctx.fillText(glyph, p.x, p.y);
    }
    ctx.restore();
    this.particles = list.filter((p) => p.age < p.life);
  }

  /** The float struck: a burst of spray flung up and falling back. */
  splash(x, y, power = 1) {
    const size = clamp(this.reedSize * 0.7, 10, 18);
    for (let i = 0; i < 9 + Math.round(power * 6); i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = (60 + Math.random() * 90) * (0.7 + power * 0.4);
      this.addParticle({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, gravity: 320, life: 0.5 + Math.random() * 0.35, glyphs: ["*", "'", ".", "."], color: Math.random() > 0.4 ? "#e4eeea" : "#a9c6c2", size });
    }
  }

  /**
   * Life about the place, a little at a time: a bird starting up out of the
   * woods now and then by day; and when a gust comes, snow in winter or
   * leaves in autumn shaken off the far trees, and in winter a clump of snow
   * off the oak's twigs.
   */
  spawnLife(time, step) {
    if (!step) return;
    const hour = this.hour ?? 12;
    const wind = this.wind ?? { strength: 0, gust: 1, dir: 1 };
    const trees = this.forestCells ?? [];
    const { left, width } = this.frame;
    const visible = (cell) => cell.x > left && cell.x < left + width;
    const pick = () => {
      for (let i = 0; i < 8; i += 1) {
        const cell = trees[Math.floor(Math.random() * trees.length)];
        if (cell && visible(cell) && cell.y - this.treeline[cell.column] < this.lineHeight * 2.5) return cell;
      }
      return null;
    };
    const small = Math.max(7, this.farCell.height * 1.1);
    // A bird startled out of the woods.
    if (trees.length && hour > 6 && hour < 19 && this.rain < 0.4 && Math.random() < step / 35) {
      const cell = pick();
      if (cell) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.addParticle({ x: cell.x, y: cell.y - this.lineHeight, vx: side * (40 + Math.random() * 40), vy: -(25 + Math.random() * 25), life: 3.5, flap: true, fade: false, color: "#26292c", size: small * 1.2 });
      }
    }
    const gust = wind.strength * wind.gust;
    const season = currentSeason();
    if (gust > 0.4 && trees.length && (season === "winter" || season === "autumn") && Math.random() < step * (gust - 0.4) * 14) {
      const cell = pick();
      if (cell) {
        const winter = season === "winter";
        this.addParticle({
          x: cell.x, y: cell.y, vx: wind.dir * (8 + Math.random() * 14), vy: 8 + Math.random() * 10, life: 1.6 + Math.random(),
          glyphs: winter ? ["*", ".", "."] : [",", "'", "."], color: winter ? "#e8eef1" : Math.random() > 0.5 ? "#d48a32" : "#b85a24", size: small,
        });
      }
    }
    // A clump of snow off the oak.
    const oak = this.oak;
    if (oak?.winter && oak.snowy.length && gust > 0.3 && Math.random() < step * gust * 0.5) {
      const from = oak.snowy[Math.floor(Math.random() * oak.snowy.length)];
      const size = clamp(this.reedSize * 0.8, 11, 20);
      this.addParticle({ x: from.x, y: from.y, vx: wind.dir * 15, vy: 0, gravity: 260, life: 1.6, glyphs: ["@", "*", "*"], color: "#eef3f5", size, fade: false });
      for (let i = 0; i < 5; i += 1) this.addParticle({ x: from.x + (Math.random() - 0.5) * 10, y: from.y, vx: wind.dir * (10 + Math.random() * 20), vy: Math.random() * 20, gravity: 60 + Math.random() * 60, life: 1.8 + Math.random(), glyphs: [".", "'", "."], color: "#dfe7eb", size: size * 0.7 });
    }
  }

  /**
   * Bubbles rising from the bottom: now and then a little chain of them
   * breaks the surface in one place, each swelling and popping. Most at the
   * muddy pond and the reservoir, never on the fast river.
   */
  drawBubbles(ctx, time, step) {
    const rate = activeScene().water.bubbles ?? (activeScene().water.flowAway ? 0 : 0.5);
    if (!rate) return;
    this.bubbleClock = (this.bubbleClock ?? 4) - step;
    const chains = (this.bubbleChains ??= []);
    if (this.bubbleClock <= 0) {
      this.bubbleClock = (8 + Math.random() * 14) / rate;
      const point = this.randomWaterScreen();
      if (!this.onIce(point.x, point.y)) chains.push({ x: point.x, y: point.y, born: time, count: 3 + Math.floor(Math.random() * 4), seed: Math.random() * 100 });
    }
    if (!chains.length) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const chain of chains) {
      const { cellWidth, lineHeight } = this.gridAt(chain.y);
      ctx.font = `700 ${Math.max(6, lineHeight * 0.9)}px ${MONO_FONT}`;
      for (let i = 0; i < chain.count; i += 1) {
        // One after another, a little apart.
        const age = time - chain.born - i * (0.5 + hash01(chain.seed + i) * 0.5);
        if (age < 0 || age > 1.2) continue;
        const x = chain.x + (hash01(chain.seed * 3 + i) - 0.5) * cellWidth * 3;
        const y = chain.y + (hash01(chain.seed * 7 + i) - 0.5) * lineHeight;
        ctx.fillStyle = age > 1 ? "rgba(214, 228, 226, 0.5)" : "rgba(200, 218, 216, 0.85)";
        ctx.fillText(age > 1 ? "*" : age > 0.45 ? "o" : ".", x, y);
        if (age > 1 && !chain[`popped${i}`]) {
          chain[`popped${i}`] = true;
          this.onRipple?.(x, y, 0.12, 0.08);
        }
      }
    }
    ctx.restore();
    this.bubbleChains = chains.filter((chain) => time - chain.born < chain.count * 1.1 + 1.5);
  }

  /**
   * A falling star on a clear night: a bright head and a short fading trail
   * across the upper sky, now and then (in August, the Perseids, far more
   * often). Kept above the treetops.
   */
  drawMeteor(ctx, time, step) {
    const stars = this.starsLevel ?? 0;
    if (!this.meteor && stars > 0.5 && this.rain < 0.15) {
      const often = new Date().getMonth() === 7 ? 10 : 40;
      if (Math.random() < step / often) {
        const { left, width } = this.frame;
        // Where the oak's crown fills the upper left, only out in the open sky, away from it.
        const oak = Boolean(this.oak);
        const dir = oak || Math.random() < 0.5 ? 1 : -1;
        const top = Math.max(20, this.landTop - this.height * 0.08);
        this.meteor = { x: left + width * (oak ? 0.45 + Math.random() * 0.3 : 0.15 + Math.random() * 0.7), y: top * (0.08 + Math.random() * 0.4), vx: dir * (380 + Math.random() * 260), vy: 120 + Math.random() * 120, age: 0, life: 0.55 + Math.random() * 0.4 };
      }
    }
    const meteor = this.meteor;
    if (!meteor) return;
    meteor.age += step;
    if (meteor.age > meteor.life) {
      this.meteor = null;
      return;
    }
    const fade = Math.sqrt(Math.sin((meteor.age / meteor.life) * Math.PI));
    const size = Math.max(12, this.charSize * 1.8);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(size)}px ${MONO_FONT}`;
    const speed = Math.hypot(meteor.vx, meteor.vy);
    const ux = meteor.vx / speed;
    const uy = meteor.vy / speed;
    const glyph = Math.abs(uy / ux) < 0.35 ? "-" : ux * uy > 0 ? "\\" : "/";
    for (let i = 10; i >= 0; i -= 1) {
      const x = meteor.x + meteor.vx * meteor.age - ux * i * size * 0.55;
      const y = meteor.y + meteor.vy * meteor.age - uy * i * size * 0.55;
      if (y > this.landTop) continue;
      ctx.fillStyle = `rgba(236, 242, 255, ${(fade * (1 - i / 11)).toFixed(3)})`;
      ctx.fillText(i ? glyph : "*", x, y);
    }
    ctx.restore();
  }

  /**
   * Bullfinches, in glyphs like the ducks and the heron, each outlined dark
   * so it reads on bark and reeds: a black cap, a grey back, a rose-red
   * breast and a black tail; in flight a blur of wings over the red.
   */
  drawFinches(ctx, time, finches) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const size = clamp(this.reedSize * 0.75, 11, 17);
    ctx.font = `700 ${size}px ${MONO_FONT}`;
    const step = size * 0.55;
    const line = size * 0.8;
    const glyph = (text, x, y, color) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#141109";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    const cap = "#16181a";
    const back = "#9aa3ab";
    const breast = "#f0604c";
    for (const bird of finches) {
      const h = bird.heading;
      const put = (column, row, text, color) => glyph(text, bird.x + column * step * h, bird.y + row * line, color);
      if (bird.flying) {
        const up = Math.sin(time * 26 + bird.phase) > 0;
        put(-1, -0.6, "-", cap);
        put(0, -0.6, "o", breast);
        put(0.9, -0.75, "o", cap);
        put(-0.1, up ? -1.4 : 0.2, up ? "^" : "v", back);
        continue;
      }
      // Perched on the twig; now and then the head dips to peck.
      const bob = bird.peck > 0 ? Math.sin((bird.peck / 0.35) * Math.PI) * 0.3 : 0;
      put(-1.1, -0.35, h > 0 ? "/" : "\\", cap);
      put(-0.1, -1.15, "_", back);
      put(0, -0.5, "@", back);
      put(0.75, -0.45, "@", breast);
      put(0.85, -1.2 + bob, "o", cap);
    }
    ctx.restore();
  }

  /**
   * The heron, the beaver and the dragonflies (see Critters in wildlife.js),
   * drawn in glyphs like the ducks, each with a dark outline so it reads on the water.
   */
  drawCritters(ctx, time, { heron, beaver, flies, bats }) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const glyph = (text, x, y, color, outline = "#141109") => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = outline;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    if (beaver) {
      const size = 14;
      ctx.font = `700 ${size}px ${MONO_FONT}`;
      // A long V of a wake behind the head.
      beaver.wake.forEach((point, i) => {
        if (i < 1) return;
        const spread = i * 3.2;
        ctx.fillStyle = `rgba(190, 210, 206, ${0.5 - i * 0.035})`;
        ctx.fillText(beaver.heading > 0 ? "\\" : "/", point.x, point.y - spread * 0.5);
        ctx.fillText(beaver.heading > 0 ? "/" : "\\", point.x, point.y + spread * 0.5);
      });
      if (!beaver.under) {
        const bob = Math.sin(time * 2) * 0.8;
        glyph(beaver.heading > 0 ? "o" : "o", beaver.x, beaver.y + bob, "#6e4c2e");
        glyph(".", beaver.x + beaver.heading * 6, beaver.y - 3 + bob, "#1a120a", "#6e4c2e");
      }
    }
    if (heron) {
      const size = 19;
      ctx.font = `700 ${size}px ${MONO_FONT}`;
      const step = size * 0.6;
      const line = size * 0.95;
      const right = heron.heading > 0;
      const put = (column, row, text, color) => glyph(text, heron.x + (right ? column : -column) * step, heron.y + row * line, color);
      const grey = "#8e9aa4";
      const dark = "#4e575e";
      const pale = "#d8dcd6";
      const beak = "#d4a640";
      if (heron.state === "stand") {
        // Standing in the shallows; on a stab the neck shoots forward and down to the water.
        const stab = heron.stab > 0 ? Math.sin((1 - heron.stab / 0.7) * Math.PI) : 0;
        put(-1.6, -1.5, right ? "\\" : "/", dark);
        put(-0.7, -1.6, "#", dark);
        put(0.2, -1.6, "#", grey);
        put(1.1, -1.7, right ? ")" : "(", grey);
        put(0, -0.6, "|", dark);
        put(0.3, 0.2, "|", dark);
        if (stab > 0.3) {
          put(1.6, -1.2, right ? "\\" : "/", pale);
          put(2.4, -0.3, "o", pale);
          put(3.2, 0.1, heron.catch > 0 && stab > 0.8 ? "~" : right ? "\\" : "/", beak);
        } else {
          put(1.3, -2.5, right ? "/" : "\\", pale);
          put(1.1, -3.4, "o", pale);
          put(2, -3.4, "=", beak);
          put(2.8, -3.4, "-", beak);
          // A fish caught, wriggling in the beak.
          if (heron.catch > 0) put(3.4, -3.3, Math.sin(time * 18) > 0 ? "<" : "~", "#c8d0c4");
        }
        // Rings round its legs.
        ctx.fillStyle = "rgba(190, 210, 206, 0.45)";
        ctx.fillText("~", heron.x - step * 0.6, heron.y + line * 0.9);
        ctx.fillText("~", heron.x + step * 0.9, heron.y + line * 0.9);
      } else {
        // In flight: neck tucked in, legs trailing, the big wings beating slowly.
        const up = Math.sin(time * 4.2) > 0;
        put(-2.4, 0, "-", dark);
        put(-1.5, 0, "=", grey);
        put(-0.5, 0, "=", grey);
        put(0.5, 0, "o", pale);
        put(1.4, 0, ">", beak);
        if (up) {
          put(-1, -0.9, right ? "\\" : "/", grey);
          put(-0.2, -1.6, right ? "\\" : "/", dark);
          put(-0.6, -0.9, right ? "/" : "\\", grey);
        } else {
          put(-1, 0.9, right ? "/" : "\\", grey);
          put(-0.2, 1.6, right ? "/" : "\\", dark);
        }
      }
    }
    if (bats?.length) {
      // Little dark bats, wings beating fast.
      ctx.font = `700 12px ${MONO_FONT}`;
      for (const bat of bats) {
        const up = Math.sin(time * 30 + bat.phase) > 0;
        ctx.fillStyle = "#16141a";
        ctx.fillText(up ? "\\" : "/", bat.x - 6, bat.y + (up ? -2 : 1));
        ctx.fillText("v", bat.x, bat.y);
        ctx.fillText(up ? "/" : "\\", bat.x + 6, bat.y + (up ? -2 : 1));
      }
    }
    if (flies.length) {
      ctx.font = `700 11px ${MONO_FONT}`;
      for (const fly of flies) {
        // A shimmering blue body and a blur of wings.
        const shimmer = Math.sin(time * 40 + fly.phase) > 0;
        glyph(shimmer ? "+" : "x", fly.x, fly.y, "#9ad6e6", "#10202a");
        glyph("-", fly.x - fly.heading * 6, fly.y + 1, "#3a9ac0", "#10202a");
      }
    }
    ctx.restore();
  }

  render(time, config, ripples = [], angler = null, dayTime = 0.76, env = {}) {
    this.rain = env.rain ?? 0;
    this.winter = isWinter();
    // The wind (see wind.js): how hard it blows, which way, and the gust of the moment.
    this.wind = env.wind ?? { strength: 0.2, dir: 1, gust: 1 };
    if (!this.width || !this.height) return;
    const { width, height, cellWidth, lineHeight } = this;
    const sky = gradeSky(skyAt(dayTime, env.moods));
    // A thin moon lights the water and the clouds less than a full one.
    const moon = env.moon ?? { phase: 0.5, light: 1, waxing: true };
    if (sky.light.kind === "moon") {
      const lit = 0.2 + 0.8 * moon.light;
      sky.light = { ...sky.light, strength: sky.light.strength * lit };
      sky.glow = [...sky.glow.slice(0, 3), sky.glow[3] * lit];
    }

    const stale = this.lightKey === null
      || Math.abs(time - this.lightKey.time) >= LIGHT_INTERVAL
      || Math.abs(dayTime - this.lightKey.day) > 0.01;
    if (stale || this.paletteWater !== config.waterColor) {
      this.lightKey = { time, day: dayTime };
      this.paletteWater = config.waterColor;
      this.refreshLight(sky, config.waterColor);
    }
    this.shade = sky.shade;

    if (this.skyTime === null || time < this.skyTime || time - this.skyTime >= SKY_INTERVAL) {
      this.skyTime = time;
      sampleSky(this.skyCells, time, this.skyBatch, this.starBatch);
    }
    // The sun and moon move every frame, snapped to the character grid.
    this.discBatch.clear();
    if (sky.moon.up && sky.moon.y < 0.52) pushDisc(this.discBatch, this.moonDisc, sky.moon.x * width, sky.moon.y * height, cellWidth, lineHeight, "moon", moon);
    if (sky.sun.up && sky.sun.y < 0.52) pushDisc(this.discBatch, this.sunDisc, sky.sun.x * width, sky.sun.y * height, cellWidth, lineHeight, "sun");
    this.fillForest(time);
    fillAmbient(this.ambient, this.ambientBatches, time, dayTime, this.rain, this.wind);
    // Grass sways slowly, so it is refilled every other frame; the water moves every frame.
    this.frameIndex = (this.frameIndex ?? 0) + 1;
    if (this.frameIndex % 2 === 0 || this.grassStale) fillGrass(this.grass, this.grassBatches, time, dayTime, this.rain, this.wind);
    if (env.night) this.drawNightEvents(env.night, time);
    this.fillWater(time, config, ripples);
    this.grassStale = false;
    this.fillSurface(time, ripples);
    if (this.winterIce) this.moveFloes(time);
    this.fillSteam(time, dayTime);
    this.fillRain(time, this.rain);
    this.fillBolt(env.bolt);
    this.ducks = env.ducks ?? [];
    this.critters = env.critters ?? null;
    this.hour = (dayTime * 24) % 24;
    this.starsLevel = sky.stars;
    setCloudiness(this.rain);

    const backend = this.backend;
    // Rain dims everything under a heavier sky; a lightning flash lights it all up for an instant, bluish.
    const flash = env.flash ?? 0;
    const dim = 1 - 0.32 * this.rain - 0.18 * (env.storm ?? 0);
    const lit = (value, i) => value * dim + flash * (i === 2 ? 0.4 : 0.32);
    const land = sky.land.map(lit);
    const water = sky.water.map(lit);
    backend.begin();
    // The sky is opaque, so it is drawn without blending.
    backend.drawLayer("sky", [dim + flash * 0.4, dim + flash * 0.45, dim * 1.02 + flash * 0.6], [0, this.skyBottom], true);
    if (sky.stars > 0.03) backend.drawGlyphs(this.starBatch, [1, 1, 1, sky.stars]);
    backend.drawGlyphs(this.discBatch);
    backend.drawGlyphs(this.skyBatch, flash ? [1 + flash * 0.5, 1 + flash * 0.5, 1 + flash * 0.7, 1] : undefined, this.skyPerspective);
    backend.drawGlyphs(this.boltBatch);
    backend.drawLayer("land", land, [this.landTop, height]);
    backend.drawGlyphs(this.ambientBatches.ground, land, this.perspective);
    backend.drawGlyphs(this.grassBatches.far, land, this.perspective);
    backend.drawGlyphs(this.forestBatch, land, this.perspective);
    backend.drawGlyphs(this.ambientBatches.haze, land, this.perspective);
    // Cottage windows and dam lamps glow as the light fades.
    if (this.flickerLights?.length) {
      this.lightBatch.clear();
      for (const cell of this.flickerLights) {
        const flicker = 0.8 + 0.2 * (0.6 * Math.sin(time * 7.3 + cell.seed) + 0.4 * Math.sin(time * 13.1 + cell.seed * 2.3));
        this.lightBatch.push(cell.x, cell.y, cell.glyph, cell.colorValue, 0, Math.round(255 * flicker));
      }
    }
    backend.drawGlyphs(this.lightBatch, [1, 1, 1, Math.min(1, 0.12 + sky.stars)]);
    backend.drawGlyphs(this.fineLightBatch, [1, 1, 1, Math.min(1, 0.12 + sky.stars)], this.farPerspective);
    backend.drawGlyphs(this.ambientBatches.glow, undefined, this.perspective);
    backend.drawGlyphs(this.waterBatch, water, this.waterPerspective);
    backend.drawGlyphs(this.glintBatch, undefined, this.waterPerspective);
    backend.drawGlyphs(this.surfaceBatch, water, this.waterPerspective);
    // Pale against the dark water, lit like the land (dim at night).
    if (this.steamBatch.count) backend.drawGlyphs(this.steamBatch, [...land.map((value) => Math.min(1.2, value * 1.25)), 0.85], this.waterPerspective);
    this.fillWreckGlow(time, sky.stars);
    if (this.wreckGlowBatch.count) backend.drawGlyphs(this.wreckGlowBatch, undefined, this.waterPerspective);
    backend.drawGlyphs(this.grassBatches.near, land, this.perspective);
    backend.drawGlyphs(this.grassBatches.flies);
    if (this.rain > 0.02) backend.drawGlyphs(this.rainBatch, [1.15, 1.15, 1.15, 0.4 + 0.5 * this.rain]);
    this.renderOverlay(time, angler);
  }
}
