import { cardFish } from "./fish.js";

/**
 * Social media cards for Doberega's fish: a dithered four-tone portrait in a
 * bramble frame, the fish's name on a plaque and a line of grim wisdom below.
 * Everything is drawn pixel by pixel on a small grid, then scaled up 5x
 * (1080x1350, the 4:5 portrait size feeds like best).
 *
 * ?fish=okun picks the card, ?all runs through every fish; ?save posts the PNG to tools/cards/save.py.
 */

const W = 216;
const H = 270;
const SCALE = 5;
const PALETTE = ["#1e1d29", "#5c7774", "#a0b4ac", "#dcdfd4"];
const INK = 0;
const SLATE = 1;
const SAGE = 2;
const BONE = 3;

// The art panel, inside the frame.
const PANEL = { x0: 18, y0: 30, x1: 198, y1: 186 };
const TEXT_BOX = { x0: 20, y0: 198, x1: 196, y1: 262 };

// Name on the plaque and a line of grim wisdom, in the order they are posted.
const CARDS = {
  okun: { name: "perch", text: ["the perch does not wait", "for the world to be kind.", "it simply takes."] },
  plitka: { name: "roach", text: ["the roach swims with", "a thousand others.", "none of them will miss it."] },
  krasnopirka: { name: "rudd", text: ["red fins in still water.", "beauty is only", "another kind of bait."] },
  karas: { name: "crucian", text: ["the crucian sleeps in mud", "through every winter.", "patience is armour."] },
  lyn: { name: "tench", text: ["the tench keeps to the dark.", "not everything that hides", "is afraid."] },
  lyasch: { name: "bream", text: ["the bream feeds slowly.", "whatever hurries", "ends up in the net."] },
  korop: { name: "carp", text: ["the carp has outlived", "your doubts before.", "it will do it again."] },
  shchuka: { name: "pike", text: ["the pike does not chase.", "it waits in the weeds", "until you come close."] },
  sudak: { name: "zander", text: ["the zander hunts at night.", "its eyes were made", "for what you cannot see."] },
  som: { name: "catfish", text: ["something old lives", "at the bottom of the river.", "it is listening."] },
  yorzh: { name: "ruffe", text: ["small and full of spines.", "be the fish", "no one wants to swallow."] },
};

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

const pixels = new Uint8Array(W * H);

function set(x, y, tone) {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && y >= 0 && x < W && y < H) pixels[y * W + x] = tone;
}

/** A continuous tone 0..3 turned into a palette index by ordered dithering. */
function dither(value, x, y) {
  const v = Math.max(0, Math.min(3, value));
  const base = Math.floor(v);
  if (base >= 3) return 3;
  return base + (v - base > BAYER[y & 3][x & 3] ? 1 : 0);
}

function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const fbm = (x, y, seed) => noise(x, y, seed) * 0.6 + noise(x * 2.1, y * 2.1, seed + 1) * 0.3 + noise(x * 4.3, y * 4.3, seed + 2) * 0.1;

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothly interpolate a profile given as [u, value] points. */
function curve(points, u) {
  if (u <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [u1, v1] = points[i];
    const [u0, v0] = points[i - 1];
    if (u <= u1) {
      const t = (u - u0) / (u1 - u0);
      return v0 + (v1 - v0) * t * t * (3 - 2 * t);
    }
  }
  return points[points.length - 1][1];
}

/* ---------- background ---------- */

function paintBackground() {
  pixels.fill(INK);
  const { x0, y0, x1, y1 } = PANEL;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2 - 4;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d = Math.hypot((x - cx) / ((x1 - x0) * 0.62), (y - cy) / ((y1 - y0) * 0.62));
      let v = 3.05 - d * 1.45 + (fbm(x * 0.07, y * 0.07, 3) - 0.5) * 1.1;
      // A darker upper-left corner, like light falling in from the other side.
      v -= Math.max(0, 1 - (x - x0) / 75 - (y - y0) / 75) * 0.9;
      // The fish's shadow on the bottom.
      v -= 0.95 * Math.exp(-(((x - 112) / 62) ** 2) - ((y - 166) / 8) ** 2);
      set(x, y, dither(v, x, y));
    }
  }
}

/* ---------- the fish ---------- */

/** Blit the fish portrait at double size, centred in the panel, and hang it on a line. */
function drawFish(species) {
  const { grid, width, height, mouth } = cardFish(species);
  const ox = Math.round((PANEL.x0 + PANEL.x1) / 2 - width);
  const oy = Math.round((PANEL.y0 + PANEL.y1) / 2 - height - 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tone = grid[y * width + x];
      if (tone < 0) continue;
      for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) set(ox + x * 2 + dx, oy + y * 2 + dy, tone);
    }
  }
  // The line it was taken on, from the corner of the mouth up out of the picture.
  const hx = ox + mouth.x * 2 + 1;
  const hy = oy + mouth.y * 2 + 1;
  line(hx, hy, Math.min(PANEL.x1 - 6, hx + 10), PANEL.y0, INK);
  set(hx, hy + 1, BONE);
  set(hx + 1, hy + 2, BONE);
  set(hx, hy + 3, BONE);
  return { hx, hy };
}

function line(x0, y0, x1, y1, tone) {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  for (let i = 0; i <= steps; i += 1) set(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, tone);
}

/* ---------- surroundings ---------- */

/** Clumps of waterweed rising from the bottom corners, behind the fish. */
function paintWeeds(random) {
  for (const [base, count, tall] of [[PANEL.x0 + 10, 6, 62], [PANEL.x0 + 30, 3, 34], [PANEL.x1 - 14, 5, 54]]) {
    for (let i = 0; i < count; i += 1) {
      const x0 = base + (random() - 0.5) * 18;
      const height = tall * (0.5 + random() * 0.5);
      const sway = (random() - 0.5) * 16;
      const phase = random() * 6;
      let last = null;
      for (let k = 0; k <= height; k += 1) {
        const t = k / height;
        const x = x0 + sway * t * t + Math.sin(t * 5 + phase) * 2;
        const y = PANEL.y1 - k;
        const tone = t < 0.55 ? INK : dither(1.4 - t, Math.round(x), Math.round(y));
        set(x, y, tone);
        if (t < 0.75) set(x + 1, y, tone);
        // Little leaves branching off every few pixels.
        if (k > 4 && k % 6 === 0 && random() < 0.8) {
          const side = random() < 0.5 ? -1 : 1;
          for (let j = 1; j <= 5; j += 1) set(x + side * j, y - j * 0.5 - (j * j) / 8, tone);
        }
        last = [x, y];
      }
      if (last) set(last[0], last[1] - 1, SLATE);
    }
  }
}

/** A few bubbles drifting up from where the line meets the water. */
function paintBubbles({ hx, hy }) {
  for (const [dx0, dy0, r] of [[-10, -14, 2.5], [-4, -26, 1.6], [-14, -34, 1.5], [-20, -22, 2], [-8, -46, 2]]) {
    const x = Math.max(PANEL.x0 + 4, hx + dx0);
    const y = Math.max(PANEL.y0 + 4, hy + dy0);
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const d = Math.hypot(dx, dy);
        if (Math.abs(d - r) < 0.55) set(x + dx, y + dy, SLATE);
      }
    }
    set(x - Math.round(r * 0.5), y - Math.round(r * 0.5), BONE);
  }
}

/* ---------- frame ---------- */

function paintFrame(random) {
  const { x0, y0, x1, y1 } = PANEL;
  // A thick bone border with a dark gap against the picture.
  for (let x = x0 - 3; x <= x1 + 3; x += 1) {
    for (const y of [y0 - 1, y1 + 1]) set(x, y, INK);
    for (const y of [y0 - 2, y0 - 3, y1 + 2, y1 + 3]) set(x, y, BONE);
  }
  for (let y = y0 - 3; y <= y1 + 3; y += 1) {
    for (const x of [x0 - 1, x1 + 1]) set(x, y, INK);
    for (const x of [x0 - 2, x0 - 3, x1 + 2, x1 + 3]) set(x, y, BONE);
  }
  // Thorns: short spikes outward, the odd nick and burr.
  const thorn = (x, y, dx, dy) => {
    const length = 1 + Math.floor(random() * 3);
    const lean = random() < 0.5 ? -1 : 1;
    for (let i = 1; i <= length; i += 1) set(x + dx * i + (i === length && random() < 0.5 ? lean * Math.abs(dy) : 0), y + dy * i + (i === length && random() < 0.5 ? lean * Math.abs(dx) : 0), BONE);
  };
  for (let x = x0 - 3; x <= x1 + 3; x += 1) {
    if (random() < 0.22) thorn(x, y0 - 3, 0, -1);
    if (random() < 0.22) thorn(x, y1 + 3, 0, 1);
    if (random() < 0.08) set(x, y0 - 3, INK);
    if (random() < 0.08) set(x, y1 + 3, INK);
    if (random() < 0.06) set(x, y0, BONE);
    if (random() < 0.06) set(x, y1, BONE);
  }
  for (let y = y0 - 3; y <= y1 + 3; y += 1) {
    if (random() < 0.22) thorn(x0 - 3, y, -1, 0);
    if (random() < 0.22) thorn(x1 + 3, y, 1, 0);
    if (random() < 0.08) set(x0 - 3, y, INK);
    if (random() < 0.08) set(x1 + 3, y, INK);
    if (random() < 0.06) set(x0, y, BONE);
    if (random() < 0.06) set(x1, y, BONE);
  }
  // Bramble knots at the corners: branching, thorny random walks.
  for (const [cx, cy, sx, sy] of [[x0 - 3, y0 - 3, -1, -1], [x1 + 3, y0 - 3, 1, -1], [x0 - 3, y1 + 3, -1, 1], [x1 + 3, y1 + 3, 1, 1]]) {
    for (let branch = 0; branch < 13; branch += 1) {
      let x = cx + (random() - 0.5) * 6;
      let y = cy + (random() - 0.5) * 6;
      const angle = random() * Math.PI * 2;
      let dx = Math.cos(angle);
      let dy = Math.sin(angle);
      for (let step = 0; step < 6 + random() * 9; step += 1) {
        x += dx;
        y += dy;
        // Keep the knot hugging its corner, mostly outside the picture.
        if (Math.hypot(x - cx, y - cy) > 16 || (x - cx) * sx < -9 || (y - cy) * sy < -9) break;
        if ((x - cx) * sx < -1 && (y - cy) * sy < -1) break;
        set(x, y, BONE);
        if (random() < 0.3) set(x + (random() < 0.5 ? 1 : -1), y + (random() < 0.5 ? 1 : -1), BONE);
        const turn = (random() - 0.5) * 1.2;
        [dx, dy] = [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
      }
    }
  }
}

/* ---------- text ---------- */

/** Rasterise text with no anti-aliasing: a mask of pixels, centred on (cx, cy). */
function textMask(text, font, cx, cy) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(text, cx, cy);
  const data = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i += 1) mask[i] = data[i * 4 + 3] > 120 ? 1 : 0;
  return { mask, width: ctx.measureText(text).width };
}

function stamp(mask, tone, outlineTone = null) {
  if (outlineTone !== null) {
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        if (mask[y * W + x]) continue;
        if (mask[y * W + x - 1] || mask[y * W + x + 1] || mask[(y - 1) * W + x] || mask[(y + 1) * W + x]) set(x, y, outlineTone);
      }
    }
  }
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) pixels[i] = tone;
}

function rect(x0, y0, x1, y1, tone, fill = false) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (fill || x === x0 || x === x1 || y === y0 || y === y1) set(x, y, tone);
    }
  }
}

function paintPlaque(name, font) {
  const cx = W / 2;
  const cy = 17;
  const { mask, width } = textMask(name, font, cx, cy);
  const half = Math.ceil(width / 2) + 9;
  const x0 = Math.round(cx - half);
  const x1 = Math.round(cx + half);
  const y0 = 5;
  const y1 = 31;
  rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1, INK, true);
  rect(x0, y0, x1, y1, BONE, true);
  rect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, SLATE, true);
  rect(x0 + 3, y0 + 3, x1 - 3, y1 - 3, INK);
  // A little notch pointing down at the picture.
  for (let k = 0; k <= 4; k += 1) {
    for (let x = -5 + k; x <= 5 - k; x += 1) set(cx + x, y1 + 1 + k, Math.abs(x) === 5 - k ? BONE : SLATE);
  }
  stamp(mask, BONE, INK);
}

function paintTextBox(lines, font) {
  const { x0, y0, x1, y1 } = TEXT_BOX;
  rect(x0, y0, x1, y1, BONE);
  // Ticks across the border and hollow knots at the corners.
  for (let x = x0 + 8; x < x1 - 4; x += 13) {
    set(x, y0 - 1, BONE);
    set(x, y0 + 1, BONE);
    set(x + 5, y1 + 1, BONE);
    set(x + 5, y1 - 1, BONE);
  }
  for (let y = y0 + 9; y < y1 - 4; y += 12) {
    set(x0 - 1, y, BONE);
    set(x0 + 1, y, BONE);
    set(x1 + 1, y + 4, BONE);
    set(x1 - 1, y + 4, BONE);
  }
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    rect(x - 1, y - 1, x + 1, y + 1, BONE);
    set(x, y, INK);
  }
  const lineHeight = 17;
  const top = (y0 + y1) / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((text, i) => stamp(textMask(text, font, W / 2, top + i * lineHeight).mask, BONE));
}

/* ---------- output ---------- */

function present(canvas) {
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      ctx.fillStyle = PALETTE[pixels[y * W + x]];
      ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
    }
  }
}

async function render(fish, canvas, save) {
  const card = CARDS[fish];
  const titleFont = '20px "Kelly Slab"';
  await Promise.all([document.fonts.load(titleFont, card.name), document.fonts.load('14px "Kelly Slab"', card.text.join(" "))]);
  // The largest size at which every line fits the box.
  const measure = document.createElement("canvas").getContext("2d");
  let size = 14;
  for (; size > 11; size -= 0.5) {
    measure.font = `${size}px "Kelly Slab"`;
    if (Math.max(...card.text.map((text) => measure.measureText(text).width)) <= TEXT_BOX.x1 - TEXT_BOX.x0 - 14) break;
  }
  const bodyFont = `${size}px "Kelly Slab"`;

  paintBackground();
  paintWeeds(mulberry(3));
  const hook = drawFish(fish);
  paintBubbles(hook);
  paintFrame(mulberry(7));
  paintPlaque(card.name, titleFont);
  paintTextBox(card.text, bodyFont);
  present(canvas);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve));
  if (save) await fetch(`http://127.0.0.1:8001/save?name=${fish}.png`, { method: "POST", body: blob });
  return blob;
}

async function main() {
  const params = new URLSearchParams(location.search);
  const list = params.has("all") ? Object.keys(CARDS) : [params.get("fish") ?? "okun"];
  const first = document.getElementById("card");
  for (const [index, fish] of list.entries()) {
    const canvas = index === 0 ? first : document.body.insertBefore(document.createElement("canvas"), document.getElementById("download"));
    const blob = await render(fish, canvas, params.has("save"));
    if (index === 0) {
      const link = document.getElementById("download");
      link.href = URL.createObjectURL(blob);
      link.download = `${fish}.png`;
    }
  }
  document.title = params.has("save") ? "saved" : "done";
}

main();
