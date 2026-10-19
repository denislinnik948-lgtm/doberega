/**
 * Glyph drawing backends. The scene fills GlyphBatch instances (position, glyph,
 * color) and full-screen layer canvases; a backend composites them. WebGL2 draws
 * each batch with one instanced call, so tens of thousands of characters cost
 * almost nothing; Canvas 2D is a drop-in fallback.
 */

const FIRST_CODE = 32;
const NEUTRAL = [1, 1, 1, 1];
const ATLAS_COLUMNS = 16;
const ATLAS_ROWS = 6;

export class GlyphBatch {
  constructor(capacity = 4096) {
    this.count = 0;
    this.allocate(capacity);
  }

  allocate(capacity) {
    const positions = new Float32Array(capacity * 3);
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
  }

  /** `color` is a packed 0xRRGGBB integer. */
  push(x, y, glyph, color) {
    if (this.count === this.capacity) this.allocate(this.capacity * 2);
    const p = this.count * 3;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = glyph.charCodeAt(0) - FIRST_CODE;
    const c = this.count * 4;
    this.colors[c] = (color >> 16) & 255;
    this.colors[c + 1] = (color >> 8) & 255;
    this.colors[c + 2] = color & 255;
    this.colors[c + 3] = 255;
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

const GLYPH_VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec3 instance;
layout(location = 2) in vec4 color;
uniform vec2 viewport;
uniform vec2 box;
uniform vec2 grid;
out vec2 uv;
out vec3 tint;
void main() {
  vec2 position = instance.xy + (corner - 0.5) * box;
  vec2 clip = position / viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 cell = vec2(mod(instance.z, grid.x), floor(instance.z / grid.x));
  uv = (cell + corner) / grid;
  tint = color.rgb;
}`;

const GLYPH_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D atlas;
uniform vec4 light;
in vec2 uv;
in vec3 tint;
out vec4 outColor;
void main() {
  float alpha = texture(atlas, uv).a * light.a;
  outColor = vec4(min(tint * light.rgb, vec3(1.0)) * alpha, alpha);
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
in vec2 uv;
out vec4 outColor;
void main() {
  vec4 color = texture(layer, uv);
  // Premultiplied: scale colour by the light, keep coverage.
  outColor = vec4(min(color.rgb * light.rgb, vec3(color.a)), color.a);
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
      glyphLight: gl.getUniformLocation(this.glyphProgram, "light"),
      layerLight: gl.getUniformLocation(this.layerProgram, "light"),
    };

    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.layerVao = gl.createVertexArray();
    gl.bindVertexArray(this.layerVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.glyphVao = gl.createVertexArray();
    gl.bindVertexArray(this.glyphVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    this.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.vertexAttribDivisor(2, 1);
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

  resize(width, height, ratio) {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
  }

  setFont(font, fontSize) {
    const { canvas, box } = createAtlasCanvas(font, fontSize, this.ratio);
    this.box = box;
    this.atlas = this.texture(canvas, this.atlas);
  }

  setLayer(name, canvas) {
    this.layers.set(name, this.texture(canvas, this.layers.get(name)));
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** `light` multiplies the layer's colour: [r, g, b] (values above 1 brighten). */
  drawLayer(name, light = NEUTRAL) {
    const gl = this.gl;
    gl.useProgram(this.layerProgram);
    gl.uniform4f(this.uniforms.layerLight, light[0], light[1], light[2], 1);
    gl.bindVertexArray(this.layerVao);
    gl.bindTexture(gl.TEXTURE_2D, this.layers.get(name));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** `light` multiplies glyph colours; its fourth value is opacity. */
  drawGlyphs(batch, light = NEUTRAL) {
    if (!batch.count) return;
    const gl = this.gl;
    gl.useProgram(this.glyphProgram);
    gl.uniform4f(this.uniforms.glyphLight, light[0], light[1], light[2], light[3] ?? 1);
    gl.uniform2f(this.uniforms.viewport, this.width, this.height);
    gl.uniform2f(this.uniforms.box, this.box.width, this.box.height);
    gl.uniform2f(this.uniforms.grid, ATLAS_COLUMNS, ATLAS_ROWS);
    gl.bindVertexArray(this.glyphVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.positions.subarray(0, batch.count * 3), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.colors.subarray(0, batch.count * 4), gl.STREAM_DRAW);
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

  setLayer(name, canvas) {
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
      const p = i * 3;
      ctx.fillText(characters[batch.positions[p + 2]], batch.positions[p], batch.positions[p + 1]);
    }
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }
}

export function createBackend(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, desynchronized: true, powerPreference: "high-performance" });
  if (gl) {
    try {
      return new WebGLBackend(gl);
    } catch (error) {
      console.warn("WebGL2 glyph renderer unavailable, using Canvas 2D.", error);
    }
  }
  return new Canvas2DBackend(canvas.getContext("2d", { alpha: false, desynchronized: true }));
}
