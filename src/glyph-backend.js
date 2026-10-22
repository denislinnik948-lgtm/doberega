/**
 * Glyph drawing backends. The scene fills GlyphBatch instances (position, glyph,
 * color) and full-screen layer canvases; a backend composites them. WebGL2 draws
 * each batch with one instanced call, so tens of thousands of characters cost
 * almost nothing; Canvas 2D is a drop-in fallback.
 *
 * WebGL also darkens the land and water it draws under drifting cloud shadows
 * and the shadows trees cast (a soft greyscale map painted by the scene).
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

const GLYPH_VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 instance;
layout(location = 2) in vec4 color;
uniform vec2 viewport;
uniform vec2 box;
uniform vec2 grid;
out vec2 uv;
out vec4 tint;
void main() {
  vec2 offset = (corner - 0.5) * box;
  float c = cos(instance.w);
  float s = sin(instance.w);
  vec2 position = instance.xy + vec2(offset.x * c - offset.y * s, offset.x * s + offset.y * c);
  vec2 clip = position / viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 cell = vec2(mod(instance.z, grid.x), floor(instance.z / grid.x));
  uv = (cell + corner) / grid;
  tint = color;
}`;

/*
 * Shadows, shared by glyphs and layers: cloud shadows are value noise laid on
 * the ground plane (squeezed toward the horizon, carried by the wind), tree
 * shadows come from a greyscale map. `shadow` = (cloud strength, time,
 * horizon y, mode: 0 none, 1 clouds and trees, 2 clouds only, 3 both faint);
 * `screen` = (width, height, pixel ratio) in CSS pixels.
 */
const SHADE = `
uniform vec4 shadow;
uniform vec3 screen;
uniform sampler2D treeShadow;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float shade() {
  if (shadow.w < 0.5) return 1.0;
  vec2 pos = vec2(gl_FragCoord.x, screen.y * screen.z - gl_FragCoord.y) / screen.z;
  float depth = max(pos.y - shadow.z, 0.0) / max(screen.y - shadow.z, 1.0);
  float distance = 1.0 / (depth + 0.12);
  float above = max(shadow.z - pos.y, 0.0) / screen.y;
  vec2 ground = vec2((pos.x / screen.x - 0.5) * distance * 2.2, distance * 1.3 + above * 14.0);
  ground += vec2(shadow.y * 0.045, shadow.y * 0.012);
  float n = noise(ground * 0.55) * 0.65 + noise(ground * 1.3 + 7.0) * 0.35;
  // On water (mode 3) shadows are faint: it mirrors the bright sky around them.
  float faint = shadow.w > 2.5 ? 0.4 : 1.0;
  float cloud = 1.0 - smoothstep(0.48, 0.7, n) * shadow.x * faint;
  float trees = shadow.w > 1.5 && shadow.w < 2.5 ? 1.0 : mix(1.0, texture(treeShadow, pos / screen.xy).r, faint);
  return min(cloud, trees);
}
`;

const GLYPH_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D atlas;
uniform vec4 light;
in vec2 uv;
in vec4 tint;
out vec4 outColor;
${SHADE}
void main() {
  float alpha = texture(atlas, uv).a * light.a * tint.a;
  outColor = vec4(min(tint.rgb * light.rgb, vec3(1.0)) * shade() * alpha, alpha);
}`;

const LAYER_VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
out vec2 uv;
void main() {
  uv = corner;
  gl_Position = vec4(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
}`;

const LAYER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D layer;
uniform vec4 light;
in vec2 uv;
out vec4 outColor;
${SHADE}
void main() {
  vec4 color = texture(layer, uv);
  // Premultiplied: scale colour by the light, keep coverage.
  outColor = vec4(min(color.rgb * light.rgb, vec3(color.a)) * shade(), color.a);
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
    // Each program's shadow uniforms; the tree shadow map sits on texture unit 1.
    this.shadeUniforms = new Map([this.glyphProgram, this.layerProgram].map((program) => {
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, "treeShadow"), 1);
      return [program, { shadow: gl.getUniformLocation(program, "shadow"), screen: gl.getUniformLocation(program, "screen") }];
    }));
    this.shadow = [0, 0, 0];
    const blank = document.createElement("canvas");
    blank.width = 1;
    blank.height = 1;
    const blankContext = blank.getContext("2d");
    blankContext.fillStyle = "#fff";
    blankContext.fillRect(0, 0, 1, 1);
    this.setShadowMap(blank);

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
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
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

  /** The greyscale map of tree shadows (white = full light). */
  setShadowMap(canvas) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    this.shadowMap = this.texture(canvas, this.shadowMap);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** This frame's cloud shadow strength, clock and horizon line. */
  setShadow(strength, time, horizon) {
    this.shadow = [strength, time, horizon];
  }

  /** `shaded`: false for no shadows, true for clouds and trees, "clouds" for cloud shadows only, "faint" for both, lighter. */
  applyShade(program, shaded) {
    const gl = this.gl;
    const uniforms = this.shadeUniforms.get(program);
    gl.uniform4f(uniforms.shadow, this.shadow[0], this.shadow[1], this.shadow[2], shaded === "faint" ? 3 : shaded === "clouds" ? 2 : shaded ? 1 : 0);
    gl.uniform3f(uniforms.screen, this.width, this.height, this.ratio);
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** `light` multiplies the layer's colour: [r, g, b] (values above 1 brighten); `shaded` lets shadows fall on it. */
  drawLayer(name, light = NEUTRAL, shaded = false) {
    const gl = this.gl;
    gl.useProgram(this.layerProgram);
    gl.uniform4f(this.uniforms.layerLight, light[0], light[1], light[2], 1);
    this.applyShade(this.layerProgram, shaded);
    gl.bindVertexArray(this.layerVao);
    gl.bindTexture(gl.TEXTURE_2D, this.layers.get(name));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** `light` multiplies glyph colours; its fourth value is opacity. `shaded` lets shadows fall on them. */
  drawGlyphs(batch, light = NEUTRAL, shaded = false) {
    if (!batch.count) return;
    const gl = this.gl;
    gl.useProgram(this.glyphProgram);
    gl.uniform4f(this.uniforms.glyphLight, light[0], light[1], light[2], light[3] ?? 1);
    this.applyShade(this.glyphProgram, shaded);
    gl.uniform2f(this.uniforms.viewport, this.width, this.height);
    gl.uniform2f(this.uniforms.box, this.box.width, this.box.height);
    gl.uniform2f(this.uniforms.grid, ATLAS_COLUMNS, ATLAS_ROWS);
    gl.bindVertexArray(this.glyphVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.positions.subarray(0, batch.count * 4), gl.STREAM_DRAW);
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

  // Shadows need the GPU; the fallback simply goes without them.
  setShadowMap() {}

  setShadow() {}

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
