import { sampleWater } from "./water-engine.js";
import { createForestGlyphs } from "./forest-engine.js";
import { activeScene, bankWidths, isOpenWater, nearBankY, setScene, shorelineY, sunPosition, view, wreckShape } from "./scene.js";
import { skyAt, toHex, toInt } from "./daycycle.js";
import { clamp, hash2, hexToInt, mixColor } from "./noise.js";
import { createBankGlyphs, createRidgeGlyphs, createShoreGlyphs, createStructures, ridgeTop } from "./landscape-engine.js";
import { birdsAt, createSkyCells, discOffsets, lightSky, pushDisc, sampleSky, setCloudColors, setCloudiness } from "./sky-engine.js";
import { createLilyPads, createReeds, createRocks, rockGlyphs } from "./foreground-engine.js";
import { GlyphBatch, createBackend } from "./glyph-backend.js";
import { createAmbient, fillAmbient } from "./ambient-engine.js";
import { gradeHex, gradeInt, gradeRgb, gradeSky, isAutumn } from "./theme.js";
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
const BIRD_COLOR = hexToInt("#1f272b");
// Clouds and stars drift slowly enough to resample a few times per second;
// everything else animates on every frame.
const SKY_INTERVAL = 1 / 15;
// Lighting (sky texture, water palette, glint path) refreshes this often;
// colours drift so slowly that the steps are invisible.
const LIGHT_INTERVAL = 0.25;
const SKY_SCALE = 0.25;

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
    // Moving bits of the far landscape (wind in grass, smoke, mist) and lights that blink.
    this.ambientBatches = { ground: new GlyphBatch(), haze: new GlyphBatch(), glow: new GlyphBatch() };
    this.rainBatch = new GlyphBatch();
    // Grass blades behind the bank trees, on the bank we stand on, and fireflies.
    this.grassBatches = { far: new GlyphBatch(16384), near: new GlyphBatch(16384), flies: new GlyphBatch() };
    this.ducks = [];
    this.glintBatch = new GlyphBatch();
    this.lightKey = null;
    this.forestBatch = new GlyphBatch();
    this.waterBatch = new GlyphBatch(32768);
    this.surfaceBatch = new GlyphBatch();
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
    this.backend.resize(width, height, this.pixelRatio);

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
    const { left, width } = this.frame;
    const horizon = this.shorelineY(left + width / 2);
    let x = left + width / 2;
    let y = horizon + (this.height - horizon) * 0.4;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const px = left + width * (0.12 + random() * 0.76);
      const py = horizon + (this.height - horizon) * (0.12 + random() * 0.55);
      if (isOpenWater(px, py, this.width, this.height)) {
        x = px;
        y = py;
        break;
      }
    }
    return this.screenToPlane(x, y);
  }

  isOpenWater(x, y) {
    return isOpenWater(x, y, this.width, this.height);
  }

  /**
   * Open water a duck can sit on: not under the crowns of the trees that lean
   * out from the river banks, anywhere along its body or its head.
   */
  isDuckWater(x, y) {
    if (!this.isOpenWater(x, y)) return false;
    const { canopy, columns, rows, cellWidth, lineHeight } = this;
    return [[-36, 0], [0, 0], [36, 0], [0, -16]].every(([dx, dy]) => {
      const column = Math.floor((x + dx) / cellWidth);
      const row = Math.floor((y + dy) / lineHeight);
      return column < 0 || row < 0 || column >= columns || row >= rows || !canopy[row * columns + column];
    });
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

    this.lilyPads = createLilyPads(width, height, cellWidth, lineHeight, this.frame);
    for (const pad of this.lilyPads) {
      for (const cell of [...pad.cells, ...pad.flower]) cell.colorValue = hexToInt(gradeHex(cell.color));
    }
    const covered = new Set();
    for (const pad of this.lilyPads) for (const cell of pad.cells) covered.add(cell.row * columns + cell.column);

    const scene = activeScene();
    const meanHorizon = height * scene.horizon;
    this.waterCells = [];
    for (let row = 0; row < rows; row += 1) {
      const screenY = (row + 0.52) * lineHeight;
      const band = Math.min(WATER_BANDS - 1, Math.floor(clamp((screenY - meanHorizon) / (height - meanHorizon), 0, 1) ** 0.75 * WATER_BANDS));
      for (let column = 0; column < columns; column += 1) {
        const screenX = (column + 0.5) * cellWidth;
        const shore = this.shorelineY(screenX);
        if (screenY < shore + lineHeight * 0.35) continue;
        if (covered.has(row * columns + column)) continue;
        if (!isOpenWater(screenX, screenY, width, height)) continue;
        const plane = this.screenToPlane(screenX, screenY);
        const distance = (screenY - shore) / (height - shore);
        this.waterCells.push({
          x: plane.x,
          y: plane.y,
          screenX,
          screenY,
          shore,
          depth: screenY / height,
          distance,
          band,
          noise: hash2(column, row, 61),
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
    this.skyCells = createSkyCells(width, height, cellWidth, lineHeight);
    this.sunDisc = discOffsets(this.sun.radius, cellWidth, lineHeight);
    this.moonDisc = discOffsets(this.sun.radius * 0.8, cellWidth, lineHeight);
    this.ridgeCells = createRidgeGlyphs(width, height, cellWidth, lineHeight);
    this.forestCells = createForestGlyphs(width, height, cellWidth, lineHeight, this.sun.x);
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
    this.shoreCells = createShoreGlyphs(width, height, cellWidth, lineHeight, this.sun.x);
    const structures = createStructures(width, height, cellWidth, lineHeight);
    this.structureCells = structures.cells;
    this.structureShapes = structures.shapes;
    this.lightBatch.clear();
    for (const cell of structures.lights) this.lightBatch.push(cell.x, cell.y, cell.glyph, hexToInt(cell.color));
    this.bankCells = createBankGlyphs(width, height, cellWidth, lineHeight, this.sun.x);
    this.grassStale = true;
    this.grass = createGrass({ width, height, cellWidth, lineHeight, frame: this.frame, autumn: isAutumn(), trees: this.trees });
    this.ambient = createAmbient({
      // Plain grass on the banks is drawn as blades; the scrub along the water stays glyphs.
      scene, structures, ridgeCells: this.ridgeCells, bankCells: this.bankCells.filter((cell) => !cell.plain),
      width, height, cellWidth, lineHeight, shorelineY: (x) => this.shorelineY(x),
    });
    for (const cell of [...this.ambient.breeze, ...this.ambient.leaves]) cell.colorValue = gradeInt(cell.colorValue);
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
    this.backend.setFont(this.font, Number(config.charSize));
    this.backend.setLayer("land", this.createLayer((ctx) => this.paintLand(ctx)));
    this.lightKey = null;
    this.rockImages = this.rocks.map((rock) => this.createRockImage(rock));
    this.bridgeImage = scene.foreground.bridge ? this.createBridgeImage(scene.foreground.bridge) : null;
    this.signImage = scene.foreground.sign ? this.createSignImage(scene.foreground.sign) : null;
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
    // Bank trees stand on the near banks, not the far shore, so the water doesn't mirror them.
    for (const cell of this.forestCells) if (!cell.bank) put(cell, cell.color);
    for (const cell of this.structureCells) put(cell, cell.color);
    for (const cell of this.shoreCells) put(cell, "#2a3128");
    this.paletteKey = "";
  }

  updatePalette(rawWater, sky) {
    const waterColor = gradeHex(rawWater);
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

  /** Rasterize a static, full-screen layer once per rebuild. */
  createLayer(paint) {
    const layer = document.createElement("canvas");
    layer.width = Math.round(this.width * this.pixelRatio);
    layer.height = Math.round(this.height * this.pixelRatio);
    const ctx = layer.getContext("2d");
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    paint(ctx);
    {
      // Grade the whole painted layer once: hills, banks, buildings, cliffs, water body.
      const image = ctx.getImageData(0, 0, layer.width, layer.height);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const [r, g, b] = gradeRgb([data[i], data[i + 1], data[i + 2]]);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
      ctx.putImageData(image, 0, 0);
    }
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
    const deep = scene.water.body ?? DEEP_WATER;
    ctx.fillStyle = deep;
    ctx.fill();
    {
      // A coarse map of the shallows, smoothed as it is stretched over the water.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(mixColor(deep, this.waterColor ?? "#3f7f86", 0.3).slice(i, i + 2), 16));
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
          image.data[i + 3] = Math.round(255 * this.shallowAt(((column + 0.5) * width) / map.width, ((row + 0.5) * height) / map.height));
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
        // Flat palette blocks, one per glyph cell, clipped to the ridgeline.
        ctx.save();
        ctx.clip();
        for (const cell of this.ridgeCells) {
          if (cell.ridge !== index) continue;
          ctx.fillStyle = cell.fill;
          ctx.fillRect(cell.x - this.cellWidth / 2, cell.y - this.lineHeight / 2, this.cellWidth + 0.5, this.lineHeight + 0.5);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = ridge.fill;
        ctx.fill();
      }

      ctx.fillStyle = ridge.glyph;
      for (const cell of this.ridgeCells) {
        // Breezy meadows are drawn every frame by the ambient layer instead.
        if (cell.ridge !== index || !cell.glyph || this.ambient.breezyRidges.has(index)) continue;
        if (ridge.alpine) ctx.fillStyle = cell.color;
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

    // A dark canopy silhouette keeps the forest legible against the hazy hills.
    ctx.fillStyle = "#111a14";
    ctx.beginPath();
    if (scene.forest.silhouette === "crowns") {
      // Scattered trees: back each glyph with a soft blob so crowns keep their own shape.
      const radius = Math.max(this.cellWidth, this.lineHeight) * 0.62;
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
    for (const shape of this.structureShapes) {
      ctx.beginPath();
      shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = shape.color;
      ctx.fill();
    }
    for (const cell of this.structureCells) {
      // Rustling leaves are drawn every frame by the ambient layer.
      if (cell.rustle) continue;
      ctx.fillStyle = cell.color;
      ctx.fillText(cell.glyph, cell.x, cell.y);
    }

    for (const cell of this.shoreCells) {
      ctx.fillStyle = cell.color;
      ctx.fillText(cell.glyph, cell.x, cell.y);
    }

    const mist = ctx.createLinearGradient(0, horizon - height * 0.035, 0, horizon + height * 0.02);
    mist.addColorStop(0, "rgba(190, 176, 150, 0)");
    mist.addColorStop(0.65, "rgba(190, 176, 150, 0.11)");
    mist.addColorStop(1, "rgba(190, 176, 150, 0)");
    ctx.fillStyle = mist;
    ctx.fillRect(0, horizon - height * 0.035, width, height * 0.055);

    this.paintWaterBody(ctx);

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
        ctx.fillStyle = step ? `rgba(20, 34, 26, ${0.16})` : "#14221a";
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
        ctx.fillStyle = cliff ? "#121614" : "#111c14";
        ctx.fill();
      }
      if (!this.ambient.grassBanks) {
        for (const cell of this.bankCells) {
          ctx.fillStyle = cell.color;
          ctx.fillText(cell.glyph, cell.x, cell.y);
        }
      }
      // Trees on the banks get a dark backing that follows their own leaves, so they stand out from the grass.
      ctx.fillStyle = "#0c140e";
      for (const cell of this.forestCells) {
        if (cell.bank) ctx.fillRect(cell.x - this.cellWidth * 0.6, cell.y - this.lineHeight * 0.6, this.cellWidth * 1.2, this.lineHeight * 1.2);
      }
    }
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
    const footX = this.frame.left + this.frame.width * fx;
    const footY = height + lineHeight;
    const post = height * 0.3;
    const side = size * 0.08;
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
    // Dull ochre paint under the glyphs, inside the dark rim.
    ctx.beginPath();
    ctx.moveTo(0, apex + lineHeight * 0.2);
    ctx.lineTo(halfAt(foot) - cellWidth * 0.3, foot - lineHeight * 0.3);
    ctx.lineTo(-halfAt(foot) + cellWidth * 0.3, foot - lineHeight * 0.3);
    ctx.closePath();
    ctx.fillStyle = "#7a5e1a";
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
          glyph = "#=:#"[Math.floor(noise * 4)];
          color = noise > 0.7 ? "#d8b445" : "#b8922e";
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
    for (const cell of this.forestCells) {
      const sway = Math.sin(time * 0.42 + cell.swayPhase) * cell.swayAmount;
      batch.push(cell.x + sway, cell.y, cell.glyph, cell.colorValue);
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

    for (const cell of this.waterCells) {
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
        const wobble = Math.sin(cell.row * 0.83 + wobbleTime) * cellWidth * 0.7 * (0.25 + cell.distance * 4) * amplitudeScale;
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
  /** Rocks breaking the river surface, with a ring of foam cells around each. */
  createWaterRocks() {
    const { width, height, cellWidth, lineHeight } = this;
    const wreck = activeScene().water.wreck;
    const rocks = (activeScene().water.rocks ?? []).map((rock, index) => {
      const cx = rock.x * width;
      const cy = rock.y * height;
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
    return rocks;
  }

  /**
   * A rusting ship half sunk in the bay, listing, stern under and bow raised:
   * a streaked hull with rivets, a wheelhouse with its windows gone, a leaning
   * mast and bits of railing, with foam lapping along the waterline.
   */
  createWreck() {
    const { width, height, cellWidth, lineHeight } = this;
    const ship = wreckShape(width, height);
    const { cx, waterline, half, deck, keel, house } = ship;
    const stone = [];
    const foam = [];
    const rust = [0x8c4826, 0x6c361c, 0xa65a30, 0x7c4224];
    const snap = (x, y) => [(Math.floor(x / cellWidth) + 0.5) * cellWidth, (Math.floor(y / lineHeight) + 0.52) * lineHeight];
    const put = (x, y, glyph, color) => {
      const [sx, sy] = snap(x, y);
      stone.push(sx, sy, glyph, color);
    };
    for (let x = cx - half; x <= cx + half; x += cellWidth) {
      const u = ship.along(x);
      const column = Math.round(x / cellWidth);
      const top = deck(u);
      const bottom = keel(u);
      for (let y = top, r = 0; y <= bottom; y += lineHeight, r += 1) {
        const noise = hash2(column, r, 1700);
        let glyph;
        let color;
        if (r === 0) {
          glyph = u > 0.92 ? "/" : noise > 0.3 ? "_" : "=";
          color = 0xb0663a;
        } else if (bottom - y < lineHeight) {
          // The waterline: dark and slimy.
          glyph = noise > 0.5 ? "=" : "~";
          color = 0x3a2a1c;
        } else {
          glyph = r === 1 && column % 3 === 0 ? "o" : "#%=#"[Math.floor(noise * 4)];
          // Rust streaks run down the plates.
          color = column % 5 === 0 ? 0x9c5530 : rust[Math.floor(noise * rust.length)];
        }
        put(x, y, glyph, color);
      }
      // Bits of railing still standing along the deck.
      if (u > 0.5 && u < 0.9 && column % 3 === 0 && hash2(column, 9, 1701) > 0.35) put(x, top - lineHeight, "'", 0x8a4a28);
    }
    // The wheelhouse, toward the sunk stern, its windows dark holes.
    const houseRows = Math.max(2, Math.round(house.height / lineHeight));
    for (let x = cx - half + 2 * half * house.from; x <= cx - half + 2 * half * house.to; x += cellWidth) {
      const u = ship.along(x);
      const edge = u - house.from < 0.02 || house.to - u < 0.02;
      for (let r = 1; r <= houseRows; r += 1) {
        const y = deck(u) - r * lineHeight;
        const roof = r === houseRows;
        const window = r === houseRows - 1 && !edge && Math.round(x / cellWidth) % 2 === 0;
        put(x, y, roof ? "_" : edge ? "|" : window ? "o" : "#", roof ? 0xa25a32 : window ? 0x1c1612 : rust[(r + Math.round(x / cellWidth)) % rust.length]);
      }
    }
    // A mast leaning back toward the stern, with its crosstree.
    {
      const u = 0.62;
      const footX = cx - half + 2 * half * u;
      const foot = deck(u) - lineHeight;
      const rows = Math.max(3, Math.round((ship.size * 0.07) / lineHeight));
      for (let r = 0; r < rows; r += 1) {
        const x = footX - r * cellWidth * 0.45;
        put(x, foot - r * lineHeight, "\\", 0x4a2e1e);
        if (r === Math.round(rows * 0.7)) for (let c = -2; c <= 2; c += 1) if (c) put(x + c * cellWidth, foot - r * lineHeight, "-", 0x4a2e1e);
      }
    }
    // Foam laps along the hull at the waterline.
    for (let x = cx - half - cellWidth * 3; x <= cx + half + cellWidth * 3; x += cellWidth) {
      const [sx, sy] = snap(x, waterline + lineHeight * 0.6);
      foam.push({ x: sx, y: sy, noise: hash2(Math.round(x / cellWidth), 3, 1702), downstream: x < cx });
    }
    return { stone, foam, wreck: true };
  }

  fillSurface(time, ripples) {
    const batch = this.surfaceBatch;
    batch.clear();

    // River rocks and the foam the current piles against them.
    for (const rock of this.waterRocks) {
      for (let i = 0; i < rock.stone.length; i += 4) batch.push(rock.stone[i], rock.stone[i + 1], rock.stone[i + 2], rock.stone[i + 3]);
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

    for (const bird of birdsAt(time, this.width, this.height)) batch.push(bird.x, bird.y, bird.glyph, BIRD_COLOR);
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
    const keys = style === "over"
      ? [[0, 0, 0, 0], [0.3, 0.08, -0.36, -0.05], [0.4, 0.06, -0.33, -0.06], [0.66, -0.02, 0.06, 0.1], [0.84, 0, 0.02, 0.03], [1, 0, 0, 0]]
      : [[0, 0, 0, 0], [0.3, -0.03, 0.14, 0.06], [0.4, -0.03, 0.15, 0.06], [0.6, 0, -0.07, -0.03], [0.8, 0, -0.01, 0], [1, 0, 0, 0]];
    let i = 1;
    while (i < keys.length - 1 && t > keys[i][0]) i += 1;
    const [t0, ...a] = keys[i - 1];
    const [t1, ...b] = keys[i];
    const u = clamp((t - t0) / (t1 - t0), 0, 1);
    const s = u * u * (3 - 2 * u);
    const [dx, dy, bend] = a.map((value, k) => value + (b[k] - value) * s);
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
        if (t < release) {
          end = { x: rod.tip.x, y: rod.tip.y + height * 0.04 };
        } else {
          const from = this.rodGeometry({ ...angler, castProgress: release }).tip;
          // Eased out: quick off the rod, gently slowing as it drops onto the water.
          const linear = (t - release) / (1 - release);
          const u = 1 - (1 - linear) ** 2;
          end = {
            x: from.x + (angler.target.x - from.x) * u,
            y: from.y + height * 0.04 + (angler.target.y - from.y - height * 0.04) * u - Math.sin(u * Math.PI) * height * (over ? 0.3 : 0.08),
          };
        }
      } else if (angler.phase === "fight") {
        end = angler.fish;
      } else {
        // The float rides the surface plus a slow bob of its own on still water.
        const drift = Math.sin(angler.time * 1.7) * 0.8;
        end = { x: angler.target.x + angler.bob.x, y: angler.target.y + angler.bob.y + angler.float.offset + drift };
      }

      const taut = angler.phase === "fight" ? Math.min(1, angler.tension * 1.6 + (angler.pulling ? 0.4 : 0))
        : angler.phase === "retrieving" && angler.pulling ? 0.8 : 0;
      const sag = angler.phase === "casting" ? 0 : (1 - taut) * height * 0.035;
      ctx.beginPath();
      ctx.moveTo(rod.tip.x, rod.tip.y);
      ctx.quadraticCurveTo((rod.tip.x + end.x) / 2, (rod.tip.y + end.y) / 2 + sag, end.x, end.y);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = `rgba(226, 232, 222, ${0.32 + taut * 0.3})`;
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
          // The spoon flashes as it wobbles through the water, a little wake behind it.
          ctx.fillStyle = Math.sin(angler.time * 26) > 0 ? "#eef2ec" : "#9fb0ae";
          ctx.fillText("o", end.x, end.y);
          ctx.fillStyle = "rgba(200, 220, 214, 0.6)";
          ctx.fillText("~", end.x, end.y - size * 0.55);
        } else {
          // Paused, it flutters down out of sight: just a glint.
          ctx.fillStyle = "rgba(200, 214, 210, 0.55)";
          ctx.fillText(".", end.x, end.y);
        }
      } else if (angler.phase === "fight" && (angler.snag || angler.junk)) {
        // A snag or an old boot doesn't thrash: the line just goes tight.
      } else if (angler.phase === "fight") {
        // Thrashing water where the fish fights.
        const thrash = angler.pulling ? 1 : 0.6;
        for (let i = 0; i < 5; i += 1) {
          const a = angler.time * (5 + i) + i * 1.7;
          ctx.fillStyle = i % 2 ? "#cfe0da" : "#8fb3ad";
          ctx.fillText(i % 2 ? "~" : "^", end.x + Math.cos(a) * size * 0.7 * thrash, end.y + Math.sin(a * 1.3) * size * 0.25);
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
    ctx.clearRect(0, 0, this.width, this.height);
    for (const rock of this.rockImages) ctx.drawImage(rock.image, rock.left, rock.top, rock.width, rock.height);
    const sign = this.signImage;
    if (sign) ctx.drawImage(sign.image, sign.left, sign.top, sign.width, sign.height);
    this.drawDucks(ctx, time, this.ducks);
    if (angler && !angler.hidden) this.renderAngler(ctx, angler, "line");

    // Reeds are close to the viewer, so they use larger glyphs and sway harder.
    const size = this.reedSize;
    const step = size * 0.92;
    ctx.font = `600 ${size}px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineCap = "round";
    const gust = 0.6 + 0.4 * Math.sin(time * 0.21);
    const dry = activeScene().dry;

    for (const reed of this.reeds) {
      const segments = Math.max(2, Math.round(reed.length / step));
      const swing = (Math.sin(time * 0.95 + reed.phase) * 0.65 + Math.sin(time * 0.37 + reed.baseX * 0.01) * 0.35) * gust;
      const at = (t) => ({
        x: reed.baseX + reed.length * (reed.lean * t + reed.curve * t * t + swing * reed.flex * t * t),
        y: reed.baseY - reed.length * t,
      });
      // Dry reeds at Pripyat: straw and old brown instead of green.
      const shade = dry ? (reed.depth < 0.5 ? "#4a3b22" : "#3a2e1a") : reed.depth < 0.5 ? "#2c3b2c" : "#223024";
      const rim = dry ? (reed.lit ? "#c9a85e" : "#8c7242") : reed.lit ? "#71804f" : "#46573c";
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
        ctx.beginPath();
        ctx.moveTo(bottom.x, bottom.y);
        ctx.lineTo(top.x, top.y);
        ctx.lineWidth = size * 0.85;
        ctx.strokeStyle = "#2a1d14";
        ctx.stroke();
      }

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
        ctx.fillStyle = color;
        ctx.fillText(glyph, point.x, point.y);
      }
    }

    // The railing stands between us and the reeds by the far abutments.
    if (this.bridgeImage) ctx.drawImage(this.bridgeImage.image, 0, this.bridgeImage.top, this.width, this.height - this.bridgeImage.top);
    if (angler && !angler.hidden) this.renderAngler(ctx, angler, "rod");

    // Darken the close-up foreground at dusk and night, only where it's drawn.
    if (this.shade > 0.01) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = `rgba(6, 10, 22, ${this.shade.toFixed(3)})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalCompositeOperation = "source-over";
    }

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
    const { width, height } = this;
    const drops = Math.round(intensity * 900);
    for (let i = 0; i < drops; i += 1) {
      const speed = 380 + hash2(i, 3, 77) * 220;
      const span = height * 1.2;
      const y = ((hash2(i, 2, 77) * span + time * speed) % span) - height * 0.1;
      const x = (((hash2(i, 1, 77) * width + y * 0.2) % width) + width) % width;
      batch.push(x, y, hash2(i, 4, 77) > 0.35 ? "\\" : "|", 0xa8bcc6);
    }
    const cells = this.waterCells;
    if (!cells.length) return;
    const bucket = Math.floor(time * 8);
    const splashes = Math.round(intensity * 170);
    for (let i = 0; i < splashes; i += 1) {
      const cell = cells[Math.floor(hash2(i, bucket, 91) * cells.length)];
      batch.push(cell.screenX, cell.screenY, hash2(i, bucket, 13) > 0.6 ? "o" : ".", 0xc8d6dc);
    }
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

  render(time, config, ripples = [], angler = null, dayTime = 0.76, env = {}) {
    this.rain = env.rain ?? 0;
    if (!this.width || !this.height) return;
    const { width, height, cellWidth, lineHeight } = this;
    const sky = gradeSky(skyAt(dayTime));

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
    if (sky.moon.up && sky.moon.y < 0.52) pushDisc(this.discBatch, this.moonDisc, sky.moon.x * width, sky.moon.y * height, cellWidth, lineHeight, "moon");
    if (sky.sun.up && sky.sun.y < 0.52) pushDisc(this.discBatch, this.sunDisc, sky.sun.x * width, sky.sun.y * height, cellWidth, lineHeight, "sun");
    this.fillForest(time);
    fillAmbient(this.ambient, this.ambientBatches, time, dayTime, this.rain);
    // Grass sways slowly, so it is refilled every other frame; the water moves every frame.
    this.frameIndex = (this.frameIndex ?? 0) + 1;
    if (this.frameIndex % 2 === 0 || this.grassStale) fillGrass(this.grass, this.grassBatches, time, dayTime, this.rain);
    if (env.night) this.drawNightEvents(env.night, time);
    this.fillWater(time, config, ripples);
    this.grassStale = false;
    this.fillSurface(time, ripples);
    this.fillRain(time, this.rain);
    this.ducks = env.ducks ?? [];
    setCloudiness(this.rain);

    const backend = this.backend;
    // Rain dims everything under a heavier sky.
    const dim = 1 - 0.32 * this.rain;
    const land = sky.land.map((value) => value * dim);
    const water = sky.water.map((value) => value * dim);
    backend.begin();
    // The sky is opaque, so it is drawn without blending.
    backend.drawLayer("sky", [dim, dim, dim * 1.02], [0, this.skyBottom], true);
    if (sky.stars > 0.03) backend.drawGlyphs(this.starBatch, [1, 1, 1, sky.stars]);
    backend.drawGlyphs(this.discBatch);
    backend.drawGlyphs(this.skyBatch);
    backend.drawLayer("land", land, [this.landTop, height]);
    backend.drawGlyphs(this.ambientBatches.ground, land);
    backend.drawGlyphs(this.grassBatches.far, land);
    backend.drawGlyphs(this.forestBatch, land);
    backend.drawGlyphs(this.ambientBatches.haze, land);
    // Cottage windows and dam lamps glow as the light fades.
    backend.drawGlyphs(this.lightBatch, [1, 1, 1, Math.min(1, 0.12 + sky.stars)]);
    backend.drawGlyphs(this.ambientBatches.glow);
    backend.drawGlyphs(this.waterBatch, water);
    backend.drawGlyphs(this.glintBatch);
    backend.drawGlyphs(this.surfaceBatch, water);
    this.fillWreckGlow(time, sky.stars);
    if (this.wreckGlowBatch.count) backend.drawGlyphs(this.wreckGlowBatch);
    backend.drawGlyphs(this.grassBatches.near, land);
    backend.drawGlyphs(this.grassBatches.flies);
    if (this.rain > 0.02) backend.drawGlyphs(this.rainBatch, [1.15, 1.15, 1.15, 0.4 + 0.5 * this.rain]);
    this.renderOverlay(time, angler);
  }
}
