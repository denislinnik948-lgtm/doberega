/**
 * Glyph drawing backends. The scene fills GlyphBatch instances (position, glyph,
 * color) and full-screen layer canvases; a backend composites them. WebGL2 draws
 * each batch with one instanced call, so tens of thousands of characters cost
 * almost nothing; Canvas 2D is a drop-in fallback.
 */

import { gradeImageData } from "./theme.js";

const FIRST_CODE = 32;
const NEUTRAL = [1, 1, 1, 1];
const ATLAS_COLUMNS = 16;
const ATLAS_ROWS = 6;

export class GlyphBatch {
  constructor(capacity = 4096) {
    this.count = 0;
    this.version = 0;
    this.allocate(capacity);
  }

  allocate(capacity) {
    const positions = new Float32Array(capacity * 4);
    const colors = new Uint8Array(capacity * 4);
    if (this.positions) {
      positions.set(this.positions);
      colors.set(this.colors);
    }
    this.capacity = capacity;
    this.positions = positions;
    this.colors = colors;
  }

  clear() {
    this.count = 0;
    // Tells the GPU side the contents changed and must be uploaded again.
    this.version += 1;
  }

  /**
   * `color` is a packed 0xRRGGBB integer, `angle` turns the glyph about its
   * centre (radians, clockwise) and `alpha` (0..255) fades it.
   */
  push(x, y, glyph, color, angle = 0, alpha = 255) {
    if (this.count === this.capacity) this.allocate(this.capacity * 2);
    const p = this.count * 4;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = glyph.charCodeAt(0) - FIRST_CODE;
    this.positions[p + 3] = angle;
    const c = this.count * 4;
    this.colors[c] = (color >> 16) & 255;
    this.colors[c + 1] = (color >> 8) & 255;
    this.colors[c + 2] = color & 255;
    this.colors[c + 3] = alpha;
    this.count += 1;
  }
}

function glyphBox(fontSize) {
  return { width: Math.ceil(fontSize * 0.9) + 2, height: Math.ceil(fontSize * 1.4) + 2 };
}

/** White printable-ASCII glyphs on a grid; tinted per instance on the GPU. */
function createAtlasCanvas(font, fontSize, ratio) {
  const box = glyphBox(fontSize);
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLUMNS * box.width * ratio;
  canvas.height = ATLAS_ROWS * box.height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  for (let code = FIRST_CODE + 1; code < 127; code += 1) {
    const index = code - FIRST_CODE;
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    ctx.fillText(String.fromCharCode(code), (column + 0.5) * box.width, (row + 0.5) * box.height);
  }
  return { canvas, box };
}

const FLAT = [0, 1, 1, 1];
// Sets of buffers each batch takes turns with (see gpuBatch).
const BUFFER_RING = 3;
const IDENTITY = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

const GLYPH_VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 instance;
layout(location = 2) in vec4 color;
uniform vec2 viewport;
uniform vec2 box;
uniform vec2 grid;
// Depth: glyphs scale from perspective.z at y = perspective.x to perspective.w at y = perspective.y.
uniform vec4 perspective;
out vec2 uv;
out vec4 tint;
void main() {
  float depth = clamp((instance.y - perspective.x) / max(1.0, perspective.y - perspective.x), 0.0, 1.0);
  vec2 offset = (corner - 0.5) * box * mix(perspective.z, perspective.w, depth);
  float c = cos(instance.w);
  float s = sin(instance.w);
  vec2 position = instance.xy + vec2(offset.x * c - offset.y * s, offset.x * s + offset.y * c);
  vec2 clip = position / viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 cell = vec2(mod(instance.z, grid.x), floor(instance.z / grid.x));
  uv = (cell + corner) / grid;
  tint = color;
}`;

const GLYPH_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D atlas;
uniform vec4 light;
in vec2 uv;
in vec4 tint;
out vec4 outColor;
void main() {
  float alpha = texture(atlas, uv).a * light.a * tint.a;
  outColor = vec4(min(tint.rgb * light.rgb, vec3(1.0)) * alpha, alpha);
}`;

const LAYER_VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
out vec2 uv;
void main() {
  uv = corner;
  gl_Position = vec4(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
}`;

const LAYER_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D layer;
uniform vec4 light;
// The colour grade (identity for a layer painted already graded). It is linear,
// so it applies to premultiplied colour as it is.
uniform mat3 grade;
in vec2 uv;
out vec4 outColor;
void main() {
  vec4 color = texture(layer, uv);
  vec3 graded = clamp(grade * color.rgb, 0.0, color.a);
  // Premultiplied: scale colour by the light, keep coverage.
  outColor = vec4(min(graded * light.rgb, vec3(color.a)), color.a);
}`;

class WebGLBackend {
  constructor(gl) {
    this.gl = gl;
    this.layers = new Map();
    this.glyphProgram = this.program(GLYPH_VERTEX, GLYPH_FRAGMENT);
    this.layerProgram = this.program(LAYER_VERTEX, LAYER_FRAGMENT);
    this.uniforms = {
      viewport: gl.getUniformLocation(this.glyphProgram, "viewport"),
      box: gl.getUniformLocation(this.glyphProgram, "box"),
      grid: gl.getUniformLocation(this.glyphProgram, "grid"),
      perspective: gl.getUniformLocation(this.glyphProgram, "perspective"),
      glyphLight: gl.getUniformLocation(this.glyphProgram, "light"),
      layerLight: gl.getUniformLocation(this.layerProgram, "light"),
      layerGrade: gl.getUniformLocation(this.layerProgram, "grade"),
    };
    this.layerGrades = new Map();

    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.layerVao = gl.createVertexArray();
    gl.bindVertexArray(this.layerVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.corners = corners;
    // Every glyph batch gets its own buffers and vertex array (see `gpuBatch`).
    this.batches = new WeakMap();
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  program(vertexSource, fragmentSource) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  texture(source, previous) {
    const gl = this.gl;
    const texture = previous ?? gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** `frame` is the slice of the canvas on screen; nothing is drawn outside it. */
  resize(width, height, ratio, frame = { left: 0, width }) {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.clipLeft = Math.max(0, Math.floor(frame.left * ratio) - 2);
    this.clipWidth = Math.ceil(frame.width * ratio) + 4;
  }

  setFont(font, fontSize, sharpness = 1) {
    const { canvas, box } = createAtlasCanvas(font, fontSize, this.ratio * sharpness);
    this.box = box;
    this.atlas = this.texture(canvas, this.atlas);
    // Glyphs drawn far smaller than the atlas (the depth experiment) need mipmaps to stay clean.
    if (sharpness > 1) {
      const gl = this.gl;
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }

  /**
   * A layer to draw whole; `grade` (a column-major 3×3 colour matrix) is applied
   * on the GPU as it is drawn, so a big layer never has to be read back and
   * graded pixel by pixel.
   */
  setLayer(name, canvas, grade = null) {
    this.layers.set(name, this.texture(canvas, this.layers.get(name)));
    this.layerGrades.set(name, grade ?? IDENTITY);
  }

  /**
   * The batch's own GPU buffers, sized to its capacity. Sharing one buffer
   * between batches made the driver wait for the GPU to finish with the last
   * upload, now and then stalling a frame for tens of milliseconds. Each batch
   * also takes turns between a few sets of buffers, so a fresh upload never
   * lands in one the GPU may still be drawing the previous frame from.
   */
  gpuBatch(batch) {
    let entry = this.batches.get(batch);
    if (!entry) {
      entry = { slots: [], next: 0, current: null };
      this.batches.set(batch, entry);
    }
    // Batches refilled only every other frame (water, grass) skip the upload in between.
    const current = entry.current;
    if (current && current.version === batch.version && current.count === batch.count && current.capacity >= batch.capacity) {
      this.gl.bindVertexArray(current.vao);
      return;
    }
    if (entry.slots.length < BUFFER_RING) entry.slots.push(this.bufferSlot());
    const slot = entry.slots[entry.next];
    entry.next = (entry.next + 1) % BUFFER_RING;
    const gl = this.gl;
    gl.bindVertexArray(slot.vao);
    if (slot.capacity < batch.capacity) {
      slot.capacity = batch.capacity;
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.positions);
      gl.bufferData(gl.ARRAY_BUFFER, batch.capacity * 16, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.colors);
      gl.bufferData(gl.ARRAY_BUFFER, batch.capacity * 4, gl.DYNAMIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.positions);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.positions, 0, batch.count * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.colors);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.colors, 0, batch.count * 4);
    slot.version = batch.version;
    slot.count = batch.count;
    entry.current = slot;
  }

  /** One set of instance buffers with its vertex array. */
  bufferSlot() {
    const gl = this.gl;
    const slot = { vao: gl.createVertexArray(), positions: gl.createBuffer(), colors: gl.createBuffer(), capacity: 0, version: -1, count: -1 };
    gl.bindVertexArray(slot.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.positions);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.colors);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    return slot;
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    // On a phone the canvas is wider than the screen: shade only the part on show.
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(this.clipLeft, 0, this.clipWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * `light` multiplies the layer's colour: [r, g, b] (values above 1 brighten);
   * `band` = [top, bottom] in CSS pixels limits drawing to the rows where the
   * layer can show; `opaque` skips blending for a layer with no transparency.
   */
  drawLayer(name, light = NEUTRAL, band = null, opaque = false) {
    const gl = this.gl;
    if (opaque) gl.disable(gl.BLEND);
    if (band) {
      const top = Math.max(0, Math.floor(band[0] * this.ratio));
      const bottom = Math.min(gl.drawingBufferHeight, Math.ceil(band[1] * this.ratio));
      gl.scissor(this.clipLeft, gl.drawingBufferHeight - bottom, this.clipWidth, Math.max(0, bottom - top));
    }
    gl.useProgram(this.layerProgram);
    gl.uniform4f(this.uniforms.layerLight, light[0], light[1], light[2], 1);
    gl.uniformMatrix3fv(this.uniforms.layerGrade, false, this.layerGrades.get(name) ?? IDENTITY);
    gl.bindVertexArray(this.layerVao);
    gl.bindTexture(gl.TEXTURE_2D, this.layers.get(name));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (band) gl.scissor(this.clipLeft, 0, this.clipWidth, gl.drawingBufferHeight);
    if (opaque) gl.enable(gl.BLEND);
  }

  /** `light` multiplies glyph colours; its fourth value is opacity. */
  drawGlyphs(batch, light = NEUTRAL, perspective = FLAT) {
    if (!batch.count) return;
    const gl = this.gl;
    gl.useProgram(this.glyphProgram);
    gl.uniform4f(this.uniforms.perspective, perspective[0], perspective[1], perspective[2], perspective[3]);
    gl.uniform4f(this.uniforms.glyphLight, light[0], light[1], light[2], light[3] ?? 1);
    gl.uniform2f(this.uniforms.viewport, this.width, this.height);
    gl.uniform2f(this.uniforms.box, this.box.width, this.box.height);
    gl.uniform2f(this.uniforms.grid, ATLAS_COLUMNS, ATLAS_ROWS);
    this.gpuBatch(batch);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
    gl.bindVertexArray(null);
  }
}

class Canvas2DBackend {
  constructor(ctx) {
    this.ctx = ctx;
    this.layers = new Map();
    this.styles = new Map();
    this.characters = Array.from({ length: 127 - FIRST_CODE }, (_, i) => String.fromCharCode(i + FIRST_CODE));
  }

  resize(width, height, ratio) {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
  }

  setFont(font) {
    this.font = font;
  }

  /** No shader here: a graded layer is graded once, pixel by pixel. */
  setLayer(name, canvas, grade = null) {
    if (grade) {
      const ctx = canvas.getContext("2d");
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      gradeImageData(image.data);
      ctx.putImageData(image, 0, 0);
    }
    this.layers.set(name, canvas);
  }

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  /** Canvas 2D can't multiply per channel cheaply; approximate with brightness. */
  applyLight(light) {
    const brightness = (light[0] + light[1] + light[2]) / 3;
    this.ctx.filter = Math.abs(brightness - 1) > 0.02 ? `brightness(${brightness.toFixed(2)})` : "none";
    this.ctx.globalAlpha = light[3] ?? 1;
  }

  drawLayer(name, light = NEUTRAL) {
    this.applyLight(light);
    this.ctx.drawImage(this.layers.get(name), 0, 0, this.width, this.height);
    this.ctx.filter = "none";
    this.ctx.globalAlpha = 1;
  }

  drawGlyphs(batch, light = NEUTRAL) {
    const { ctx, characters } = this;
    this.applyLight(light);
    let previous = -1;
    for (let i = 0; i < batch.count; i += 1) {
      const c = i * 4;
      const color = (batch.colors[c] << 16) | (batch.colors[c + 1] << 8) | batch.colors[c + 2];
      if (color !== previous) {
        previous = color;
        let style = this.styles.get(color);
        if (!style) this.styles.set(color, style = `#${(color | 0x1000000).toString(16).slice(1)}`);
        ctx.fillStyle = style;
      }
      const p = i * 4;
      const angle = batch.positions[p + 3];
      const alpha = batch.colors[c + 3];
      if (alpha < 255) ctx.globalAlpha = (light[3] ?? 1) * (alpha / 255);
      if (angle) {
        ctx.save();
        ctx.translate(batch.positions[p], batch.positions[p + 1]);
        ctx.rotate(angle);
        ctx.fillText(characters[batch.positions[p + 2]], 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(characters[batch.positions[p + 2]], batch.positions[p], batch.positions[p + 1]);
      }
      if (alpha < 255) ctx.globalAlpha = light[3] ?? 1;
    }
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }
}

export function createBackend(canvas) {
  // No `desynchronized` (low-latency) canvas: on some Windows GPUs it lets the screen show a
  // frame before it is finished, flickering black or without its glyphs.
  // The built-in GPU draws these glyphs easily; asking for "high-performance"
  // wakes a laptop's discrete GPU, which runs hot and drains the battery.
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "low-power" });
  if (gl) {
    try {
      return new WebGLBackend(gl);
    } catch (error) {
      console.warn("WebGL2 glyph renderer unavailable, using Canvas 2D.", error);
    }
  }
  return new Canvas2DBackend(canvas.getContext("2d", { alpha: false }));
}
