import { sampleWater } from "./water-engine.js";
import { createForestGlyphs } from "./forest-engine.js";
import { activeScene, bankWidths, isOpenWater, setScene, shorelineY, sunPosition, view } from "./scene.js";
import { skyAt, toHex, toInt } from "./daycycle.js";
import { clamp, hash2, hexToInt, mixColor } from "./noise.js";
import { createBankGlyphs, createRidgeGlyphs, createShoreGlyphs, createStructures, ridgeTop } from "./landscape-engine.js";
import { birdsAt, createSkyCells, discOffsets, lightSky, pushDisc, sampleSky, setCloudColors, setCloudiness } from "./sky-engine.js";
import { createLilyPads, createReeds, createRocks, rockGlyphs } from "./foreground-engine.js";
import { GlyphBatch, createBackend } from "./glyph-backend.js";
import { createAmbient, fillAmbient } from "./ambient-engine.js";
import { ROD_LOOKS } from "./fishing/sprites.js";

const WATER_RAMP = "    ..,:;~-=+*#%@W";
const MONO_FONT = '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const GAME_ISOMETRIC_SLOPE = 0.5;
const WATER_BANDS = 10;
const REFLECTION_LEVELS = 3;
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
    this.ducks = [];
    this.glintBatch = new GlyphBatch();
    this.lightKey = null;
    this.forestBatch = new GlyphBatch();
    this.waterBatch = new GlyphBatch(32768);
    this.surfaceBatch = new GlyphBatch();
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

  rebuildGrid(config) {
    if (!this.width || !this.height) return;

    this.cellWidth = Math.max(4, Number(config.spacing));
    this.lineHeight = Math.max(Number(config.charSize) * 1.14, this.cellWidth * 1.22);
    const { width, height, cellWidth, lineHeight } = this;
    const columns = Math.ceil(width / cellWidth);
    const rows = Math.ceil(height / lineHeight);
    this.columns = columns;
    this.rows = rows;

    this.lilyPads = createLilyPads(width, height, cellWidth, lineHeight, this.frame);
    for (const pad of this.lilyPads) {
      for (const cell of [...pad.cells, ...pad.flower]) cell.colorValue = hexToInt(cell.color);
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
    for (const cell of this.forestCells) cell.colorValue = hexToInt(cell.color);
    this.shoreCells = createShoreGlyphs(width, height, cellWidth, lineHeight, this.sun.x);
    const structures = createStructures(width, height, cellWidth, lineHeight);
    this.structureCells = structures.cells;
    this.structureShapes = structures.shapes;
    this.lightBatch.clear();
    for (const cell of structures.lights) this.lightBatch.push(cell.x, cell.y, cell.glyph, hexToInt(cell.color));
    this.bankCells = createBankGlyphs(width, height, cellWidth, lineHeight, this.sun.x);
    this.ambient = createAmbient({
      scene, structures, ridgeCells: this.ridgeCells, bankCells: this.bankCells,
      width, height, cellWidth, lineHeight, shorelineY: (x) => this.shorelineY(x),
    });
    this.waterRocks = this.createWaterRocks();
    const bend = scene.water.bend;
    this.waterParams = {
      flow: scene.water.flow ?? 0,
      flowAway: Boolean(scene.water.flowAway),
      bend: bend ? { ...this.screenToPlane(bend.x * width, bend.y * height), from: bend.from, to: bend.to } : null,
    };
    this.treeline = new Float32Array(columns + 1);
    for (let column = 0; column <= columns; column += 1) this.treeline[column] = this.shorelineY(column * cellWidth);
    for (const cell of this.forestCells) {
      if (cell.bank || cell.glyph === "|" || cell.y - lineHeight * 0.2 > this.treeline[cell.column]) continue;
      this.treeline[cell.column] = cell.y - lineHeight * 0.2;
    }
    this.buildBackdrop();

    this.font = `${config.charSize}px ${MONO_FONT}`;
    this.reedSize = clamp(Number(config.charSize) * 2, 13, 28);
    this.backend.setFont(this.font, Number(config.charSize));
    this.backend.setLayer("land", this.createLayer((ctx) => this.paintLand(ctx)));
    this.lightKey = null;
    this.rockImages = this.rocks.map((rock) => this.createRockImage(rock));
    this.bridgeImage = scene.foreground.bridge ? this.createBridgeImage(scene.foreground.bridge) : null;
    this.skyTime = null;
  }

  /** Map every on-shore cell to the color of whatever the water should mirror there. */
  buildBackdrop() {
    const { columns, rows } = this;
    this.backdrop = new Int16Array(columns * rows).fill(-1);
    this.backdropColors = [];
    const indexOf = new Map();
    const put = (cell, color) => {
      if (cell.row < 0 || cell.row >= rows || cell.column < 0 || cell.column >= columns) return;
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

  updatePalette(waterColor, sky) {
    const horizon = toHex(sky.sky[3]);
    const key = `${waterColor}|${horizon}`;
    if (this.paletteKey === key) return;
    this.paletteKey = key;
    // Distant water mirrors the horizon sky; nearby water shows its own tone.
    const bands = Array.from({ length: WATER_BANDS }, (_, band) => (
      mixColor(waterColor, horizon, (1 - band / (WATER_BANDS - 1)) ** 1.6 * 0.62)
    ));
    this.waterBandColors = bands.map(hexToInt);
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
    return layer;
  }

  /** Ridges, the forest silhouette, shore, mist and the dark water body. */
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
    ctx.fillStyle = "#1b271f";
    ctx.beginPath();
    if (scene.forest.silhouette === "crowns") {
      // Scattered trees: back each glyph with a soft blob so crowns keep their own shape.
      const radius = Math.max(this.cellWidth, this.lineHeight) * 0.62;
      for (const cell of this.forestCells) {
        ctx.moveTo(cell.x + radius, cell.y);
        ctx.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
      }
    } else {
      ctx.moveTo(0, this.shorelineY(0) + 2);
      this.treeline.forEach((top, column) => ctx.lineTo((column + 0.5) * this.cellWidth, top));
      ctx.lineTo(width, this.shorelineY(width) + 2);
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

    // Dark water body beneath the glyphs, following the irregular shoreline.
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, this.shorelineY(x) + this.lineHeight * 0.3);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = scene.water.body ?? "#14232a";
    ctx.fill();

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
        ctx.fillStyle = cliff ? "#121614" : "#1d2a1c";
        ctx.fill();
      }
      if (!this.ambient.grassBanks) {
        for (const cell of this.bankCells) {
          ctx.fillStyle = cell.color;
          ctx.fillText(cell.glyph, cell.x, cell.y);
        }
      }
      // Trees on the banks get a dark backing so they stand out from the grass.
      ctx.fillStyle = "#0f1811";
      ctx.beginPath();
      const radius = Math.max(this.cellWidth, this.lineHeight) * 0.62;
      for (const cell of this.forestCells) {
        if (!cell.bank) continue;
        ctx.moveTo(cell.x + radius, cell.y);
        ctx.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  /**
   * Dark fantasy nights: wisps over the far water, a pale figure on the far
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
    if (night.figure && night.figure.alpha > 0.02) {
      const x = left + night.figure.x * width;
      const base = this.shorelineY(x) - lineHeight * 0.4;
      const color = mix(NIGHT, 0xeef2f8, night.figure.alpha * night.depth);
      // A hooded shape, a little taller than the reeds on the far bank.
      const rows = [" o ", "/|\\", "/|\\", "/_\\"];
      rows.forEach((row, index) => {
        [...row].forEach((glyph, k) => {
          if (glyph !== " ") glow.push(x + (k - 1) * cellWidth, base - (rows.length - 1 - index) * lineHeight, glyph, color);
        });
      });
    }
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
    const { cellWidth, lineHeight, columns, backdrop, waterBandColors, reflectionColors } = this;
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

      batch.push(x, y, glyph, waterBandColors[cell.band]);
    }
  }

  /** Lily pads, splash droplets and passing birds. */
  /** Rocks breaking the river surface, with a ring of foam cells around each. */
  createWaterRocks() {
    const { width, height, cellWidth, lineHeight } = this;
    return (activeScene().water.rocks ?? []).map((rock, index) => {
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

  /** Vertical bob of the water surface at a screen point, for things floating on it. */
  surfaceOffset(x, y, time, config, ripples) {
    const plane = this.screenToPlane(x, y);
    const sample = sampleWater({ x: plane.x, y: plane.y }, time, { ...config, ...this.waterParams }, y / this.height, ripples);
    const moved = this.project(sample.x, sample.y);
    return { x: clamp((moved.x - x) * 0.35, -3, 3), y: clamp((moved.y - y) * 0.35, -3, 3) };
  }

  /** Rod from the angler's hands (bottom right) toward the cast; it bends under tension. */
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
        const t = angler.castProgress;
        end = {
          x: rod.tip.x + (angler.target.x - rod.tip.x) * t,
          y: rod.tip.y + (angler.target.y - rod.tip.y) * t - Math.sin(t * Math.PI) * height * 0.22,
        };
      } else if (angler.phase === "fight") {
        end = angler.fish;
      } else {
        // The float rides the surface plus a slow bob of its own on still water.
        const drift = Math.sin(angler.time * 1.7) * 0.8;
        end = { x: angler.target.x + angler.bob.x, y: angler.target.y + angler.bob.y + angler.float.offset + drift };
      }

      const taut = angler.phase === "fight" ? Math.min(1, angler.tension * 1.6 + (angler.pulling ? 0.4 : 0)) : 0;
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
      if (angler.phase === "fight" && (angler.snag || angler.junk)) {
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

    for (const reed of this.reeds) {
      const segments = Math.max(2, Math.round(reed.length / step));
      const swing = (Math.sin(time * 0.95 + reed.phase) * 0.65 + Math.sin(time * 0.37 + reed.baseX * 0.01) * 0.35) * gust;
      const at = (t) => ({
        x: reed.baseX + reed.length * (reed.lean * t + reed.curve * t * t + swing * reed.flex * t * t),
        y: reed.baseY - reed.length * t,
      });
      const shade = reed.depth < 0.5 ? "#2c3b2c" : "#223024";
      const rim = reed.lit ? "#71804f" : "#46573c";
      const points = Array.from({ length: segments + 1 }, (_, i) => at(i / segments));

      // A solid silhouette hides the water glyphs behind each stalk.
      ctx.beginPath();
      points.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.lineWidth = size * (reed.kind === "grass" ? 0.3 : 0.4);
      ctx.strokeStyle = "#0b1410";
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
    const sky = skyAt(dayTime);

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
    fillAmbient(this.ambient, this.ambientBatches, time, dayTime, this.rain, Boolean(env.dark));
    if (env.night) this.drawNightEvents(env.night, time);
    this.fillWater(time, config, ripples);
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
    backend.drawLayer("sky", [dim, dim, dim * 1.02]);
    if (sky.stars > 0.03) backend.drawGlyphs(this.starBatch, [1, 1, 1, sky.stars]);
    backend.drawGlyphs(this.discBatch);
    backend.drawGlyphs(this.skyBatch);
    backend.drawLayer("land", land);
    backend.drawGlyphs(this.ambientBatches.ground, land);
    backend.drawGlyphs(this.forestBatch, land);
    backend.drawGlyphs(this.ambientBatches.haze, land);
    // Cottage windows and dam lamps glow as the light fades.
    backend.drawGlyphs(this.lightBatch, [1, 1, 1, Math.min(1, 0.12 + sky.stars)]);
    backend.drawGlyphs(this.ambientBatches.glow);
    backend.drawGlyphs(this.waterBatch, water);
    backend.drawGlyphs(this.glintBatch);
    backend.drawGlyphs(this.surfaceBatch, water);
    if (this.rain > 0.02) backend.drawGlyphs(this.rainBatch, [1.15, 1.15, 1.15, 0.4 + 0.5 * this.rain]);
    this.renderOverlay(time, angler);
  }
}
